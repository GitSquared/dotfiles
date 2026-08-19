import assert from "node:assert/strict";
import test from "node:test";
import { assertAgentMayAct, assertTerminalSummary, recordWorkDisposition, stopDispositionGuard } from "./agent-request.mjs";

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
  const context = { awaitingInput: false, attentionKind: undefined, disposition: undefined, stopRepairRequested: false };
  assert.deepEqual(stopDispositionGuard(context, { last_assistant_message: "Done." }), {
    decision: "block",
    reason: "Before stopping, choose a valid lifecycle transition: send a nonblocking signal and continue, request blocking Steering when an answer is required, request QA with evidence when work is ready for human approval, or call finish_work only for blocked_external or authorized deferred work. The agent may not declare delegated work complete.",
  });
  recordWorkDisposition(context, { status: "deferred", reason: "The issue explicitly schedules this for next week.", nextAction: "Resume next week." });
  assert.deepEqual(stopDispositionGuard(context, { last_assistant_message: "Deferred as requested." }), {});
});

test("rejects an informal follow-up outside the attention state machine", () => {
  const context = {
    awaitingInput: false,
    attentionKind: undefined,
    disposition: { status: "deferred", reason: "Authorized pause.", nextAction: "Resume next week." },
    stopRepairRequested: true,
  };
  assert.throws(() => assertTerminalSummary(context, "All good; let me know if you want more."), /outside the Linear attention state machine/);
});

test("repairs a prose blocker that lacks a Linear attention issue", () => {
  const context = {
    awaitingInput: false,
    attentionKind: undefined,
    disposition: { status: "blocked_external", reason: "Repository unavailable." },
    stopRepairRequested: false,
  };
  const decision = stopDispositionGuard(context, {
    last_assistant_message: "I cannot continue until the engineer grants repository access.",
  });
  assert.equal(decision.decision, "block");
  assert.match(decision.reason, /no blocking attention issue exists/);
});

test("only request_attention can record a human-owned transition", () => {
  assert.throws(
    () => recordWorkDisposition({ awaitingInput: false }, { status: "awaiting_steering", reason: "Need access." }),
    /must use request_attention/,
  );
});
