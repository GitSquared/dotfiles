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
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment(issueId: string, body: string) { comments.push({ issueId, body }); return { id: "comment-1", body }; },
    async createActivity(_sessionId: string, content: unknown, options?: unknown) {
      activities.push({ content, ...(options ? { options } : {}) });
    },
  } as unknown as LinearClient;
  let finishRun: ((value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void) | undefined;
  const run = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
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
      originalIntent: "Migrate without losing writes.",
      delta: "The proposed writer cannot dual-write atomically.",
      recommendation: "Keep the old writer until verification passes.",
      impact: "An immediate cutover can lose customer writes.",
      timing: "Answer before the cutover; implementation is paused safely.",
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
  assert.equal(comments.length, 0, "blocking Steering/QA no longer posts a standalone comment - only the elicitation Activity");
  const elicitation = activities.find((activity) => (activity.content as { body?: string }).body?.includes("Steering needed"));
  const elicitationBody = (elicitation?.content as { body?: string }).body ?? "";
  assert.match(elicitationBody, /\*\*Steering needed:\*\* A destructive migration needs a boundary/);
  assert.doesNotMatch(elicitationBody, /Original intent/, "the elicitation must use the terse render, not the bureaucratic full template");
  assert.deepEqual((elicitation?.options as { signal?: string }).signal, "select");

  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "Keep the old writer." } },
    agentSession: { id: "session-attention", comment: { id: "reply-1", body: "Keep the old writer." } },
  });
  const resumed = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(resumed.controller.attentionQueue.total, 0);
  assert.deepEqual(stateFlips[1], { issueId: "issue-1", stateId: "state-in-progress" });
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }]);
  finishRun?.({ ok: true, timedOut: false, awaitingInput: true, summary: "Waiting", elapsedMs: 1 });
});

test("posts an access-repair Steering request with the native auth signal", async () => {
  const activities: Array<{ content: unknown; options?: unknown }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment() {},
    async setIssueState() {},
    async createIssueComment() { return { id: "comment-1", body: "" }; },
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
      originalIntent: "Implement the requested change.",
      delta: "The bash tool cannot reach the private repository without a GitHub credential.",
      recommendation: "Link the GitHub account from the workbench.",
      impact: "No further implementation work is possible until access is restored.",
      timing: "Before implementation can continue.",
      accessRepair: { url: "https://straylight.example.test/linear/tools/auth", providerName: "GitHub" },
    },
  });

  const elicitation = activities.find((activity) => (activity.content as { body?: string }).body?.includes("Steering needed"));
  const options = elicitation?.options as { signal?: string; signalMetadata?: { url?: string; providerName?: string } };
  assert.deepEqual(options.signal, "auth");
  assert.deepEqual(options.signalMetadata, { url: "https://straylight.example.test/linear/tools/auth", providerName: "GitHub" });
  const elicitationBody = (elicitation?.content as { body?: string }).body ?? "";
  assert.match(elicitationBody, /\[GitHub\]\(https:\/\/straylight\.example\.test\/linear\/tools\/auth\)/);
});

test("resumes the paused parent run directly when the engineer replies on the same issue", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async reactToComment() {},
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
      originalIntent: "Migrate without losing writes.",
      delta: "Both boundaries are now technically viable.",
      recommendation: "Keep the old writer authoritative.",
      impact: "Implementation cannot safely choose ownership without this.",
      timing: "Before implementation resumes.",
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
      originalIntent: "Migrate without losing writes.",
      delta: "Both boundaries are now technically viable.",
      recommendation: "Keep the old writer authoritative.",
      impact: "Implementation cannot safely choose ownership without this.",
      timing: "Before implementation resumes.",
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
      originalIntent: "Fix the broken interaction.",
      delta: "The fix and focused checks are ready.",
      recommendation: "Approve after checking the linked preview.",
      impact: "The parent work remains open until ownership is accepted.",
      timing: "At the next normal review window.",
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
      originalIntent: "Call the billing API to reconcile invoices.",
      delta: "The billing API returned 503 twice; retries are succeeding so far.",
      recommendation: "No action needed unless retries start failing outright.",
      impact: "None yet; the run is continuing on schedule.",
      timing: "Informational only.",
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
      originalIntent: "Install dependencies for the build.",
      delta: "The branch's lockfile predates a recent dependency bump.",
      recommendation: "No action needed.",
      impact: "None; the build will use up-to-date, compatible versions.",
      timing: "Informational only.",
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
      originalIntent: "Backfill historical records via the vendor API.",
      delta: "The vendor's rate limit is tighter than expected for this account tier.",
      recommendation: "No action needed unless the backfill starts timing out.",
      impact: "The backfill will simply take longer than planned.",
      timing: "Informational only.",
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
      originalIntent: "Backfill historical records via the vendor API.",
      delta: "The vendor's rate limit is tighter than expected for this account tier.",
      recommendation: "No action needed unless the backfill starts timing out.",
      impact: "The backfill will simply take longer than planned.",
      timing: "Informational only.",
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
