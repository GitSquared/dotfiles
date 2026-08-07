import assert from "node:assert/strict";
import test from "node:test";
import { encodeRunnerEvent, parseRunnerEvent } from "../src/runner-protocol.js";

test("round-trips structured runner activity", () => {
  const event = {
    type: "activity" as const,
    content: { type: "action" as const, action: "Running bash", parameter: "npm test" },
    ephemeral: true,
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});

test("rejects an unknown runner event", () => {
  assert.throws(() => parseRunnerEvent('{"type":"surprise"}'), /invalid event/);
});
