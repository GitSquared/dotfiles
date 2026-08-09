import assert from "node:assert/strict";
import { test } from "bun:test";
import { AgentController } from "../src/controller.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";
import type { AgentTaskPayload, LinearInputFile } from "../src/types.js";

test("passes validated Linear inputs through the controller to Pi", async () => {
  const input: LinearInputFile = {
    filename: "screen.png",
    mimeType: "image/png",
    size: 8,
    dataBase64: "iVBORw0KGgo=",
  };
  const linear = {
    async createActivity() {},
    async downloadInputs() { return { inputs: [input], skipped: [], totalBytes: input.size }; },
    async repositorySuggestions() { return []; },
  } as unknown as LinearClient;
  let received: AgentTaskPayload | undefined;
  const runner = {
    async repositories() { return []; },
    async run(payload: AgentTaskPayload) {
      received = payload;
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 };
    },
    async health() { return { mode: "test" }; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    type: "AgentSessionEvent",
    action: "created",
    agentSession: { id: "session-1", issueId: "issue-1" },
  });
  for (let attempt = 0; attempt < 50 && !received; attempt += 1) await Bun.sleep(2);

  assert.deepEqual(received?.linearInputs, [input]);
  const health = await controller.health() as { controller: { linearInputs: { downloaded: number; bytes: number } } };
  assert.deepEqual(health.controller.linearInputs, { downloaded: 1, skipped: 0, bytes: 8 });
});

test("adds the matching Document and review thread to a comment mention", async () => {
  const review = {
    document: { id: "doc-1", title: "Setup", url: "https://linear.app/document/doc-1", content: "# Setup" },
    comment: { id: "source-comment-1", body: "@straylight revise this", quotedText: "Setup" },
    thread: [{ id: "source-comment-1", body: "@straylight revise this", quotedText: "Setup" }],
  };
  const linear = {
    async createActivity() {},
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async documentReviewContext(commentId: string) {
      assert.equal(commentId, "source-comment-1");
      return review;
    },
    async repositorySuggestions() { return []; },
  } as unknown as LinearClient;
  let received: AgentTaskPayload | undefined;
  const runner = {
    async repositories() { return []; },
    async run(payload: AgentTaskPayload) {
      received = payload;
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 };
    },
    async health() { return { mode: "test" }; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    type: "AgentSessionEvent",
    action: "created",
    agentSession: {
      id: "session-2",
      issueId: "issue-1",
      sourceCommentId: "source-comment-1",
      comment: { id: "comment-1", body: "@straylight revise this" },
    },
  });
  for (let attempt = 0; attempt < 50 && !received; attempt += 1) await Bun.sleep(2);

  assert.deepEqual(received?.linearDocumentReview, review);
});

test("updates an existing Document from a Document-only Agent Session", async () => {
  let update: { id: string; title: string; content: string } | undefined;
  const linear = {
    async createActivity() {},
    async addExternalUrl() {},
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async repositorySuggestions() { return []; },
    async updateDocument(id: string, title: string, content: string) {
      update = { id, title, content };
      return { id, title, url: "https://linear.app/document/doc-1" };
    },
  } as unknown as LinearClient;
  let received = false;
  const runner = {
    async repositories() { return []; },
    async run() {
      received = true;
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 };
    },
    async health() { return { mode: "test" }; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({ type: "AgentSessionEvent", action: "created", agentSession: { id: "session-doc" } });
  for (let attempt = 0; attempt < 50 && !received; attempt += 1) await Bun.sleep(2);

  await controller.collaborateLinear("session-doc", {
    action: "publish",
    publication: { kind: "document", id: "doc-1", title: "Setup", body: "# Revised", update: true },
  });

  assert.deepEqual(update, { id: "doc-1", title: "Setup", content: "# Revised" });
});
