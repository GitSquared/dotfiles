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
