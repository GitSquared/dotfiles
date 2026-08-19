import assert from "node:assert/strict";
import test from "node:test";
import { assertAgentMayAct, recordWorkDisposition, stopDispositionGuard } from "./agent-request.mjs";

test("permits tools while the agent is active", () => {
  assert.doesNotThrow(() => assertAgentMayAct({ awaitingInput: false }));
});

test("freezes every further tool after blocking attention is requested", () => {
  assert.throws(
    () => assertAgentMayAct({ awaitingInput: true }),
    /blocking attention request is pending/,
  );
});

test("requires an explicit terminal disposition before Claude stops", () => {
  const context = { awaitingInput: false, disposition: undefined, stopRepairRequested: false };
  assert.deepEqual(stopDispositionGuard(context, { last_assistant_message: "Done." }), {
    decision: "block",
    reason: "Before stopping, call finish_work with completed, blocked_external, or deferred. If the engineer must act, call request_attention instead; a successful blocking request records blocked_human automatically.",
  });
  recordWorkDisposition(context, { status: "completed", reason: "Implemented and checked." });
  assert.deepEqual(stopDispositionGuard(context, { last_assistant_message: "Implemented and checked." }), {});
});

test("repairs a prose blocker that lacks a Linear attention issue", () => {
  const context = {
    awaitingInput: false,
    disposition: { status: "completed", reason: "Repository unavailable." },
    stopRepairRequested: false,
  };
  const decision = stopDispositionGuard(context, {
    last_assistant_message: "I cannot continue until the engineer grants repository access.",
  });
  assert.equal(decision.decision, "block");
  assert.match(decision.reason, /no blocking attention issue exists/);
});

test("only request_attention can record a human blocker", () => {
  assert.throws(
    () => recordWorkDisposition({ awaitingInput: false }, { status: "blocked_human", reason: "Need access." }),
    /must use request_attention/,
  );
});
