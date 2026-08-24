import assert from "node:assert/strict";
import { test } from "bun:test";
import { AgentController } from "../src/controller.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";

// The controller posts its own "Setting up the workspace for..." ephemeral thought as soon as a
// session starts (see start()); every test here ignores it rather than trying to race it, since
// it isn't what these tests are about.
const STARTUP_NOISE = "Setting up the workspace for this Linear session…";

function baseLinear(overrides: Partial<LinearClient>): LinearClient {
  return {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async repositorySuggestions() { return []; },
    async issueState() { return { id: "state-in-progress", name: "In Progress", type: "started" }; },
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState() {},
    async addExternalUrl() {},
    ...overrides,
  } as unknown as LinearClient;
}

function idleRunner(): AgentRunner {
  return {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
}

async function primedController(linear: LinearClient, sessionId = "session-1", issueId = "issue-1"): Promise<AgentController> {
  const controller = new AgentController(linear, idleRunner());
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: sessionId, issueId, creatorId: "human-1", issue: { id: issueId, teamId: "team-1" } },
  });
  return controller;
}

test("queues Activity posts per session so a slow earlier post is delivered to Linear before a faster later one", async () => {
  const invoked: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const linear = baseLinear({
    async createActivity(_sessionId: string, content: { type?: string; body?: string }) {
      if (content.body === STARTUP_NOISE) return;
      invoked.push(content.type ?? "unknown");
      if (content.body === "narration in flight") await firstGate;
    },
  });
  const controller = await primedController(linear);

  const firstCall = controller.collaborateLinear("session-1", {
    action: "activity",
    content: { type: "thought", body: "narration in flight" },
  });
  await Bun.sleep(5);
  assert.deepEqual(invoked, ["thought"], "the narration post should already be in flight, blocked on firstGate");

  const secondCall = controller.collaborateLinear("session-1", {
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
  await Bun.sleep(5);
  assert.deepEqual(invoked, ["thought"], "the elicitation must not reach Linear while an earlier post for the same session is still pending");

  releaseFirst();
  await firstCall;
  await secondCall;
  assert.deepEqual(invoked, ["thought", "elicitation"], "once released, the earlier post lands before the later one - true submission order, not completion order");
});

test("does not block one session's activity posts on another session's slow one", async () => {
  const invoked: string[] = [];
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
  const linear = baseLinear({
    async createActivity(sessionId: string, content: { type?: string; body?: string }) {
      if (content.body === STARTUP_NOISE) return;
      invoked.push(`${sessionId}:${content.type}`);
      if (sessionId === "session-slow") await slowGate;
    },
  });
  const controller = await primedController(linear, "session-slow", "issue-1");
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-fast", issueId: "issue-2", creatorId: "human-1", issue: { id: "issue-2", teamId: "team-1" } },
  });

  const slowCall = controller.collaborateLinear("session-slow", { action: "activity", content: { type: "thought", body: "x" } });
  await Bun.sleep(5);
  await controller.collaborateLinear("session-fast", { action: "activity", content: { type: "thought", body: "y" } });

  assert.deepEqual(invoked, ["session-slow:thought", "session-fast:thought"], "the unrelated session's post must complete without waiting on the slow session's queue");
  releaseSlow();
  await slowCall;
});

test("a failed earlier post does not poison the queue for a later post on the same session", async () => {
  const invoked: string[] = [];
  const linear = baseLinear({
    async createActivity(_sessionId: string, content: { type?: string; body?: string }) {
      if (content.body === STARTUP_NOISE) return;
      invoked.push(content.body ?? "unknown");
      if (content.body === "fails") throw new Error("Linear rejected the activity");
    },
  });
  const controller = await primedController(linear);

  await assert.rejects(controller.collaborateLinear("session-1", { action: "activity", content: { type: "error", body: "fails" } }));
  await controller.collaborateLinear("session-1", { action: "activity", content: { type: "thought", body: "succeeds" } });

  assert.deepEqual(invoked, ["fails", "succeeds"]);
});
