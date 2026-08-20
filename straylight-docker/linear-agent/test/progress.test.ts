import assert from "node:assert/strict";
import { test } from "bun:test";
import { ProgressReporter } from "../src/progress.js";
import type { RunnerEvent } from "../src/runner-protocol.js";

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
