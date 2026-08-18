import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import { AgentController } from "../src/controller.js";
import { ControllerStateStore } from "../src/controller-state.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";
import type { AgentTaskPayload } from "../src/types.js";

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
        delivery: "queue",
        priority: "medium",
        blocking: true,
        issueId: "attention-issue-1",
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

test("tracks rationalized attention across the fleet and clears it on follow-up", async () => {
  const activities: Array<{ content: unknown; options?: unknown }> = [];
  let attentionAssignee: string | undefined;
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createAttentionIssue(_issueId: string, _request: unknown, humanAssigneeId?: string) {
      attentionAssignee = humanAssigneeId;
      return { id: "attention-issue-1", identifier: "LIN-2", title: "Migration boundary", url: "https://linear.app/acme/issue/LIN-2" };
    },
    async createAgentSessionOnIssue() { return { id: "attention-session-1" }; },
    async completeIssue() {},
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
    agentSession: { id: "session-attention", issueId: "issue-1", creatorId: "human-1" },
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
    controller: { attentionQueue: { total: number; interrupts: number; queued: number; steering: number; qa: number; unclassifiedAwaitingInput: number; oldestWaitMs: number } };
  };
  assert.equal(waiting.controller.attentionQueue.total, 1);
  assert.equal(waiting.controller.attentionQueue.interrupts, 1);
  assert.equal(waiting.controller.attentionQueue.queued, 0);
  assert.equal(waiting.controller.attentionQueue.steering, 1);
  assert.equal(waiting.controller.attentionQueue.qa, 0);
  assert.equal(waiting.controller.attentionQueue.unclassifiedAwaitingInput, 0);
  assert.equal(attentionAssignee, "human-1");
  assert.ok(waiting.controller.attentionQueue.oldestWaitMs >= 0);
  const childElicitation = activities.find((activity) => (activity.content as { body?: string }).body?.includes("Your action"));
  assert.match((childElicitation?.content as { body?: string }).body ?? "", /Your action/);
  assert.deepEqual((childElicitation?.options as { signal?: string }).signal, "select");

  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "Keep the old writer." } },
    agentSession: { id: "session-attention" },
  });
  const resumed = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(resumed.controller.attentionQueue.total, 0);
  finishRun?.({ ok: true, timedOut: false, awaitingInput: true, summary: "Waiting", elapsedMs: 1 });
});

test("routes a blocking child-issue response back into the paused parent run", async () => {
  const activities: Array<{ sessionId: string; content: unknown }> = [];
  const completedIssues: string[] = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createAttentionIssue() {
      return { id: "attention-issue-2", identifier: "LIN-3", title: "Choose the boundary", url: "https://linear.app/acme/issue/LIN-3" };
    },
    async createAgentSessionOnIssue() { return { id: "attention-session-2" }; },
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
    async createActivity(sessionId: string, content: unknown) { activities.push({ sessionId, content }); },
    async agentSessionSnapshot() {
      return {
        id: "parent-session",
        status: "awaitingInput",
        appUser: { id: "agent-1" },
        creator: { id: "human-1" },
        issue: { id: "parent-issue", identifier: "LIN-1", title: "Parent work", team: { id: "team-1" } },
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
      return { ok: true as const, timedOut: false as const, awaitingInput: false, summary: "Resumed.", elapsedMs: 1 };
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "parent-session", issueId: "parent-issue", creatorId: "human-1" },
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
    agentSession: { id: "attention-session-2", issueId: "attention-issue-2" },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 2; attempt += 1) await Bun.sleep(2);

  assert.equal(runs.length, 2);
  assert.match(runs[1]?.agentActivity?.content?.body ?? "", /Human response from attention issue LIN-3/);
  assert.match(runs[1]?.agentActivity?.content?.body ?? "", /Keep the old writer authoritative/);
  assert.deepEqual(completedIssues, ["attention-issue-2"]);
  assert.equal(activities.some((activity) => activity.sessionId === "attention-session-2"
    && (activity.content as { type?: string }).type === "response"), true);
});
