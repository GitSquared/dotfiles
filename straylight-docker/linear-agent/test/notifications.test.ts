import assert from "node:assert/strict";
import { test } from "bun:test";
import { AgentController } from "../src/controller.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";
import { PermanentWebhookDeliveryError } from "../src/webhook-inbox.js";

test("routes Linear inbox notifications without synthesizing comment instructions", async () => {
  let promotedComment: string | undefined;
  const linear = {
    async issueState() { return { id: "state-1", name: "In Progress", type: "started" }; },
    async createAgentSessionOnComment(commentId: string) {
      promotedComment = commentId;
      return { id: "document-session-1" };
    },
  } as unknown as LinearClient;
  const runner = {
    async health() { return { mode: "test" }; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handleNotification({ action: "issueMention", notification: { issueId: "issue-1" } });
  await controller.handleNotification({ action: "issueNewComment", notification: { issueId: "issue-1" } });
  await controller.handleNotification({ action: "issueCommentReaction", notification: { issueId: "issue-1" } });
  await controller.handleNotification({ action: "issueAssignedToYou", notification: { issueId: "issue-1" } });
  await controller.handleNotification({ action: "issueStatusChanged", notification: { issueId: "issue-1" } });
  await controller.handleNotification({ action: "documentSubscribed", notification: { documentId: "document-1" } });
  await controller.handleNotification({
    action: "documentCommentMention",
    notification: { documentId: "document-1", commentId: "reply-1", parentCommentId: "root-1" },
  });
  await controller.handleNotification({ action: "documentCommentCreated", notification: { documentId: "document-1" } });
  await controller.handleNotification({ action: "documentContentUpdated", notification: { documentId: "document-1" } });

  const health = await controller.health() as {
    controller: { notifications: { counts: Record<string, number> } };
  };
  assert.deepEqual(health.controller.notifications.counts, {
    agentSessionOwned: 2,
    contextOnly: 3,
    acknowledgement: 1,
    cancellation: 0,
    lifecycle: 3,
    unknown: 0,
  });
  assert.equal(promotedComment, "root-1");
});

test("classifies Linear's unsupported Document comment anchor as permanent", async () => {
  const linear = {
    async createAgentSessionOnComment() {
      throw new Error("Linear GraphQL request failed: comment must be on an issue: Agent sessions can only be created for comment threads on issues.");
    },
  } as unknown as LinearClient;
  const runner = { async health() { return { mode: "test" }; } } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await assert.rejects(
    controller.handleNotification({
      action: "documentCommentMention",
      notification: { documentId: "document-1", commentId: "comment-1", parentCommentId: "root-1" },
    }),
    PermanentWebhookDeliveryError,
  );
});

test("tells the human why a Document mention did nothing, when the Document links an issue", async () => {
  const comments: Array<{ issueId: string; body: string }> = [];
  const linear = {
    async createAgentSessionOnComment() {
      throw new Error("Linear GraphQL request failed: comment must be on an issue: Agent sessions can only be created for comment threads on issues.");
    },
    async createIssueComment(issueId: string, body: string) {
      comments.push({ issueId, body });
      return { id: "fallback-comment-1", body };
    },
  } as unknown as LinearClient;
  const runner = { async health() { return { mode: "test" }; } } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await assert.rejects(
    controller.handleNotification({
      action: "documentCommentMention",
      notification: {
        documentId: "document-1",
        commentId: "comment-1",
        parentCommentId: "root-1",
        issueId: "issue-1",
        comment: { id: "comment-1", body: "does that consume API pricing or subscription usage?" },
      },
    }),
    PermanentWebhookDeliveryError,
  );

  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.issueId, "issue-1");
  assert.match(comments[0]?.body ?? "", /doesn't yet support Agent Sessions on Document comment threads/);
  assert.match(comments[0]?.body ?? "", /does that consume API pricing or subscription usage\?/);
});

test("treats issueStatusChangedAll the same as issueStatusChanged for the close-on-completion safety net", async () => {
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createActivity() {},
    async issueState() { return { id: "state-done", name: "Done", type: "completed" }; },
  } as unknown as LinearClient;
  let aborts = 0;
  const runner = {
    async abort(_sessionId: string) { aborts += 1; return true; },
    async health() { return { mode: "test" }; },
    // Never resolves, so the session stays tracked as running until the notification cancels it.
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });

  await controller.handleNotification({ action: "issueStatusChangedAll", notification: { issueId: "issue-1" } });

  assert.equal(aborts, 1, "issueStatusChangedAll must stop the running session exactly like issueStatusChanged does");
  const health = await controller.health() as {
    controller: { notifications: { counts: Record<string, number>; last?: { action: string; disposition: string } } };
  };
  assert.equal(health.controller.notifications.counts.cancellation, 1);
  assert.equal(health.controller.notifications.last?.action, "issueStatusChangedAll");
  assert.equal(health.controller.notifications.last?.disposition, "cancellation");
});

test("does not restore the issue to its pre-attention status when a human sets a terminal status directly (GAB-16)", async () => {
  const stateFlips: Array<{ issueId: string; stateId: string }> = [];
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createActivity() {},
    async resolveAttentionStateId() { return "state-blocked"; },
    async setIssueState(issueId: string, stateId: string) { stateFlips.push({ issueId, stateId }); },
    async createIssueComment() { return { id: "comment-1", body: "" }; },
    // The first call captures previousStateId when the QA attention opens (still "In Progress");
    // the second is issueStatusChanged's own live lookup, reflecting the human's direct move to Done.
    issueState: (() => {
      let calls = 0;
      return async () => {
        calls += 1;
        return calls === 1
          ? { id: "state-in-progress", name: "In Progress", type: "started" }
          : { id: "state-done", name: "Done", type: "completed" };
      };
    })(),
  } as unknown as LinearClient;
  let aborts = 0;
  const runner = {
    async abort(_sessionId: string) { aborts += 1; return true; },
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
      blocking: true,
      title: "Ready for review",
      action: "Sidebar favorites are implemented and tested.",
      evidence: [{ label: "Preview", url: "https://preview.example.test" }],
    },
  });
  // The attention-open flow itself legitimately calls setIssueState to flag the issue -
  // clear that before checking what the status-change notification does on its own.
  stateFlips.length = 0;

  // Gaby drags the issue straight to Done, bypassing the QA "Approve and complete" button -
  // the exact live GAB-16 sequence: "Gaby moved from In Review to Done" immediately followed by
  // "straylight moved from Done to In Progress".
  await controller.handleNotification({ action: "issueStatusChanged", notification: { issueId: "issue-1" } });

  assert.equal(aborts, 1, "the run must still stop once the issue reaches a terminal status");
  assert.deepEqual(stateFlips, [], "the human's own terminal status change must never be reverted");
});

test("records an other issue-prefixed notification as contextOnly instead of unknown", async () => {
  const linear = {} as unknown as LinearClient;
  const runner = { async health() { return { mode: "test" }; } } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handleNotification({ action: "issueReopened", notification: { issueId: "issue-1" } });

  const health = await controller.health() as {
    controller: { notifications: { counts: Record<string, number>; last?: { action: string; disposition: string } } };
  };
  assert.equal(health.controller.notifications.counts.contextOnly, 1);
  assert.equal(health.controller.notifications.counts.unknown, 0);
  assert.equal(health.controller.notifications.last?.disposition, "contextOnly");
});

test("posts a fallback comment on the linked issue for a pull-request mention", async () => {
  const comments: Array<{ issueId: string; body: string }> = [];
  const linear = {
    async createIssueComment(issueId: string, body: string) {
      comments.push({ issueId, body });
      return { id: "fallback-comment-1", body };
    },
  } as unknown as LinearClient;
  const runner = { async health() { return { mode: "test" }; } } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handleNotification({
    action: "pullRequestMention",
    notification: { issueId: "issue-1", comment: { id: "pr-comment-1", body: "can you take a look at this diff?" } },
  });

  assert.equal(comments.length, 1);
  assert.equal(comments[0]?.issueId, "issue-1");
  assert.match(comments[0]?.body ?? "", /doesn't yet route pull request comment threads to an Agent Session/);
  assert.match(comments[0]?.body ?? "", /can you take a look at this diff\?/);

  const health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.contextOnly, 1);
  assert.equal(health.controller.notifications.counts.unknown, 0);
});

test("handles a pull-request mention with no linked issue gracefully", async () => {
  let calledCreateComment = false;
  const linear = {
    async createIssueComment() {
      calledCreateComment = true;
      return { id: "should-not-be-called", body: "" };
    },
  } as unknown as LinearClient;
  const runner = { async health() { return { mode: "test" }; } } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handleNotification({
    action: "pullRequestCommentMention",
    notification: {},
  });

  assert.equal(calledCreateComment, false, "with no linked issue there is nowhere to post the fallback comment");
  const health = await controller.health() as { controller: { notifications: { counts: Record<string, number> } } };
  assert.equal(health.controller.notifications.counts.unknown, 1);
});

test("auto-resumes a blocked_external session once its reported reset time has passed", async () => {
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createActivity() {},
    async agentSessionSnapshot() { return { id: "session-1", status: "active", appUser: { id: "agent-1" } }; },
  } as unknown as LinearClient;
  let runCalls = 0;
  let secondCallPayload: { action?: string; agentActivity?: { content?: { body?: string } } } | undefined;
  const runner = {
    async health() { return { mode: "test" }; },
    async run(payload: { action?: string; agentActivity?: { content?: { body?: string } } }) {
      runCalls += 1;
      if (runCalls === 1) {
        return {
          ok: false,
          timedOut: false,
          awaitingInput: false,
          summary: "Hit the Claude subscription usage limit mid-turn.",
          elapsedMs: 1_000,
          disposition: {
            status: "blocked_external" as const,
            reason: "Hit the Claude subscription usage limit (five_hour) mid-turn.",
            // Already due - the scheduled delay clamps to 0, so this fires on the next tick.
            nextAction: `auto-resume-at:${new Date(Date.now() - 1_000).toISOString()}`,
          },
        };
      }
      secondCallPayload = payload;
      return new Promise(() => {}); // the resumed run just needs to be observed starting, not finish
    },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  // handle() only kicks the run off (start() fire-and-forgets execute()), and the due
  // auto-resume-at marker clamps its own scheduled delay to 0 - both hops can settle well
  // within one short wait, so there's no reliable "exactly one run so far" midpoint to assert.
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.equal(runCalls, 2, "a blocked_external session with a due auto-resume-at marker must be resumed automatically");
  // Assert on the actual resume payload, not just the call count - a call count alone
  // would also pass for a retry or a `pending` re-run unrelated to the scheduler.
  assert.equal(secondCallPayload?.action, "prompted");
  assert.match(
    secondCallPayload?.agentActivity?.content?.body ?? "",
    /usage limit that paused this run has now reset/,
  );
});

test("skips a scheduled auto-resume when the Agent Session has reached a terminal status in the meantime", async () => {
  const linear = {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async createActivity() {},
    // A human closed this out (or Linear otherwise moved it to a terminal status) while the
    // auto-resume was still scheduled - the resume must not un-cancel it.
    async agentSessionSnapshot() { return { id: "session-1", status: "complete", appUser: { id: "agent-1" } }; },
  } as unknown as LinearClient;
  let runCalls = 0;
  const runner = {
    async health() { return { mode: "test" }; },
    async run() {
      runCalls += 1;
      return {
        ok: false,
        timedOut: false,
        awaitingInput: false,
        summary: "Hit the Claude subscription usage limit mid-turn.",
        elapsedMs: 1_000,
        disposition: {
          status: "blocked_external" as const,
          reason: "Hit the Claude subscription usage limit (five_hour) mid-turn.",
          nextAction: `auto-resume-at:${new Date(Date.now() - 1_000).toISOString()}`,
        },
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
  assert.equal(runCalls, 1);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(runCalls, 1, "a session Linear now reports as terminal must not be silently un-cancelled by an auto-resume");
});
