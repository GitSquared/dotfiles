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
    async resolveComment() {},
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
  const resolvedComments: string[] = [];
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) { return { id: "ask-comment-1", body }; },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
    async resolveComment(commentId: string) { resolvedComments.push(commentId); },
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
  assert.deepEqual(resolvedComments, ["ask-comment-1"], "the answered ask's own tracked thread must be resolved (GAB-22)");
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

test("surfaces still-open asks in the QA comment's body, and keeps the elicitation to a one-liner", async () => {
  const activities: Array<{ type?: string; body?: string }> = [];
  const comments: string[] = [];
  let askCommentIssued = false;
  const linear = baseLinear({
    async createIssueComment(_issueId: string, body: string) {
      // The ask itself creates a comment first; only the later QA comment matters here.
      if (!askCommentIssued) { askCommentIssued = true; return { id: "ask-comment-1", body }; }
      comments.push(body);
      return { id: "attention-comment-1", body };
    },
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

  assert.match(comments[0] ?? "", /Still waiting on:/);
  assert.match(comments[0] ?? "", /Should this endpoint be paginated\?/);
  const elicitation = activities.find((activity) => activity.type === "elicitation");
  assert.doesNotMatch(elicitation?.body ?? "", /Still waiting on:/, "the elicitation stays a one-liner - open asks belong in the comment");
});

test("posts a real, tracked comment alongside a blocking QA elicitation, and approving it via that comment completes the issue", async () => {
  const comments: Array<{ issueId: string; body: string }> = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const completedIssues: string[] = [];
  const resolvedComments: string[] = [];
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
    async resolveComment(commentId: string) { resolvedComments.push(commentId); },
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
  assert.deepEqual(resolvedComments, ["attention-comment-1"], "the answered QA thread must be resolved once approved (GAB-22)");
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 0);
});

test("a non-approval reply to the tracked attention comment restores issue status and resumes, without completing the issue", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const completedIssues: string[] = [];
  const resolvedComments: string[] = [];
  const linear = baseLinear({
    async createIssueComment() { return { id: "attention-comment-1", body: "" }; },
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async completeIssue(issueId: string) { completedIssues.push(issueId); },
    async resolveComment(commentId: string) { resolvedComments.push(commentId); },
  });
  // The turn that requested the attention is still live throughout (matches production: a
  // task's Claude Agent SDK subprocess stays running while blocked on collaborateLinear mid-
  // turn) - a reply while state.running is true is injected via followUp(), not a fresh
  // run(), and this same run() promise is what eventually resolves once that turn wraps up.
  let finishRun!: (value: { ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number }) => void;
  const run = new Promise<{ ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number }>((resolve) => {
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
  // GAB-26: a reply is only acknowledged, not resolved, the instant it lands - the issue must
  // not drop out of its attention state, and the tracked thread must not resolve, until the
  // resumed turn this reply feeds actually concludes without needing to raise a fresh
  // attention of its own.
  assert.deepEqual(stateFlips, [{ issueId: "issue-1", stateId: "state-blocked" }],
    "a bare reply must not immediately restore issue status (GAB-25/GAB-26)");
  assert.deepEqual(resolvedComments, [], "a bare reply must not immediately resolve the tracked thread either (GAB-25/GAB-26)");

  finishRun({ ok: true, timedOut: false, awaitingInput: false, summary: "Kept the old writer, added a rollback plan.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  assert.deepEqual(completedIssues, []);
  assert.deepEqual(stateFlips, [
    { issueId: "issue-1", stateId: "state-blocked" },
    { issueId: "issue-1", stateId: "state-in-progress" },
  ], "the deferred restore fires once the resumed turn concludes cleanly");
  assert.deepEqual(resolvedComments, ["attention-comment-1"], "the Steering thread was still answered/acted on, even though QA wasn't approved (GAB-22)");
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

test("does not auto-start a queued follow-up the instant a run ends by opening a blocking attention (GAB-15)", async () => {
  // Reproduces a real crash: an ask's reply arrives while the main run is still going, gets
  // queued (state.pending) since the session is busy; the run then finishes by requesting a
  // blocking QA. Auto-starting the queued follow-up immediately gave that new turn nothing to
  // do but discover the "already open" collision (a second request_attention is rejected) and
  // fail to conclude cleanly - "Claude ended without a structured work disposition."
  const linear = baseLinear({
    async createIssueComment() { return { id: "attention-comment-1", body: "" }; },
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState() {},
  });
  let finishRun!: (value: { ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }) => void;
  const pendingRun = new Promise<{ ok: true; timedOut: false; awaitingInput: true; summary: string; elapsedMs: number }>((resolve) => {
    finishRun = resolve;
  });
  let runs = 0;
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { runs += 1; return pendingRun; },
    async followUp() { return false; }, // not injected into the active run - queued instead
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });

  // While the run is still active: a follow-up arrives (e.g. an ask's reply) and gets queued.
  await controller.handle({
    action: "prompted",
    agentSession: { id: "session-1", issueId: "issue-1", comment: { id: "reply-1", body: "Keep it silent." } },
    agentActivity: { content: { body: "Keep it silent." } },
  });

  // The run itself requests a blocking QA before finishing (as the actual GAB-15 run did).
  await controller.collaborateLinear("session-1", {
    action: "attention",
    request: {
      kind: "qa",
      delivery: "queue",
      priority: "medium",
      title: "Ready for review",
      action: "Approve the preview and complete the parent work.",
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

  assert.equal(runs, 1, "the queued follow-up must not auto-start a doomed second turn while the blocking QA is still open");
  const health = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(health.controller.attentionQueue.total, 1, "the QA itself must still be tracked as open");
});

test("threads a mid-discussion follow-up attention as a reply under the original tracked comment, and resolves only once the discussion genuinely concludes (GAB-24/GAB-26)", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const reactions: Array<{ commentId: string; emoji: string }> = [];
  const resolvedComments: string[] = [];
  const topLevelComments: Array<{ issueId: string; body: string }> = [];
  const replies: Array<{ issueId: string; parentId: string; body: string }> = [];
  let issueStateCalls = 0;
  const linear = baseLinear({
    async issueState() { issueStateCalls += 1; return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment(issueId: string, body: string) {
      topLevelComments.push({ issueId, body });
      return { id: "root-comment-1", body };
    },
    async replyToIssueComment(issueId: string, parentId: string, body: string) {
      replies.push({ issueId, parentId, body });
      return { id: `reply-comment-${replies.length}`, body };
    },
    async reactToComment(commentId: string, emoji: string) { reactions.push({ commentId, emoji }); },
    async resolveComment(commentId: string) { resolvedComments.push(commentId); },
  });
  // The turn that opened the first attention stays live throughout (matches production: the
  // task's Claude Agent SDK subprocess keeps running while blocked on collaborateLinear
  // mid-turn) - every reply below is injected via followUp(), and this one run() promise is
  // what eventually resolves once the whole discussion wraps up.
  let finishRun!: (value: { ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number }) => void;
  const run = new Promise<{ ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number }>((resolve) => {
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
  assert.equal(topLevelComments.length, 1, "the first attention in a fresh discussion opens a real top-level comment");
  assert.equal(issueStateCalls, 1);
  assert.deepEqual(stateFlips, [{ issueId: "issue-1", stateId: "state-blocked" }]);

  // The human replies with a genuine question, not a decision.
  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "What happens to in-flight writes during the cutover?" } },
    agentSession: { id: "session-1", comment: { id: "reply-1", body: "What happens to in-flight writes during the cutover?" } },
  });
  assert.deepEqual(reactions, [{ commentId: "reply-1", emoji: "white_check_mark" }], "the reply is acknowledged immediately");
  assert.deepEqual(stateFlips, [{ issueId: "issue-1", stateId: "state-blocked" }],
    "GAB-26: a bare reply must not immediately restore issue status");
  assert.deepEqual(resolvedComments, [], "GAB-26: a bare reply must not immediately resolve the tracked thread");

  // The resumed turn answers the question but needs to keep discussing - it raises a fresh
  // Steering attention of its own, mid-turn, on the same still-running session.
  await controller.collaborateLinear("session-1", {
    action: "attention",
    request: {
      kind: "steering",
      delivery: "queue",
      priority: "medium",
      title: "In-flight writes during cutover",
      action: "In-flight writes would be dropped unless we drain first - drain before cutover, or accept the loss?",
      recommendation: "Drain first.",
    },
  });
  assert.equal(issueStateCalls, 1, "GAB-26: a continuation must reuse the discussion's original previousStateId, not re-query the issue's current (attention) state");
  assert.equal(topLevelComments.length, 1, "GAB-24: a continuation must not open a disconnected new top-level comment");
  assert.equal(replies.length, 1, "GAB-24: the continuation threads a reply under the discussion's own root comment");
  assert.equal(replies[0]?.issueId, "issue-1");
  assert.equal(replies[0]?.parentId, "root-comment-1");
  assert.match(replies[0]?.body ?? "", /In-flight writes during cutover/);
  // Opening any attention always (re-)flips the issue into the attention state - harmless
  // and idempotent from Linear's point of view, and unrelated to the GAB-26 restore, which
  // only ever needs to fire once the whole discussion is actually settled.
  assert.deepEqual(stateFlips, [
    { issueId: "issue-1", stateId: "state-blocked" },
    { issueId: "issue-1", stateId: "state-blocked" },
  ]);

  // The human answers that second question too - still just discussion, still deferred.
  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "Drain first." } },
    agentSession: { id: "session-1", comment: { id: "reply-2", body: "Drain first." } },
  });
  assert.deepEqual(stateFlips, [
    { issueId: "issue-1", stateId: "state-blocked" },
    { issueId: "issue-1", stateId: "state-blocked" },
  ], "still no restore - the discussion is still open");
  assert.deepEqual(resolvedComments, []);

  // Only now does the resumed turn actually conclude, without raising yet another attention.
  finishRun({ ok: true, timedOut: false, awaitingInput: false, summary: "Draining before cutover, as decided.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = await controller.health() as { controller: { runningSessions: number } };
    if (health.controller.runningSessions === 0) break;
    await Bun.sleep(2);
  }

  assert.deepEqual(stateFlips, [
    { issueId: "issue-1", stateId: "state-blocked" },
    { issueId: "issue-1", stateId: "state-blocked" },
    { issueId: "issue-1", stateId: "state-in-progress" },
  ], "the whole discussion settles at once, restoring the issue's ORIGINAL pre-attention state");
  assert.deepEqual(resolvedComments, ["root-comment-1"], "only the discussion's single root thread is resolved, not each individual reply");
});

test("restores issue status when the run is stopped mid-discussion, even though no attention is currently open (GAB-26)", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const resolvedComments: string[] = [];
  const linear = baseLinear({
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment() { return { id: "root-comment-1", body: "" }; },
    async resolveComment(commentId: string) { resolvedComments.push(commentId); },
  });
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); }, // the turn that opened the attention never returns on its own
    async followUp() { return true; },
    async abort() { return true; },
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

  // The human's reply defers resolution instead of resolving it immediately (GAB-26) - the
  // session is left with no currently-open attention (state.attention.length === 0) but a
  // still-pending discussion.
  await controller.handle({
    action: "prompted",
    agentActivity: { content: { body: "What happens to in-flight writes?" } },
    agentSession: { id: "session-1", comment: { id: "reply-1", body: "What happens to in-flight writes?" } },
  });
  const midDiscussion = await controller.health() as { controller: { attentionQueue: { total: number } } };
  assert.equal(midDiscussion.controller.attentionQueue.total, 0, "no attention is currently open while the deferred discussion is mid-flight");

  // The human stops the run before it ever answers.
  await controller.handle({ action: "stop", agentSession: { id: "session-1" } });

  assert.deepEqual(stateFlips, [
    { issueId: "issue-1", stateId: "state-blocked" },
    { issueId: "issue-1", stateId: "state-in-progress" },
  ], "stopping mid-discussion must still restore the issue out of its attention state, not leave it stuck in 'In Review' forever");
  assert.deepEqual(resolvedComments, [], "a stopped session's still-open question stays visible, matching dismissAttention's own convention");
});
