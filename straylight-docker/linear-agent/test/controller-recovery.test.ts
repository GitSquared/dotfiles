import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import { QA_APPROVE_VALUE } from "../src/attention.js";
import { AgentController } from "../src/controller.js";
import { ControllerStateStore } from "../src/controller-state.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";
import type { AgentTaskPayload } from "../src/types.js";

test("keeps a dormant session's Claude conversation across a restart, but not one with nothing left to resume", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-conversation-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([
      {
        sessionId: "session-dormant-with-conversation",
        running: false,
        awaitingInput: false,
        generation: 1,
        issueId: "issue-1",
        claudeConversationId: "conversation-worth-keeping",
        updatedAt: Date.now(),
      },
      {
        sessionId: "session-dormant-without-conversation",
        running: false,
        awaitingInput: false,
        generation: 1,
        issueId: "issue-2",
        updatedAt: Date.now(),
      },
    ]);
    const restored = await store.load();
    assert.deepEqual(restored.map((record) => record.sessionId), ["session-dormant-with-conversation"]);
    assert.equal(restored[0]?.claudeConversationId, "conversation-worth-keeping");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("keeps a session whose only remaining state is a tracked pull request, and round-trips it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-pull-request-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([
      {
        sessionId: "session-pr-only",
        running: false,
        awaitingInput: false,
        generation: 1,
        issueId: "issue-1",
        pullRequest: { url: "https://github.com/GitSquared/nemo/pull/7", owner: "GitSquared", repo: "nemo", number: 7 },
        updatedAt: Date.now(),
      },
    ]);
    const restored = await store.load();

    assert.deepEqual(restored.map((record) => record.sessionId), ["session-pr-only"], "a PR-only session must survive save()'s liveness filter, the same as one with a conversation to keep");
    assert.deepEqual(restored[0]?.pullRequest, { url: "https://github.com/GitSquared/nemo/pull/7", owner: "GitSquared", repo: "nemo", number: 7 });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("re-registers a pull request watch with the runner after a controller restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-pull-request-recovery-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([
      {
        sessionId: "session-pr-only",
        running: false,
        awaitingInput: false,
        generation: 1,
        issueId: "issue-1",
        pullRequest: { url: "https://github.com/GitSquared/nemo/pull/7", owner: "GitSquared", repo: "nemo", number: 7 },
        updatedAt: Date.now(),
      },
    ]);
    const linear = {
      async agentSessionSnapshot() {
        return { id: "session-pr-only", status: "active", issue: { id: "issue-1", team: { id: "team-1" } }, activities: { nodes: [] } };
      },
    } as unknown as LinearClient;
    const watchCalls: Array<{ sessionId: string; prUrl: string }> = [];
    const runner = {
      async watchPullRequestChecks(sessionId: string, prUrl: string) {
        watchCalls.push({ sessionId, prUrl });
        return { accepted: true };
      },
    } as unknown as AgentRunner;
    const controller = new AgentController(linear, runner, directory);

    await controller.initialize();

    assert.deepEqual(watchCalls, [{ sessionId: "session-pr-only", prUrl: "https://github.com/GitSquared/nemo/pull/7" }]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a finished CI check report never clobbers an open QA/Steering attention", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-pr-attention-checks-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([{
      sessionId: "session-attention",
      running: false,
      awaitingInput: true,
      generation: 1,
      issueId: "issue-1",
      teamId: "team-1",
      pullRequest: { url: "https://github.com/GitSquared/nemo/pull/7", owner: "GitSquared", repo: "nemo", number: 7 },
      attention: [{ kind: "qa", priority: "medium", previousStateId: "state-in-progress", requestedAt: Date.now() - 1_000 }],
      updatedAt: Date.now(),
    }]);
    const linear = {
      async agentSessionSnapshot() {
        return {
          id: "session-attention",
          status: "awaitingInput",
          appUser: { id: "agent-1" },
          issue: { id: "issue-1", identifier: "LIN-2", title: "Review me", team: { id: "team-1" } },
          activities: {
            nodes: [{ id: "activity-1", createdAt: new Date().toISOString(), ephemeral: false, content: { type: "elicitation", body: "Review" } }],
          },
        };
      },
      async setIssueState() { throw new Error("must not restore issue state - no human replied"); },
      async createActivity() { throw new Error("must not post an activity - a finished check report is not a reply"); },
    } as unknown as LinearClient;
    let runs = 0;
    const runner = {
      async health() { return { mode: "test" }; },
      async watchPullRequestChecks() { return { accepted: true }; },
      async run() { runs += 1; return { ok: true, timedOut: false, awaitingInput: false, summary: "Wrong", elapsedMs: 1 }; },
    } as unknown as AgentRunner;
    const controller = new AgentController(linear, runner, directory);
    await controller.initialize();

    await controller.reportPullRequestChecks("session-attention", "https://github.com/GitSquared/nemo/pull/7", {
      conclusion: "failure",
      body: "CI checks: 1 fail.",
    });

    assert.equal(runs, 0, "a check report arriving while QA is open must not resume the run - only the human's own reply may");
    const health = await controller.health() as { controller: { attentionQueue: { total: number; qa: number } } };
    assert.equal(health.controller.attentionQueue.total, 1, "the open QA attention must survive untouched");
    assert.equal(health.controller.attentionQueue.qa, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a review poll never clobbers an open QA/Steering attention, and does not mark the review consumed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-pr-attention-reviews-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([{
      sessionId: "session-attention",
      running: false,
      awaitingInput: true,
      generation: 1,
      issueId: "issue-1",
      teamId: "team-1",
      pullRequest: { url: "https://github.com/GitSquared/nemo/pull/7", owner: "GitSquared", repo: "nemo", number: 7 },
      attention: [{ kind: "qa", priority: "medium", previousStateId: "state-in-progress", requestedAt: Date.now() - 1_000 }],
      updatedAt: Date.now(),
    }]);
    const linear = {
      async agentSessionSnapshot() {
        return {
          id: "session-attention",
          status: "awaitingInput",
          appUser: { id: "agent-1" },
          issue: { id: "issue-1", identifier: "LIN-2", title: "Review me", team: { id: "team-1" } },
          activities: {
            nodes: [{ id: "activity-1", createdAt: new Date().toISOString(), ephemeral: false, content: { type: "elicitation", body: "Review" } }],
          },
        };
      },
      async setIssueState() { throw new Error("must not restore issue state - no human replied"); },
      async createActivity() { throw new Error("must not post an activity - a review poll finding is not a reply"); },
    } as unknown as LinearClient;
    let runs = 0;
    const runner = {
      async health() { return { mode: "test" }; },
      async watchPullRequestChecks() { return { accepted: true }; },
      async checkPullRequestReviews() {
        return { reviews: [{ id: 1, author: "gaby", state: "APPROVED", submittedAt: new Date(Date.now() + 60_000).toISOString(), body: "LGTM" }] };
      },
      async run() { runs += 1; return { ok: true, timedOut: false, awaitingInput: false, summary: "Wrong", elapsedMs: 1 }; },
    } as unknown as AgentRunner;
    const controller = new AgentController(linear, runner, directory);
    await controller.initialize();

    await controller.pollPullRequestReviews();

    assert.equal(runs, 0, "a review arriving while QA is open must not resume the run - only the human's own reply may");
    const health = await controller.health() as { controller: { attentionQueue: { total: number; qa: number } } };
    assert.equal(health.controller.attentionQueue.total, 1, "the open QA attention must survive untouched");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("re-arms a pull request's checks watch every time it is captured, not just the first time", async () => {
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createActivity() {},
    async addExternalUrl() {},
  } as unknown as LinearClient;
  const watchCalls: string[] = [];
  const runner = {
    async health() { return { mode: "test" }; },
    async watchPullRequestChecks(_sessionId: string, prUrl: string) { watchCalls.push(prUrl); return { accepted: true }; },
    async run() {
      return {
        ok: true,
        timedOut: false,
        awaitingInput: false,
        summary: "Opened https://github.com/GitSquared/nemo/pull/7 - ready for review.",
        elapsedMs: 1_000,
      };
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  // Simulate the agent pushing a fix in a follow-up turn on the same PR: a second run
  // completing must re-arm the watch, not skip it because this exact URL was already seen -
  // the first watch already exited (that's why a fresh CI run needs a fresh watch).
  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "Fixed the failing check, please re-check." } },
    agentSession: { id: "session-1", issueId: "issue-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(watchCalls, [
    "https://github.com/GitSquared/nemo/pull/7",
    "https://github.com/GitSquared/nemo/pull/7",
  ]);
});

test("recovers an interrupted Agent Session from durable state and Linear activity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([{
      sessionId: "session-1",
      running: true,
      awaitingInput: false,
      generation: 4,
      startedAt: Date.now() - 5_000,
      active: {
        type: "AgentSessionEvent",
        action: "created",
        appUserId: "agent-1",
        agentSession: { id: "session-1", issueId: "issue-1" },
      },
      issueId: "issue-1",
      teamId: "team-1",
      updatedAt: Date.now(),
    }]);

    const activities: unknown[] = [];
    const linear = {
      async agentSessionSnapshot() {
        return {
          id: "session-1",
          status: "active",
          appUser: { id: "agent-1" },
          issue: { id: "issue-1", identifier: "LIN-1", title: "Recover me", team: { id: "team-1" } },
          activities: {
            nodes: [{ id: "activity-1", createdAt: new Date().toISOString(), ephemeral: false, content: { type: "thought", body: "Working" } }],
          },
        };
      },
      async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
      async createActivity(_sessionId: string, content: unknown) { activities.push(content); },
    } as unknown as LinearClient;
    let recoveredPayload: AgentTaskPayload | undefined;
    let aborts = 0;
    const runner = {
      async abort() { aborts += 1; return true; },
      async repositories() { return []; },
      async run(payload: AgentTaskPayload) {
        recoveredPayload = payload;
        return { ok: true, timedOut: false, awaitingInput: false, summary: "Recovered.", elapsedMs: 1 };
      },
      async health() { return { mode: "test" }; },
    } as unknown as AgentRunner;

    const controller = new AgentController(linear, runner, directory);
    await controller.initialize();
    for (let attempt = 0; attempt < 50 && !recoveredPayload; attempt += 1) await Bun.sleep(2);

    assert.equal(aborts, 1);
    assert.equal(recoveredPayload?.action, "prompted");
    assert.match(recoveredPayload?.agentActivity?.content?.body ?? "", /controller restarted/i);
    assert.equal(activities.some((content) => (content as { type?: string }).type === "response"), true);
    const health = await controller.health() as { controller: { registry: { lastRecovery: { resumed: number } } } };
    assert.equal(health.controller.registry.lastRecovery.resumed, 1);
    for (let attempt = 0; attempt < 100 && (await store.load()).length; attempt += 1) await Bun.sleep(2);
    assert.equal((await store.load()).length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("resumes an interrupted Agent Session whose latest durable activity is a completed action, not just thought/elicitation", async () => {
  // Tonight's durable-log change made a completed `action` activity the common shape for
  // "latest non-ephemeral activity" on any session interrupted mid-task - previously that
  // was always a `thought`. initialize()'s recovery branching only ever had `thought` (this
  // file, above) and `elicitation` (below) exercised as the latest activity type; this pins
  // down that an `action` falls through the same way `thought` does: it's neither a
  // terminal type ("response"/"error") nor "elicitation", so a still-running session resumes.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-action-recovery-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([{
      sessionId: "session-action",
      running: true,
      awaitingInput: false,
      generation: 3,
      startedAt: Date.now() - 5_000,
      active: {
        type: "AgentSessionEvent",
        action: "created",
        appUserId: "agent-1",
        agentSession: { id: "session-action", issueId: "issue-1" },
      },
      issueId: "issue-1",
      teamId: "team-1",
      updatedAt: Date.now(),
    }]);

    const activities: unknown[] = [];
    const linear = {
      async agentSessionSnapshot() {
        return {
          id: "session-action",
          status: "active",
          appUser: { id: "agent-1" },
          issue: { id: "issue-1", identifier: "LIN-1", title: "Recover me", team: { id: "team-1" } },
          activities: {
            nodes: [{
              id: "activity-1",
              createdAt: new Date().toISOString(),
              ephemeral: false,
              content: { type: "action", action: "Running command", parameter: "bun test", result: "ok" },
            }],
          },
        };
      },
      async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
      async createActivity(_sessionId: string, content: unknown) { activities.push(content); },
    } as unknown as LinearClient;
    let recoveredPayload: AgentTaskPayload | undefined;
    let aborts = 0;
    const runner = {
      async abort() { aborts += 1; return true; },
      async repositories() { return []; },
      async run(payload: AgentTaskPayload) {
        recoveredPayload = payload;
        return { ok: true, timedOut: false, awaitingInput: false, summary: "Recovered.", elapsedMs: 1 };
      },
      async health() { return { mode: "test" }; },
    } as unknown as AgentRunner;

    const controller = new AgentController(linear, runner, directory);
    await controller.initialize();
    for (let attempt = 0; attempt < 50 && !recoveredPayload; attempt += 1) await Bun.sleep(2);

    assert.equal(aborts, 1);
    assert.equal(recoveredPayload?.action, "prompted");
    assert.match(recoveredPayload?.agentActivity?.content?.body ?? "", /controller restarted/i);
    assert.equal(activities.some((content) => (content as { type?: string }).type === "response"), true);
    const health = await controller.health() as {
      controller: { awaitingInputSessions: number; registry: { lastRecovery: { resumed: number; skipped: number } } };
    };
    assert.equal(health.controller.registry.lastRecovery.resumed, 1);
    assert.equal(health.controller.registry.lastRecovery.skipped, 0);
    assert.equal(health.controller.awaitingInputSessions, 0);
    for (let attempt = 0; attempt < 100 && (await store.load()).length; attempt += 1) await Bun.sleep(2);
    assert.equal((await store.load()).length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("reports a stranded session to Linear instead of silently abandoning it when its recovery snapshot times out", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-stranded-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([
      {
        sessionId: "session-stranded",
        running: true,
        awaitingInput: false,
        generation: 2,
        startedAt: Date.now() - 5_000,
        active: {
          type: "AgentSessionEvent",
          action: "created",
          appUserId: "agent-1",
          agentSession: { id: "session-stranded", issueId: "issue-1" },
        },
        issueId: "issue-1",
        teamId: "team-1",
        updatedAt: Date.now(),
      },
      {
        sessionId: "session-recoverable",
        running: true,
        awaitingInput: false,
        generation: 1,
        startedAt: Date.now() - 5_000,
        active: {
          type: "AgentSessionEvent",
          action: "created",
          appUserId: "agent-1",
          agentSession: { id: "session-recoverable", issueId: "issue-2" },
        },
        issueId: "issue-2",
        teamId: "team-1",
        updatedAt: Date.now(),
      },
    ]);

    const activities: Array<{ sessionId: string; content: { type?: string; body?: string } }> = [];
    const linear = {
      async agentSessionSnapshot(sessionId: string) {
        if (sessionId === "session-stranded") {
          // This fake stands in for any rejection from the real LinearClient - including, but
          // not limited to, graphqlWithToken's AbortSignal-based timeout rejecting a hung
          // GraphQL call. It does not exercise that timeout mechanism itself (it never touches
          // fetch/AbortSignal/GRAPHQL_TIMEOUT_MS); that real fetch+abort path is covered
          // separately by test/linear.test.ts's real-connection tests. What this test proves is
          // initialize()'s handling of such a rejection: a slow-then-failing recovery snapshot
          // for one record must not block startup, and the failure must be reported rather than
          // silently swallowed. A short real delay here is enough to prove the controller
          // doesn't need this call to resolve quickly, without slowing the suite.
          await Bun.sleep(20);
          throw new Error("Linear GraphQL request timed out after 15000ms");
        }
        return {
          id: sessionId,
          status: "active",
          appUser: { id: "agent-1" },
          issue: { id: "issue-2", identifier: "LIN-2", title: "Recoverable", team: { id: "team-1" } },
          activities: { nodes: [] },
        };
      },
      async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
      async createActivity(sessionId: string, content: { type?: string; body?: string }) {
        activities.push({ sessionId, content });
      },
    } as unknown as LinearClient;
    const runner = {
      async abort() { return true; },
      async repositories() { return []; },
      async run() { return { ok: true, timedOut: false, awaitingInput: false, summary: "Recovered.", elapsedMs: 1 }; },
      async health() { return { mode: "test" }; },
    } as unknown as AgentRunner;

    const controller = new AgentController(linear, runner, directory);
    const startedAt = Date.now();
    await controller.initialize();
    const elapsedMs = Date.now() - startedAt;
    // The core of the bug: initialize() is awaited before Bun.serve ever starts listening
    // (see src/index.ts). One record's snapshot call taking a while - or, before this fix,
    // never resolving at all - must not stop the controller from finishing startup.
    assert.ok(elapsedMs < 2_000, `initialize() should not block on a single stuck recovery snapshot (took ${elapsedMs}ms)`);

    const strandedActivity = activities.find((entry) => entry.sessionId === "session-stranded");
    assert.ok(strandedActivity, "expected a Linear activity reporting the stranded session instead of pure silence");
    assert.equal(strandedActivity?.content.type, "error");
    assert.match(strandedActivity?.content.body ?? "", /could not be recovered/i);

    const health = await controller.health() as {
      controller: { registry: { lastRecovery: { errors: number; resumed: number } } };
    };
    assert.equal(health.controller.registry.lastRecovery.errors, 1);
    assert.equal(health.controller.registry.lastRecovery.resumed, 1);

    // A session we could not reconcile must not survive the 500-session cap forever: once
    // we've reported it, it should no longer be treated as pending/active/awaiting input.
    for (let attempt = 0; attempt < 100 && (await store.load()).some((record) => record.sessionId === "session-stranded"); attempt += 1) {
      await Bun.sleep(2);
    }
    assert.equal((await store.load()).some((record) => record.sessionId === "session-stranded"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("restores an attention wait without replaying work after a controller restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-attention-controller-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([{
      sessionId: "session-attention",
      running: true,
      awaitingInput: true,
      generation: 2,
      active: { action: "created", agentSession: { id: "session-attention", issueId: "issue-1" } },
      issueId: "issue-1",
      teamId: "team-1",
      attention: [{
        kind: "qa",
        priority: "medium",
        previousStateId: "state-in-progress",
        requestedAt: Date.now() - 1_000,
      }],
      updatedAt: Date.now(),
    }]);
    const linear = {
      async agentSessionSnapshot() {
        return {
          id: "session-attention",
          status: "awaitingInput",
          appUser: { id: "agent-1" },
          issue: { id: "issue-1", identifier: "LIN-2", title: "Review me", team: { id: "team-1" } },
          activities: {
            nodes: [{ id: "activity-1", createdAt: new Date().toISOString(), ephemeral: false, content: { type: "elicitation", body: "Review" } }],
          },
        };
      },
    } as unknown as LinearClient;
    let runs = 0;
    const runner = {
      async abort() { return true; },
      async run() { runs += 1; return { ok: true, timedOut: false, awaitingInput: false, summary: "Wrong", elapsedMs: 1 }; },
      async health() { return { mode: "test" }; },
    } as unknown as AgentRunner;

    const controller = new AgentController(linear, runner, directory);
    await controller.initialize();
    const health = await controller.health() as { controller: { attentionQueue: { total: number; qa: number } } };
    assert.equal(runs, 0);
    assert.equal(health.controller.attentionQueue.total, 1);
    assert.equal(health.controller.attentionQueue.qa, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("clears an open attention instead of waiting forever once Linear reports the session went stale or complete on its own", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  let snapshotCalls = 0;
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    async createActivity() {},
    async agentSessionSnapshot(sessionId: string) {
      snapshotCalls += 1;
      // Stands in for Linear's own 30-minute staleness timer firing while nobody replied yet -
      // the live session is now dead even though our persisted state still shows an open wait.
      // The second call below uses "Complete" (capitalized) instead, to also prove the terminal
      // check is case-insensitive and covers "complete" as well as "stale".
      return {
        id: sessionId,
        status: snapshotCalls === 1 ? "stale" : "Complete",
        appUser: { id: "agent-1" },
        activities: { nodes: [] },
      };
    },
  } as unknown as LinearClient;
  let finishFirst!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const first = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishFirst = resolve;
  });
  const runs: AgentTaskPayload[] = [];
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(payload: AgentTaskPayload) {
      runs.push(payload);
      if (runs.length === 1) return first;
      return { ok: true as const, timedOut: false as const, awaitingInput: false, summary: "Fresh turn.", elapsedMs: 1 };
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "stale-session", issueId: "stale-issue", creatorId: "human-1", issue: { id: "stale-issue", teamId: "team-1" } },
  });
  await controller.collaborateLinear("stale-session", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "queue",
      priority: "high",
      blocking: true,
      title: "Choose the boundary",
      action: "Choose the safe migration boundary.",
      recommendation: "Keep the old writer authoritative.",
    },
  });
  finishFirst({ ok: true, timedOut: false, awaitingInput: true, summary: "Waiting.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }
  const beforeReply = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(beforeReply.controller.attentionQueue.total, 1);

  // A very late reply arrives after Linear has independently marked the session stale.
  await controller.handle({
    action: "prompted",
    agentSession: { id: "stale-session", issueId: "stale-issue" },
    agentActivity: { content: { body: "Keep the old writer." } },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 2; attempt += 1) await Bun.sleep(2);

  assert.ok(snapshotCalls >= 1, "the opportunistic reconciliation must actually call agentSessionSnapshot");
  const after = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(after.controller.attentionQueue.total, 0, "the dead wait must be cleared instead of staying stuck forever");
  assert.deepEqual(stateFlips, [{ issueId: "stale-issue", stateId: "state-blocked" }],
    "reconciling a stale session must not run the normal reply flow's issue-state restore");
  assert.deepEqual(reactions, [], "reconciling a stale session must not react to the late reply as if it answered the elicitation");
  assert.equal(runs.length, 2, "the late reply must still be processed as a fresh prompt rather than silently dropped");

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  // A second Steering wait opens on the same session, and this time Linear reports it as
  // "Complete" (capitalized) rather than "stale" - proving the terminal check covers both
  // values from the task's "stale/complete" requirement, and is case-insensitive.
  await controller.collaborateLinear("stale-session", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "queue",
      priority: "high",
      blocking: true,
      title: "Choose the boundary again",
      action: "Choose the safe migration boundary, again.",
      recommendation: "Keep the old writer authoritative.",
    },
  });
  const reopened = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(reopened.controller.attentionQueue.total, 1);

  await controller.handle({
    action: "prompted",
    agentSession: { id: "stale-session", issueId: "stale-issue" },
    agentActivity: { content: { body: "Keep the old writer, again." } },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 3; attempt += 1) await Bun.sleep(2);

  assert.equal(snapshotCalls, 2, "a second reconciliation must run its own live check rather than reusing the first result");
  const finalHealth = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(finalHealth.controller.attentionQueue.total, 0, "a 'Complete' status must reconcile too, not just 'stale'");
  assert.deepEqual(stateFlips, [
    { issueId: "stale-issue", stateId: "state-blocked" },
    { issueId: "stale-issue", stateId: "state-blocked" },
  ], "both attention openings flip issue status, but neither reconciliation restores it - bookkeeping only");
  assert.deepEqual(reactions, [], "no reply flow ever fires across either reconciliation");
  assert.equal(runs.length, 3, "the second late reply must also start a fresh run rather than being dropped");
});

test("does not clear a genuinely open attention just because its latest activity looks like a closing response", async () => {
  const activities: Array<{ content: unknown; options?: unknown }> = [];
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  let snapshotCalls = 0;
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
    async resolveComment() {},
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    async createActivity(_sessionId: string, content: unknown, options?: unknown) {
      activities.push({ content, ...(options ? { options } : {}) });
    },
    async agentSessionSnapshot(sessionId: string) {
      snapshotCalls += 1;
      // The live status is still genuinely "awaitingInput", but the most recent logged activity
      // happens to look like a closing "response" - initialize()'s startup check treats either
      // signal as terminal, but the live opportunistic check must not: reusing that heuristic here
      // would clear a perfectly healthy wait out from under a reply that's about to land.
      return {
        id: sessionId,
        status: "awaitingInput",
        appUser: { id: "agent-1" },
        activities: {
          nodes: [{ id: "activity-1", createdAt: new Date().toISOString(), ephemeral: false, content: { type: "response", body: "Ready for QA." } }],
        },
      };
    },
  } as unknown as LinearClient;
  let finishRun: ((value: { ok: true; timedOut: false; awaitingInput: boolean; summary: string; elapsedMs: number }) => void) | undefined;
  const run = new Promise<{ ok: true; timedOut: false; awaitingInput: boolean; summary: string; elapsedMs: number }>((resolve) => {
    finishRun = resolve;
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return run; },
    async followUp() { return true; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-attention", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await controller.collaborateLinear("session-attention", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "interrupt",
      priority: "urgent",
      blocking: true,
      title: "A destructive migration needs a boundary",
      action: "Confirm that the old writer must remain authoritative.",
      recommendation: "Keep the old writer until verification passes.",
    },
  });

  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "Keep the old writer." } },
    agentSession: { id: "session-attention", comment: { id: "reply-1", body: "Keep the old writer." } },
  });

  assert.ok(snapshotCalls >= 1, "the opportunistic check must run for a session with an open attention");
  const resumed = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(resumed.controller.attentionQueue.total, 0, "the reply itself still resolves the attention through the normal flow");
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }]);
  // GAB-26: the issue-state restore is now deferred until the resumed turn concludes, not
  // fired the instant the reply lands - so it must not have happened yet here.
  assert.deepEqual(stateFlips, [{ issueId: "issue-1", stateId: "state-blocked" }],
    "the live check must not have already cleared attention, but the reply must not immediately restore issue status either");

  finishRun?.({ ok: true, timedOut: false, awaitingInput: false, summary: "Kept the old writer.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }
  assert.deepEqual(stateFlips[1], { issueId: "issue-1", stateId: "state-in-progress" },
    "the normal reply flow's issue-state restore must still run, once the resumed turn concludes");
});

test("keeps a Pi run alive when an ephemeral Linear activity fails", async () => {
  const activities: Array<{ content: unknown; ephemeral: boolean }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async createActivity(_sessionId: string, content: unknown, options?: { ephemeral?: boolean }) {
      if (options?.ephemeral) throw new Error("socket connection was closed unexpectedly");
      activities.push({ content, ephemeral: false });
    },
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(_payload: AgentTaskPayload, onEvent: Parameters<AgentRunner["run"]>[1]) {
      await onEvent({
        type: "activity",
        content: { type: "action", action: "Inspecting", parameter: "workspace" },
        ephemeral: true,
      });
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Finished despite flaky progress delivery.", elapsedMs: 2 };
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({ action: "created", agentSession: { id: "session-1" } });
  for (let attempt = 0; attempt < 50 && activities.length === 0; attempt += 1) await Bun.sleep(2);

  assert.equal(activities.length, 1);
  assert.match((activities[0]?.content as { body?: string }).body ?? "", /Finished despite flaky progress delivery/);
  const health = await controller.health() as { controller: { runningSessions: number } };
  assert.equal(health.controller.runningSessions, 0);
});

test("retries a failed durable Linear activity post with backoff, and keeps the completed action once a retry succeeds", async () => {
  let durableAttempts = 0;
  const actionActivities: unknown[] = [];
  const responseActivities: unknown[] = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async createActivity(_sessionId: string, content: { type?: string }, options?: { ephemeral?: boolean }) {
      if (options?.ephemeral) return;
      if (content.type === "response") { responseActivities.push(content); return; }
      // Isolates the mechanism under test (the durable `action` post) from finish()'s
      // separate, unrelated final "response" activity - that one is out of scope here.
      durableAttempts += 1;
      if (durableAttempts < 3) throw new Error("Linear GraphQL request failed: HTTP 503");
      actionActivities.push(content);
    },
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(_payload: AgentTaskPayload, onEvent: Parameters<AgentRunner["run"]>[1]) {
      await onEvent({
        type: "activity",
        content: { type: "action", action: "Running command", parameter: "bun test", result: "ok" },
        ephemeral: false,
      });
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 2 };
    },
  } as unknown as AgentRunner;
  const sleeps: number[] = [];
  // Zero-wall-clock-dependency sleep stand-in, injected through the controller's optional
  // 5th constructor argument (same shape as putPreparedLinearUpload's injectable sleep in
  // src/linear.ts) so this test's assertions never race a real timer.
  const controller = new AgentController(linear, runner, undefined, undefined, async (ms) => { sleeps.push(ms); });

  await controller.handle({ action: "created", agentSession: { id: "session-1" } });
  for (let attempt = 0; attempt < 50 && actionActivities.length === 0; attempt += 1) await Bun.sleep(2);

  assert.equal(durableAttempts, 3);
  assert.equal(actionActivities.length, 1);
  assert.deepEqual(sleeps, [250, 500]);
  assert.equal(responseActivities.length, 1);
  const health = await controller.health() as { controller: { durableActivities: { failures: number } } };
  assert.equal(health.controller.durableActivities.failures, 0);
});

test("surfaces a durable Linear activity post that exhausts every retry via health(), instead of dropping it silently", async () => {
  let durableAttempts = 0;
  const responseActivities: unknown[] = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async createActivity(_sessionId: string, content: { type?: string }, options?: { ephemeral?: boolean }) {
      if (options?.ephemeral) return;
      if (content.type === "response") { responseActivities.push(content); return; }
      durableAttempts += 1;
      throw new Error("Linear GraphQL request failed: HTTP 503");
    },
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(_payload: AgentTaskPayload, onEvent: Parameters<AgentRunner["run"]>[1]) {
      await onEvent({
        type: "activity",
        content: { type: "action", action: "Running command", parameter: "bun test", result: "ok" },
        ephemeral: false,
      });
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Done despite a permanently failing durable post.", elapsedMs: 2 };
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner, undefined, undefined, async () => {});

  await controller.handle({ action: "created", agentSession: { id: "session-1" } });
  type Health = { controller: { runningSessions: number; durableActivities: { failures: number; lastFailure?: { sessionId: string; attempts: number; message: string } } } };
  let health: Health = (await controller.health()) as Health;
  for (let attempt = 0; attempt < 50 && health.controller.durableActivities.failures === 0; attempt += 1) {
    await Bun.sleep(2);
    health = (await controller.health()) as Health;
  }

  // Bounded and exhausted (DURABLE_ACTIVITY_MAX_ATTEMPTS), not retried forever.
  assert.equal(durableAttempts, 3);
  assert.equal(health.controller.durableActivities.failures, 1);
  assert.equal(health.controller.durableActivities.lastFailure?.sessionId, "session-1");
  assert.equal(health.controller.durableActivities.lastFailure?.attempts, 3);
  assert.match(health.controller.durableActivities.lastFailure?.message ?? "", /HTTP 503/);
  // The dropped durable post must not crash or hang the run - the agent run continues, same
  // as the existing ephemeral-failure behavior above.
  assert.equal(responseActivities.length, 1);
  assert.equal(health.controller.runningSessions, 0);
});

test("tracks rationalized attention on the parent issue and clears it on follow-up", async () => {
  const activities: Array<{ content: unknown; options?: unknown }> = [];
  const comments: Array<{ issueId: string; body: string }> = [];
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
    async resolveComment() {},
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment(issueId: string, body: string) { comments.push({ issueId, body }); return { id: "comment-1", body }; },
    async createActivity(_sessionId: string, content: unknown, options?: unknown) {
      activities.push({ content, ...(options ? { options } : {}) });
    },
  } as unknown as LinearClient;
  let finishRun: ((value: { ok: true; timedOut: false; awaitingInput: boolean; summary: string; elapsedMs: number }) => void) | undefined;
  const run = new Promise<{ ok: true; timedOut: false; awaitingInput: boolean; summary: string; elapsedMs: number }>((resolve) => {
    finishRun = resolve;
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return run; },
    async followUp() { return true; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-attention", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await controller.collaborateLinear("session-attention", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "interrupt",
      priority: "urgent",
      blocking: true,
      title: "A destructive migration needs a boundary",
      action: "Confirm that the old writer must remain authoritative.",
      recommendation: "Keep the old writer until verification passes.",
      options: [
        { label: "Keep old writer", value: "expand and backfill" },
        { label: "Cut over", value: "switch immediately" },
      ],
    },
  });

  const waiting = await controller.health() as {
    controller: { attentionQueue: { total: number; steering: number; qa: number; urgent: number; oldestWaitMs: number } };
  };
  assert.equal(waiting.controller.attentionQueue.total, 1);
  assert.equal(waiting.controller.attentionQueue.steering, 1);
  assert.equal(waiting.controller.attentionQueue.qa, 0);
  assert.equal(waiting.controller.attentionQueue.urgent, 1);
  assert.ok(waiting.controller.attentionQueue.oldestWaitMs >= 0);
  assert.deepEqual(stateFlips, [{ issueId: "issue-1", stateId: "state-blocked" }]);
  assert.equal(comments.length, 1, "blocking Steering/QA also posts a real, tracked comment alongside the elicitation - a reply here resolves it too");
  const elicitation = activities.find((activity) => (activity.content as { body?: string }).body?.includes("Steering needed"));
  const elicitationBody = (elicitation?.content as { body?: string }).body ?? "";
  assert.match(elicitationBody, /\*\*Steering needed:\*\* A destructive migration needs a boundary/);
  assert.match(elicitationBody, /See the comment on this issue/, "the elicitation stays a scannable one-liner, not the full render");
  assert.doesNotMatch(elicitationBody, /Confirm that the old writer/, "the full action text belongs in the comment, not the elicitation");
  assert.deepEqual((elicitation?.options as { signal?: string }).signal, "select");
  assert.match(comments[0]?.body ?? "", /\*\*Steering needed:\*\* A destructive migration needs a boundary/);
  assert.match(comments[0]?.body ?? "", /Confirm that the old writer must remain authoritative/, "the comment carries the full context the elicitation omits");
  assert.doesNotMatch(comments[0]?.body ?? "", /Original intent/, "the comment must use the terse render, not the bureaucratic full template");

  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "Keep the old writer." } },
    agentSession: { id: "session-attention", comment: { id: "reply-1", body: "Keep the old writer." } },
  });
  const resumed = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(resumed.controller.attentionQueue.total, 0);
  // GAB-26: the reply is only acknowledged, not resolved, the instant it lands - the issue
  // must not drop out of its attention state until the resumed turn it feeds actually
  // concludes without raising a fresh attention of its own.
  assert.deepEqual(stateFlips, [{ issueId: "issue-1", stateId: "state-blocked" }],
    "a bare reply must not immediately restore issue status (GAB-25/GAB-26)");
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }]);

  finishRun?.({ ok: true, timedOut: false, awaitingInput: false, summary: "Kept the old writer.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }
  assert.deepEqual(stateFlips[1], { issueId: "issue-1", stateId: "state-in-progress" },
    "the deferred restore fires once the resumed turn concludes cleanly");
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }]);
});

test("posts an access-repair Steering request with the native auth signal", async () => {
  const activities: Array<{ content: unknown; options?: unknown }> = [];
  const comments: string[] = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment() {},
    async setIssueState() {},
    async createIssueComment(_issueId: string, body: string) { comments.push(body); return { id: "comment-1", body }; },
    async createActivity(_sessionId: string, content: unknown, options?: unknown) {
      activities.push({ content, ...(options ? { options } : {}) });
    },
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
    async followUp() { return true; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-access", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await controller.collaborateLinear("session-access", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "interrupt",
      priority: "urgent",
      blocking: true,
      title: "GitHub access is missing",
      action: "Restore GitHub access in the task workspace before implementation can continue.",
      recommendation: "Link the GitHub account from the workbench.",
      accessRepair: { url: "https://straylight.example.test/linear/tools/auth", providerName: "GitHub" },
    },
  });

  const elicitation = activities.find((activity) => (activity.content as { body?: string }).body?.includes("Steering needed"));
  const options = elicitation?.options as { signal?: string; signalMetadata?: { url?: string; providerName?: string } };
  assert.deepEqual(options.signal, "auth");
  assert.deepEqual(options.signalMetadata, { url: "https://straylight.example.test/linear/tools/auth", providerName: "GitHub" });
  // The native "Link account" button renders off signalMetadata above, regardless of body
  // text - the elicitation body itself stays a one-liner; the link markdown (for whoever
  // reads the comment instead of clicking the button) lives in the tracked comment.
  assert.match(comments[0] ?? "", /\[GitHub\]\(https:\/\/straylight\.example\.test\/linear\/tools\/auth\)/);
});

test("resumes the paused parent run directly when the engineer replies on the same issue", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment() {},
    async resolveComment() {},
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    async createActivity() {},
  } as unknown as LinearClient;
  let finishFirst!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const first = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishFirst = resolve;
  });
  const runs: AgentTaskPayload[] = [];
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(payload: AgentTaskPayload) {
      runs.push(payload);
      if (runs.length === 1) return first;
      return { ok: true as const, timedOut: false as const, awaitingInput: false, summary: "Resumed.", elapsedMs: 1 };
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "parent-session", issueId: "parent-issue", creatorId: "human-1", issue: { id: "parent-issue", teamId: "team-1" } },
  });
  await controller.collaborateLinear("parent-session", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "queue",
      priority: "high",
      blocking: true,
      title: "Choose the boundary",
      action: "Choose the safe migration boundary.",
      recommendation: "Keep the old writer authoritative.",
    },
  });
  finishFirst({ ok: true, timedOut: false, awaitingInput: true, summary: "Waiting.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  await controller.handle({
    action: "prompted",
    organizationId: "org-1",
    agentActivity: { content: { body: "Keep the old writer authoritative." } },
    agentSession: { id: "parent-session", issueId: "parent-issue" },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 2; attempt += 1) await Bun.sleep(2);

  assert.equal(runs.length, 2);
  assert.equal(runs[1]?.agentActivity?.content?.body, "Keep the old writer authoritative.");
  assert.deepEqual(stateFlips, [
    { issueId: "parent-issue", stateId: "state-blocked" },
    { issueId: "parent-issue", stateId: "state-in-progress" },
  ]);
});

test("ignores a reply on an unrelated comment thread while a blocking attention is open", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment() {},
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment() { return { id: "attention-comment-1", body: "" }; },
    async createActivity() {},
  } as unknown as LinearClient;
  let finishFirst!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const first = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishFirst = resolve;
  });
  const runs: AgentTaskPayload[] = [];
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(payload: AgentTaskPayload) {
      runs.push(payload);
      return runs.length === 1 ? first : { ok: true as const, timedOut: false as const, awaitingInput: false, summary: "Resumed.", elapsedMs: 1 };
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "parent-session", issueId: "parent-issue", creatorId: "human-1", issue: { id: "parent-issue", teamId: "team-1" } },
  });
  await controller.collaborateLinear("parent-session", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "queue",
      priority: "high",
      blocking: true,
      title: "Choose the boundary",
      action: "Choose the safe migration boundary.",
      recommendation: "Keep the old writer authoritative.",
    },
  });
  finishFirst({ ok: true, timedOut: false, awaitingInput: true, summary: "Waiting.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  // A reply lands on an earlier, unrelated comment thread on the same issue.
  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "What's the migration deadline again?" } },
    agentSession: {
      id: "parent-session",
      issueId: "parent-issue",
      comment: { id: "reply-1", body: "What's the migration deadline again?", parentId: "unrelated-comment-1" },
    },
  });
  await Bun.sleep(10);

  assert.equal(runs.length, 1, "an off-thread reply must not resume the run");
  assert.deepEqual(stateFlips, [{ issueId: "parent-issue", stateId: "state-blocked" }], "status must stay flipped, unrestored");
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 1, "the blocking attention must remain tracked");
});

test("completes the issue directly when the engineer approves a QA attention", async () => {
  const activities: Array<{ sessionId: string; content: unknown; options?: unknown }> = [];
  const completedIssues: string[] = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
    async resolveComment() {},
    async setIssueState() {},
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
    async createActivity(sessionId: string, content: unknown, options?: unknown) {
      activities.push({ sessionId, content, ...(options ? { options } : {}) });
    },
  } as unknown as LinearClient;
  let finishRun!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const pending = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishRun = resolve;
  });
  let runs = 0;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { runs += 1; return pending; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "parent-qa-session", issueId: "parent-issue", creatorId: "human-1", issue: { id: "parent-issue", teamId: "team-1" } },
  });
  await controller.collaborateLinear("parent-qa-session", {
    action: "attention",
    request: {
      kind: "qa",
      delivery: "queue",
      priority: "medium",
      title: "Review the checked fix",
      action: "Approve the preview and complete the parent work, or reply with changes.",
      recommendation: "Approve after checking the linked preview.",
      evidence: [{ label: "Preview", url: "https://preview.example.test/fix" }],
    },
  });
  finishRun({ ok: true, timedOut: false, awaitingInput: true, summary: "Ready for QA.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  const elicitation = activities.find((activity) => activity.sessionId === "parent-qa-session"
    && (activity.content as { type?: string }).type === "elicitation");
  assert.deepEqual((elicitation?.options as { signalMetadata?: { options?: Array<{ value: string }> } })?.signalMetadata?.options?.map((option) => option.value), [
    QA_APPROVE_VALUE,
    "Not approved; resume the parent work.",
  ]);

  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: QA_APPROVE_VALUE } },
    agentSession: { id: "parent-qa-session", issueId: "parent-issue", comment: { id: "reply-1", body: QA_APPROVE_VALUE } },
  });

  assert.equal(runs, 1);
  assert.deepEqual(completedIssues, ["parent-issue"]);
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }]);
  assert.equal(activities.some((activity) => activity.sessionId === "parent-qa-session"
    && (activity.content as { type?: string }).type === "response"), true);
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 0);
});

test("completes the issue directly when the engineer replies with the literal word the QA instruction told them to type", async () => {
  // renderAttentionComment's QA instruction says "Reply **approve** to complete" (see
  // attention.test.ts), never the canonical QA_APPROVE_VALUE - a human replying with exactly
  // what they were told to type must take the same direct path as a real button click, not
  // fall through to resuming Claude.
  const activities: Array<{ sessionId: string; content: unknown }> = [];
  const completedIssues: string[] = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
    async resolveComment() {},
    async setIssueState() {},
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
    async createActivity(sessionId: string, content: unknown) { activities.push({ sessionId, content }); },
  } as unknown as LinearClient;
  let finishRun!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const pending = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishRun = resolve;
  });
  let runs = 0;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { runs += 1; return pending; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "parent-qa-session", issueId: "parent-issue", creatorId: "human-1", issue: { id: "parent-issue", teamId: "team-1" } },
  });
  await controller.collaborateLinear("parent-qa-session", {
    action: "attention",
    request: {
      kind: "qa",
      delivery: "queue",
      priority: "medium",
      title: "Review the checked fix",
      action: "Approve the preview and complete the parent work, or reply with changes.",
      recommendation: "Approve after checking the linked preview.",
      evidence: [{ label: "Preview", url: "https://preview.example.test/fix" }],
    },
  });
  finishRun({ ok: true, timedOut: false, awaitingInput: true, summary: "Ready for QA.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "approve" } },
    agentSession: { id: "parent-qa-session", issueId: "parent-issue", comment: { id: "reply-1", body: "approve" } },
  });

  assert.equal(runs, 1, "the reply must resolve directly, never resuming Claude for a second run");
  assert.deepEqual(completedIssues, ["parent-issue"]);
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }]);
  assert.equal(activities.some((activity) => activity.sessionId === "parent-qa-session"
    && (activity.content as { type?: string }).type === "response"), true);
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 0);
});

test("completes the issue directly when the engineer reacts with a checkmark instead of replying", async () => {
  const activities: Array<{ sessionId: string; content: unknown }> = [];
  const completedIssues: string[] = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
    async resolveComment() {},
    async setIssueState() {},
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
    async createActivity(sessionId: string, content: unknown) { activities.push({ sessionId, content }); },
  } as unknown as LinearClient;
  let finishRun!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const pending = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishRun = resolve;
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return pending; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "parent-qa-session", issueId: "parent-issue", creatorId: "human-1", issue: { id: "parent-issue", teamId: "team-1" } },
  });
  await controller.collaborateLinear("parent-qa-session", {
    action: "attention",
    request: {
      kind: "qa",
      delivery: "queue",
      priority: "medium",
      title: "Review the checked fix",
      action: "Approve the preview and complete the parent work, or reply with changes.",
      recommendation: "Approve after checking the linked preview.",
      evidence: [{ label: "Preview", url: "https://preview.example.test/fix" }],
    },
  });
  finishRun({ ok: true, timedOut: false, awaitingInput: true, summary: "Ready for QA.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  // The engineer reacts with a checkmark on the issue instead of replying with the approve
  // text - Linear cannot deliver a reaction on the elicitation itself (see RESEARCH.md), so
  // this is the AppUserNotification an issue-level reaction actually produces.
  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueEmojiReaction",
    appUserId: "agent-1",
    notification: { issueId: "parent-issue", reactionEmoji: "white_check_mark", actorId: "human-1" },
  });

  assert.deepEqual(completedIssues, ["parent-issue"]);
  assert.equal(activities.some((activity) => activity.sessionId === "parent-qa-session"
    && (activity.content as { type?: string }).type === "response"), true);
  // No comment was ever replied to, so there is nothing to react back on.
  assert.deepEqual(reactions, []);
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 0);
});

test("ignores a non-checkmark reaction on an issue with an open QA attention", async () => {
  const completedIssues: string[] = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment() {},
    async setIssueState() {},
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
    async createActivity() {},
  } as unknown as LinearClient;
  let finishRun!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const pending = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishRun = resolve;
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return pending; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "parent-qa-session", issueId: "parent-issue", creatorId: "human-1", issue: { id: "parent-issue", teamId: "team-1" } },
  });
  await controller.collaborateLinear("parent-qa-session", {
    action: "attention",
    request: {
      kind: "qa",
      delivery: "queue",
      priority: "medium",
      title: "Review the checked fix",
      action: "Approve the preview and complete the parent work, or reply with changes.",
      recommendation: "Approve after checking the linked preview.",
      evidence: [{ label: "Preview", url: "https://preview.example.test/fix" }],
    },
  });
  finishRun({ ok: true, timedOut: false, awaitingInput: true, summary: "Ready for QA.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueEmojiReaction",
    appUserId: "agent-1",
    notification: { issueId: "parent-issue", reactionEmoji: "thumbsup", actorId: "human-1" },
  });

  assert.deepEqual(completedIssues, []);
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 1, "the QA attention must remain open");
});

test("ignores a checkmark reaction when there is no open QA attention, or the open attention is a Steering", async () => {
  const completedIssues: string[] = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment() {},
    async setIssueState() {},
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
    async createActivity() {},
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return { ok: true as const, timedOut: false as const, awaitingInput: false, summary: "Done.", elapsedMs: 1 }; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  // A session with no attention open at all.
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "idle-session", issueId: "idle-issue", creatorId: "human-1", issue: { id: "idle-issue", teamId: "team-1" } },
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }
  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueEmojiReaction",
    appUserId: "agent-1",
    notification: { issueId: "idle-issue", reactionEmoji: "white_check_mark", actorId: "human-1" },
  });
  assert.deepEqual(completedIssues, [], "a reaction with nothing awaiting input must do nothing");

  // A session with an open Steering (not QA) attention.
  let finishFirst!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const first = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishFirst = resolve;
  });
  const steeringRunner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return first; },
  } as unknown as AgentRunner;
  const steeringController = new AgentController(linear, steeringRunner);
  await steeringController.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "steering-session", issueId: "steering-issue", creatorId: "human-1", issue: { id: "steering-issue", teamId: "team-1" } },
  });
  await steeringController.collaborateLinear("steering-session", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "queue",
      priority: "high",
      blocking: true,
      title: "Choose the boundary",
      action: "Choose the safe migration boundary.",
      recommendation: "Keep the old writer authoritative.",
    },
  });
  finishFirst({ ok: true, timedOut: false, awaitingInput: true, summary: "Waiting.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await steeringController.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }
  await steeringController.handleNotification({
    type: "AppUserNotification",
    action: "issueEmojiReaction",
    appUserId: "agent-1",
    notification: { issueId: "steering-issue", reactionEmoji: "white_check_mark", actorId: "human-1" },
  });
  assert.deepEqual(completedIssues, [], "a checkmark on an open Steering (not QA) must not complete the issue");
  const health = await steeringController.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 1, "the Steering attention must remain open");
});

test("warns a freshly mentioned session that another session on the same issue is already active", async () => {
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createActivity() {},
  } as unknown as LinearClient;
  const runs: AgentTaskPayload[] = [];
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(payload: AgentTaskPayload) {
      runs.push(payload);
      // Never resolves - both sessions stay "running" for the test's duration.
      return new Promise(() => {});
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  // start() sets state.running synchronously before execute() ever runs, so
  // by the time this resolves, session-a is already tracked as running.
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-a", issueId: "shared-issue", creatorId: "human-1" },
  });
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-b", issueId: "shared-issue", creatorId: "human-1" },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 2; attempt += 1) await Bun.sleep(2);

  assert.equal(runs.length, 2);
  assert.ok(runs[1]?.guidance?.some((entry) => entry.body?.includes("actively running")));
  assert.ok(!runs[0]?.guidance?.some((entry) => entry.body?.includes("actively running")));
});

test("routes a new mention into the same Claude conversation as a dormant sibling on the same issue", async () => {
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createActivity() {},
  } as unknown as LinearClient;
  const runs: AgentTaskPayload[] = [];
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(payload: AgentTaskPayload) {
      runs.push(payload);
      return {
        ok: true as const,
        timedOut: false as const,
        awaitingInput: false,
        summary: "Done.",
        elapsedMs: 1,
        conversationId: `conversation-for-${payload.agentSession?.id}`,
      };
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-first-mention", issueId: "shared-issue", creatorId: "human-1" },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 1; attempt += 1) await Bun.sleep(2);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-second-mention", issueId: "shared-issue", creatorId: "human-1" },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 2; attempt += 1) await Bun.sleep(2);

  assert.equal(runs.length, 2);
  assert.equal(runs[0]?.resumeConversationId, undefined, "the first mention on the issue has nothing to resume");
  assert.equal(runs[1]?.resumeConversationId, "conversation-for-session-first-mention");
});

test("never resumes a conversation whose session is still actively running", async () => {
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createActivity() {},
  } as unknown as LinearClient;
  const runs: AgentTaskPayload[] = [];
  let resolveFirstRun!: (value: { ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number; conversationId: string }) => void;
  const firstRun = new Promise<{ ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number; conversationId: string }>((resolve) => {
    resolveFirstRun = resolve;
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async followUp() { return false; },
    async run(payload: AgentTaskPayload) {
      runs.push(payload);
      if (runs.length === 1) return firstRun;
      // The still-running first session's own second turn - never resolves
      // for the duration of this test.
      return new Promise(() => {});
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-running", issueId: "shared-issue", creatorId: "human-1" },
  });
  resolveFirstRun({ ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1, conversationId: "conversation-in-flight" });
  await controller.handle({
    action: "prompted",
    agentSession: { id: "session-running", issueId: "shared-issue" },
    agentActivity: { content: { body: "Keep going." } },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 2; attempt += 1) await Bun.sleep(2);
  assert.equal(runs.length, 2, "the follow-up should have started a second, still-running turn on session-running");

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-fresh-mention", issueId: "shared-issue", creatorId: "human-1" },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 3; attempt += 1) await Bun.sleep(2);

  assert.equal(runs.length, 3);
  assert.equal(runs[2]?.resumeConversationId, undefined, "session-running is mid-turn, so its conversation must not be shared");
});

test("mentions the issue's assignee on an urgent signal, giving it real notification visibility", async () => {
  const comments: Array<{ issueId: string; body: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createIssueComment(issueId: string, body: string) { comments.push({ issueId, body }); return { id: "comment-1", body }; },
    async issueAssigneeUrl() { return "https://linear.app/acme/profiles/jdoe"; },
    async createActivity() {},
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
    async followUp() { return true; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-signal-urgent", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  const result = await controller.collaborateLinear("session-signal-urgent", {
    action: "attention",
    request: {
      kind: "signal",
      delivery: "queue",
      priority: "urgent",
      title: "Third-party API is flaking",
      action: "Retrying with backoff; noting in case it gets worse.",
      recommendation: "No action needed unless retries start failing outright.",
    },
  });

  assert.deepEqual(result, { ok: true, action: "attention" });
  assert.equal(comments.length, 1);
  assert.match(
    comments[0]!.body,
    /^https:\/\/linear\.app\/acme\/profiles\/jdoe\n\n/,
    "an urgent signal must lead with a bare mention URL so Linear's own parser renders a real @mention and notifies its Inbox",
  );
  assert.match(comments[0]!.body, /\*\*Update:\*\* Third-party API is flaking/);
});

test("does not mention anyone on a routine signal, even when the issue has an assignee", async () => {
  const comments: Array<{ issueId: string; body: string }> = [];
  let assigneeLookups = 0;
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createIssueComment(issueId: string, body: string) { comments.push({ issueId, body }); return { id: "comment-1", body }; },
    async issueAssigneeUrl() { assigneeLookups += 1; return "https://linear.app/acme/profiles/jdoe"; },
    async createActivity() {},
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
    async followUp() { return true; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-signal-routine", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await controller.collaborateLinear("session-signal-routine", {
    action: "attention",
    request: {
      kind: "signal",
      delivery: "queue",
      title: "Switched to a cached dependency list",
      action: "Using the lockfile from main since the branch's own lockfile is stale.",
      recommendation: "No action needed.",
    },
  });

  assert.equal(assigneeLookups, 0, "a routine signal must never even look up the assignee - only urgent ones do");
  assert.equal(comments.length, 1);
  assert.doesNotMatch(comments[0]!.body, /linear\.app/, "a routine signal must stay a plain comment with no mention");
});

test("falls back to a plain comment when an urgent signal's issue has no assignee, or the assignee lookup fails", async () => {
  const comments: Array<{ issueId: string; body: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createIssueComment(issueId: string, body: string) { comments.push({ issueId, body }); return { id: "comment-1", body }; },
    async issueAssigneeUrl() { return null; },
    async createActivity() {},
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
    async followUp() { return true; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-signal-unassigned", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  const result = await controller.collaborateLinear("session-signal-unassigned", {
    action: "attention",
    request: {
      kind: "signal",
      delivery: "queue",
      priority: "urgent",
      title: "Rate limit close to exhausted",
      action: "Slowing down requests to stay under the API's rate limit.",
      recommendation: "No action needed unless the backfill starts timing out.",
    },
  });

  assert.deepEqual(result, { ok: true, action: "attention" });
  assert.equal(comments.length, 1);
  assert.doesNotMatch(comments[0]!.body, /^https:\/\/linear\.app/, "with no assignee the comment must stay plain, no mention prefix");
  assert.match(comments[0]!.body, /\*\*Update:\*\* Rate limit close to exhausted/);

  const failing = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createIssueComment(issueId: string, body: string) { comments.push({ issueId, body }); return { id: "comment-2", body }; },
    async issueAssigneeUrl() { throw new Error("Linear GraphQL request failed: rate limited"); },
    async createActivity() {},
  } as unknown as LinearClient;
  const controllerWithFailingLookup = new AgentController(failing, runner);
  await controllerWithFailingLookup.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-signal-lookup-failure", issueId: "issue-2", creatorId: "human-1", issue: { id: "issue-2", teamId: "team-1" } },
  });
  const secondResult = await controllerWithFailingLookup.collaborateLinear("session-signal-lookup-failure", {
    action: "attention",
    request: {
      kind: "signal",
      delivery: "queue",
      priority: "urgent",
      title: "Rate limit close to exhausted",
      action: "Slowing down requests to stay under the API's rate limit.",
      recommendation: "No action needed unless the backfill starts timing out.",
    },
  });

  assert.deepEqual(secondResult, { ok: true, action: "attention" });
  assert.equal(comments.length, 2);
  assert.doesNotMatch(comments[1]!.body, /^https:\/\/linear\.app/, "a failed assignee lookup must not surface as an error - just skip the mention");
});

test("routes the react action straight to reactToComment with no issue context required", async () => {
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async createActivity() {},
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 }; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({ action: "created", agentSession: { id: "session-react" } });

  const result = await controller.collaborateLinear("session-react", {
    action: "react",
    commentId: "comment-42",
    emoji: "white_check_mark",
  });

  assert.deepEqual(result, { ok: true, action: "react" });
  assert.deepEqual(reactions, [{ commentId: "comment-42", emoji: "white_check_mark" }]);
});

test("does not surface a reactToComment failure - the reaction is best-effort", async () => {
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async createActivity() {},
    async reactToComment() { throw new Error("Linear GraphQL request failed: unknown emoji"); },
  } as unknown as LinearClient;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 }; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({ action: "created", agentSession: { id: "session-react-failure" } });

  const result = await controller.collaborateLinear("session-react-failure", {
    action: "react",
    commentId: "comment-42",
    emoji: "not-a-real-emoji",
  });

  assert.deepEqual(result, { ok: true, action: "react" });
});
