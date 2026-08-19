import assert from "node:assert/strict";
import { test } from "bun:test";
import { ProgressReporter } from "../src/progress.js";
import type { RunnerEvent } from "../src/runner-protocol.js";

test("streams cumulative user-facing assistant text as an ephemeral Linear thought", async () => {
  const events: Array<Exclude<RunnerEvent, { type: "result" }>> = [];
  const reporter = new ProgressReporter(async (event) => { events.push(event); }, 1_000, 60_000);
  reporter.start();
  reporter.handle({
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "I found the browser cache problem." }],
      api: "openai-responses",
      provider: "openai-codex",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "problem.", partial: undefined as never },
  });
  await reporter.flush();
  reporter.stop();
  assert.deepEqual(events, [{
    type: "activity",
    content: { type: "thought", body: "I found the browser cache problem." },
    ephemeral: true,
  }]);
});

test("repeats visible proof-of-life while a run remains quiet", async () => {
  const events: Array<Exclude<RunnerEvent, { type: "result" }>> = [];
  const reporter = new ProgressReporter(async (event) => { events.push(event); }, 1, 5);
  reporter.start();
  await Bun.sleep(18);
  await reporter.flush();
  reporter.stop();
  assert.ok(events.length >= 2);
  assert.equal(events.every((event) => (
    event.content.type === "thought" && event.content.body === "The agent is still working."
  )), true);
});
