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
