import assert from "node:assert/strict";
import { test } from "bun:test";
import { AgentController } from "../src/controller.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";

test("routes Linear inbox notifications without synthesizing comment instructions", async () => {
  const linear = {
    async issueState() { return { id: "state-1", name: "In Progress", type: "started" }; },
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

  const health = await controller.health() as {
    controller: { notifications: { counts: Record<string, number> } };
  };
  assert.deepEqual(health.controller.notifications.counts, {
    agentSessionOwned: 1,
    contextOnly: 1,
    acknowledgement: 1,
    cancellation: 0,
    lifecycle: 2,
    unknown: 0,
  });
});
