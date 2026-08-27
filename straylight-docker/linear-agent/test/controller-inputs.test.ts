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
    async commentContext(commentId: string) {
      assert.equal(commentId, "source-comment-1");
      return { comment: review.comment, documentReview: review };
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

test("gathers Linear project and team context at session boot", async () => {
  const linear = {
    async createActivity() {},
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async repositorySuggestions() { return []; },
    async issueWorkspaceContext(issueId: string) {
      assert.equal(issueId, "issue-1");
      return {
        project: { id: "project-1", name: "Linear coding harness", url: "https://linear.app/gaby-s/project/linear-coding-harness", content: "Code lives in GitSquared/dotfiles, straylight branch." },
        team: { id: "team-1", name: "Gaby", description: "Straylight's own team." },
      };
    },
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
    agentSession: { id: "session-3", issueId: "issue-1" },
  });
  for (let attempt = 0; attempt < 50 && !received; attempt += 1) await Bun.sleep(2);

  assert.deepEqual(received?.projectContext, {
    id: "project-1",
    name: "Linear coding harness",
    url: "https://linear.app/gaby-s/project/linear-coding-harness",
    content: "Code lives in GitSquared/dotfiles, straylight branch.",
  });
  assert.deepEqual(received?.teamContext, { id: "team-1", name: "Gaby", description: "Straylight's own team." });
});

test("continues session boot when Linear project/team context lookup fails", async () => {
  const linear = {
    async createActivity() {},
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async repositorySuggestions() { return []; },
    async issueWorkspaceContext() { throw new Error("Linear GraphQL request timed out"); },
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
    agentSession: { id: "session-4", issueId: "issue-1" },
  });
  for (let attempt = 0; attempt < 50 && !received; attempt += 1) await Bun.sleep(2);

  assert.equal(received?.projectContext, undefined);
  assert.equal(received?.teamContext, undefined);
});

test("carries an already-downloaded live follow-up attachment through to the next turn without re-downloading it (GAB-34)", async () => {
  const input: LinearInputFile = {
    filename: "report.pdf",
    mimeType: "application/pdf",
    size: 4,
    dataBase64: "cGRm",
  };
  let downloadCalls = 0;
  const activities: Array<{ type: string; body?: string }> = [];
  const linear = {
    async createActivity(_sessionId: string, content: { type: string; body?: string }) { activities.push(content); },
    async downloadInputs(payload: { agentSession?: { comment?: { body?: string } } }) {
      // Only the follow-up's own triggering comment references the PDF - the initial
      // "created" webhook has nothing to download, matching real `linearInputReferences`
      // behavior (which only finds references actually present in the payload text).
      if (!payload.agentSession?.comment?.body?.includes("report.pdf")) return { inputs: [], skipped: [], totalBytes: 0 };
      downloadCalls += 1;
      return { inputs: [input], skipped: [], totalBytes: input.size };
    },
    async repositorySuggestions() { return []; },
  } as unknown as LinearClient;

  let finishFirst!: (value: { ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number }) => void;
  const first = new Promise<{ ok: true; timedOut: false; awaitingInput: false; summary: string; elapsedMs: number }>((resolve) => {
    finishFirst = resolve;
  });
  const runs: AgentTaskPayload[] = [];
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run(payload: AgentTaskPayload) {
      runs.push(payload);
      if (runs.length === 1) return first;
      return { ok: true as const, timedOut: false as const, awaitingInput: false, summary: "Second turn done.", elapsedMs: 1 };
    },
    // Mirrors ClaudeHarness.followUp: declines outright whenever the follow-up carries
    // new input files, deferring materialization to the next cold-queue turn.
    async followUp(_sessionId: string, _prompt: string, inputs?: LinearInputFile[]) { return !inputs?.length; },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);

  await controller.handle({
    action: "created",
    agentSession: { id: "session-attach", issueId: "issue-attach" },
  });
  for (let attempt = 0; attempt < 50 && runs.length < 1; attempt += 1) await Bun.sleep(2);

  // A follow-up arrives mid-turn with a PDF attached to the triggering comment.
  await controller.handle({
    action: "prompted",
    agentSession: {
      id: "session-attach",
      issueId: "issue-attach",
      comment: { id: "comment-2", body: "Here's the pricing PDF: ![report.pdf](https://uploads.linear.app/private/report.pdf)" },
    },
  });
  for (let attempt = 0; attempt < 50 && downloadCalls < 1; attempt += 1) await Bun.sleep(2);

  assert.equal(downloadCalls, 1, "the attachment must be downloaded once while queued, not silently skipped");
  const queuedNote = activities.find((activity) => activity.type === "thought" && activity.body?.includes("attached file"));
  assert.ok(queuedNote, "the queued-follow-up activity must tell the user their file was captured, not just the text");
  assert.match(queuedNote!.body!, /1 attached file/);

  // The in-flight turn now concludes; the queued follow-up (with its already-downloaded
  // file) should start a fresh turn without hitting Linear for the file a second time.
  finishFirst({ ok: true, timedOut: false, awaitingInput: false, summary: "First turn done.", elapsedMs: 1 });
  for (let attempt = 0; attempt < 50 && runs.length < 2; attempt += 1) await Bun.sleep(2);

  assert.equal(runs.length, 2, "the queued follow-up must actually start a second turn");
  assert.deepEqual(runs[1]?.linearInputs, [input], "the carried-forward file must reach the second turn's task payload");
  assert.equal(downloadCalls, 1, "resuming the queued follow-up must reuse the already-downloaded bytes, not re-fetch the short-lived Linear URL");
});
