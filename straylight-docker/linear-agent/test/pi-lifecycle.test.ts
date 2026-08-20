import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  assertPiTerminalSummary,
  enforcePiLifecycleTransition,
  piLifecycleRepairPrompt,
  piTerminalToolBlock,
} from "../src/pi.js";
import type { WorkDisposition } from "../src/runner-protocol.js";

test("repairs a Pi turn that tries to stop without a lifecycle transition", () => {
  const prompt = piLifecycleRepairPrompt(false);
  assert.match(prompt, /request_attention with kind qa/);
  assert.match(prompt, /may not declare delegated work complete/);
});

test("tells Pi a Signal it already sent will not be enough, instead of re-listing it as an option", () => {
  const prompt = piLifecycleRepairPrompt(true);
  assert.match(prompt, /A Signal alone never ends a turn/);
  assert.match(prompt, /requesting QA again/);
});

test("runs exactly one repair turn and then fails closed", async () => {
  let turns = 0;
  await assert.rejects(() => enforcePiLifecycleTransition(
    async () => { turns += 1; },
    async () => { turns += 1; },
    () => undefined,
  ), /after one repair turn/);
  assert.equal(turns, 2);

  let disposition: WorkDisposition | undefined;
  turns = 0;
  await enforcePiLifecycleTransition(
    async () => {
      turns += 1;
      disposition = { status: "awaiting_qa", reason: "Ready." } as const;
    },
    async () => { turns += 1; },
    () => disposition,
  );
  assert.equal(turns, 1);
});

test("blocks every later tool after Pi records a terminal disposition", () => {
  assert.equal(piTerminalToolBlock(undefined), undefined);
  assert.deepEqual(piTerminalToolBlock({
    status: "awaiting_qa",
    reason: "The checked preview is ready for approval.",
  }), {
    block: true,
    reason: "A terminal Straylight lifecycle disposition is already recorded. Return the concise final summary without using more tools.",
  });
});

test("rejects informal Pi endings outside Steering or QA", () => {
  assert.throws(() => assertPiTerminalSummary({
    status: "blocked_external",
    reason: "The upstream service is unavailable.",
    nextAction: "Retry after its public status returns healthy.",
  }, "The service is down; let me know if you want more."), /outside the Linear attention state machine/);

  assert.doesNotThrow(() => assertPiTerminalSummary({
    status: "awaiting_steering",
    reason: "A human decision is required.",
  }, "Please choose the migration boundary on the Steering child."));
});
