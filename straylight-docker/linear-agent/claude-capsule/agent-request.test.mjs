import assert from "node:assert/strict";
import test from "node:test";
import { assertAgentMayAct } from "./agent-request.mjs";

test("permits tools while the agent is active", () => {
  assert.doesNotThrow(() => assertAgentMayAct({ awaitingInput: false }));
});

test("freezes every further tool after blocking attention is requested", () => {
  assert.throws(
    () => assertAgentMayAct({ awaitingInput: true }),
    /blocking attention request is pending/,
  );
});
