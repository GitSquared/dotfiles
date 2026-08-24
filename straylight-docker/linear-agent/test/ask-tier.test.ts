import assert from "node:assert/strict";
import { test } from "bun:test";
import { AgentController } from "../src/controller.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";

function baseLinear(overrides: Partial<LinearClient>): LinearClient {
  return {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async repositorySuggestions() { return []; },
    async createActivity() {},
    async addExternalUrl() {},
    async reactToComment() {},
    ...overrides,
  } as unknown as LinearClient;
}

// Every real run is fire-and-forget from handle()'s point of view (start() flips
// state.running synchronously, then calls execute() without awaiting it, so
// runner.run() itself - inside execute(), past several of its own awaited steps -
// lands several microtask turns later). Poll the actual signal being asserted on
// rather than state.running, which flips before runner.run() is ever reached.
async function waitForRunningSessions(controller: AgentController, expected: number, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === expected) return;
    await Bun.sleep(2);
  }
  assert.fail(`runningSessions never reached ${expected}`);
}

async function waitForCount(getCount: () => number, expected: number, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (getCount() === expected) return;
    await Bun.sleep(2);
  }
  assert.fail(`count never reached ${expected}, still ${getCount()}`);
}

test("posts a tracked comment for a non-blocking ask, without registering as a blocking attention", async () => {
  const comments: string[] = [];
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) {
      comments.push(body);
      return { id: "ask-comment-1", body };
    },
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });

  const result = await controller.collaborateLinear("session-1", { action: "ask", question: "Should this endpoint be paginated?" });

  assert.deepEqual(comments, ["Should this endpoint be paginated?"]);
  assert.deepEqual(result.data, { commentId: "ask-comment-1" });
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 0, "an ask must never register as a blocking attention");
});

test("resumes the agent when a reply lands on a tracked ask thread, and clears it", async () => {
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) { return { id: "ask-comment-1", body }; },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
  });
  let finishFirstRun!: (value: { ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number }) => void;
  const firstRun = new Promise<{ ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number }>((resolve) => {
    finishFirstRun = resolve;
  });
  let runs = 0;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() {
      runs += 1;
      return runs === 1 ? firstRun : new Promise(() => {});
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });

  await controller.collaborateLinear("session-1", { action: "ask", question: "Should this endpoint be paginated?" });

  // Let the first run finish so the session is idle - a reply to a tracked, non-blocking
  // ask should resume it with a fresh turn, the same way it would if nothing were tracked.
  finishFirstRun({ ok: true, timedOut: false, awaitingInput: false, summary: "Nothing further to do yet.", elapsedMs: 1 });
  await waitForRunningSessions(controller, 0);

  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-1",
      comment: { id: "reply-1", parentId: "ask-comment-1", body: "No, keep it a single page." },
    },
  });
  await waitForCount(() => runs, 2);

  assert.equal(runs, 2, "the reply must start a fresh turn, not be dropped");
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }]);
  const health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.agentSessionOwned, 1);
  assert.equal(health.controller.notifications.counts.contextOnly ?? 0, 0);
});

test("leaves an unrelated comment reply as context-only", async () => {
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) { return { id: "ask-comment-1", body }; },
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await controller.collaborateLinear("session-1", { action: "ask", question: "Should this endpoint be paginated?" });

  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-2",
      comment: { id: "reply-2", parentId: "some-other-comment", body: "Unrelated note." },
    },
  });

  const health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.contextOnly, 1);
  assert.equal(health.controller.notifications.counts.agentSessionOwned ?? 0, 0);
});

test("does not resume through a reply to a tracked ask while a blocking Steering/QA is open on the same session", async () => {
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) { return { id: "ask-comment-1", body }; },
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState() {},
  });
  let runs = 0;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { runs += 1; return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await waitForRunningSessions(controller, 1);

  await controller.collaborateLinear("session-1", { action: "ask", question: "Should this endpoint be paginated?" });
  await controller.collaborateLinear("session-1", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "queue",
      priority: "medium",
      title: "Pick a boundary",
      action: "Decide the migration boundary before continuing.",
      recommendation: "Keep the old writer authoritative.",
    },
  });

  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-1",
      comment: { id: "reply-1", parentId: "ask-comment-1", body: "No, keep it a single page." },
    },
  });

  assert.equal(runs, 1, "must not start a second run while a blocking Steering is open");
  const health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.contextOnly, 1, "must fall through to context-only rather than fight the open Steering");
});

test("injects the reply as a follow-up, without starting a new run, when the session is actively running", async () => {
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) { return { id: "ask-comment-1", body }; },
  });
  let runs = 0;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { runs += 1; return new Promise(() => {}); }, // never resolves - session stays "running"
    async followUp() { return true; }, // injected into the active run, not queued
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await waitForRunningSessions(controller, 1);

  await controller.collaborateLinear("session-1", { action: "ask", question: "Should this endpoint be paginated?" });
  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-1",
      comment: { id: "reply-1", parentId: "ask-comment-1", body: "No, keep it a single page." },
    },
  });

  assert.equal(runs, 1, "the running turn absorbs the follow-up; runner.run() must not be called again");
  const health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.agentSessionOwned, 1);
});

test("restores a tracked ask if resuming the agent with its reply fails, instead of losing it", async () => {
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) { return { id: "ask-comment-1", body }; },
  });
  let shouldFail = true;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); }, // never resolves - session stays "running"
    async followUp() {
      if (shouldFail) throw new Error("simulated relay failure");
      return true;
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await waitForRunningSessions(controller, 1);
  await controller.collaborateLinear("session-1", { action: "ask", question: "Should this endpoint be paginated?" });

  const replyPayload = {
    type: "AppUserNotification" as const,
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-1",
      comment: { id: "reply-1", parentId: "ask-comment-1", body: "No, keep it a single page." },
    },
  };
  await assert.doesNotReject(controller.handleNotification(replyPayload), "a failed resume must not escape as an unhandled rejection");
  let health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.contextOnly, 1, "the failed attempt falls through to context-only, not silently succeeding");

  // The ask must have been restored - a second attempt (this time succeeding) still finds it.
  shouldFail = false;
  await controller.handleNotification(replyPayload);
  health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.agentSessionOwned, 1, "the restored ask must still be there for a later retry to match");
});

test("ignores a reply notification attributed to the app's own user id", async () => {
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) { return { id: "ask-comment-1", body }; },
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await controller.collaborateLinear("session-1", { action: "ask", question: "Should this endpoint be paginated?" });

  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-1",
      actorId: "agent-1",
      comment: { id: "reply-1", parentId: "ask-comment-1", body: "Self-authored, must not self-trigger." },
    },
  });

  const health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.contextOnly, 1);
  assert.equal(health.controller.notifications.counts.agentSessionOwned ?? 0, 0);
});

test("surfaces still-open asks in a QA elicitation's body", async () => {
  const activities: Array<{ type?: string; body?: string }> = [];
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) { return { id: "ask-comment-1", body }; },
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState() {},
    async createActivity(_sessionId: string, content: { type?: string; body?: string }) { activities.push(content); },
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });

  await controller.collaborateLinear("session-1", { action: "ask", question: "Should this endpoint be paginated?" });
  await controller.collaborateLinear("session-1", {
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

  const elicitation = activities.find((activity) => activity.type === "elicitation");
  assert.match(elicitation?.body ?? "", /Still waiting on:/);
  assert.match(elicitation?.body ?? "", /Should this endpoint be paginated\?/);
});

test("posts a real, tracked comment alongside a blocking QA elicitation, and approving it via that comment completes the issue", async () => {
  const comments: Array<{ issueId: string; body: string }> = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const completedIssues: string[] = [];
  const linear = baseLinear({
    async createIssueComment(issueId: string, body: string) {
      comments.push({ issueId, body });
      return { id: "attention-comment-1", body };
    },
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState() {},
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });

  await controller.collaborateLinear("session-1", {
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
  assert.equal(comments.length, 1, "the tracked comment must exist for a reply to land on");

  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-1",
      comment: { id: "reply-1", parentId: "attention-comment-1", body: "approve" },
    },
  });

  assert.deepEqual(completedIssues, ["issue-1"], "a reply to the tracked attention comment must resolve QA exactly like a native elicitation reply");
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }]);
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 0);
});

test("a non-approval reply to the tracked attention comment restores issue status and resumes, without completing the issue", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const completedIssues: string[] = [];
  const linear = baseLinear({
    async createIssueComment() { return { id: "attention-comment-1", body: "" }; },
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
  });
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
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await controller.collaborateLinear("session-1", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "queue",
      priority: "medium",
      title: "Pick a boundary",
      action: "Decide the migration boundary before continuing.",
      recommendation: "Keep the old writer authoritative.",
    },
  });

  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-1",
      comment: { id: "reply-1", parentId: "attention-comment-1", body: "Keep the old writer, but add a rollback plan." },
    },
  });

  assert.deepEqual(completedIssues, []);
  assert.deepEqual(stateFlips, [
    { issueId: "issue-1", stateId: "state-blocked" },
    { issueId: "issue-1", stateId: "state-in-progress" },
  ]);
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 0);
});

test("ignores a self-authored reply to the tracked attention comment", async () => {
  const linear = baseLinear({
    async createIssueComment() { return { id: "attention-comment-1", body: "" }; },
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState() {},
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  await controller.collaborateLinear("session-1", {
    action: "attention",
    request: {
      kind: "qa",
      delivery: "queue",
      priority: "medium",
      title: "Review the checked fix",
      action: "Approve the preview and complete the parent work.",
      recommendation: "Approve after checking the linked preview.",
      evidence: [{ label: "Preview", url: "https://preview.example.test/fix" }],
    },
  });

  await controller.handleNotification({
    type: "AppUserNotification",
    action: "issueNewComment",
    appUserId: "agent-1",
    notification: {
      issueId: "issue-1",
      commentId: "reply-1",
      actorId: "agent-1",
      comment: { id: "reply-1", parentId: "attention-comment-1", body: "approve" },
    },
  });

  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 1, "a self-authored comment must never resolve the attention it's attached to");
});
