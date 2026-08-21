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

test("keeps every queued durable activity while still coalescing ephemeral ones to the latest", async () => {
  const events: Array<Exclude<RunnerEvent, { type: "result" }>> = [];
  const reporter = new ProgressReporter(async (event) => { events.push(event); }, 1_000, 300_000);
  reporter.start();

  const durable = (result: string): Exclude<RunnerEvent, { type: "result" }> => ({
    type: "activity",
    content: { type: "action", action: "Running command", parameter: "bun test", result },
    ephemeral: false,
  });
  const ephemeral = (body: string): Exclude<RunnerEvent, { type: "result" }> => ({
    type: "activity",
    content: { type: "thought", body },
    ephemeral: true,
  });

  // A burst inside one debounce window: both durable completions must survive
  // (no last-write-wins), while only the latest of the two ephemeral thoughts
  // should still make it out, exactly as before durable activities existed.
  reporter.report(ephemeral("first thought"));
  reporter.report(durable("first result"));
  reporter.report(durable("second result"));
  reporter.report(ephemeral("second thought"));
  await reporter.flush();
  reporter.stop();

  assert.deepEqual(events, [durable("first result"), durable("second result"), ephemeral("second thought")]);
});

test("delivers a repeated durable activity every time instead of deduplicating it away", async () => {
  const events: Array<Exclude<RunnerEvent, { type: "result" }>> = [];
  const reporter = new ProgressReporter(async (event) => { events.push(event); }, 1, 300_000);
  reporter.start();

  const repeated: Exclude<RunnerEvent, { type: "result" }> = {
    type: "activity",
    content: { type: "action", action: "Running command", parameter: "bun test", result: "same output" },
    ephemeral: false,
  };
  reporter.report(repeated);
  await reporter.flush();
  reporter.report(repeated);
  await reporter.flush();
  reporter.stop();

  assert.deepEqual(events, [repeated, repeated]);
});
