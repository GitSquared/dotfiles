import assert from "node:assert/strict";
import { test } from "bun:test";
import { encodeRunnerEvent, parseRunnerEvent } from "../src/runner-protocol.js";

test("round-trips structured runner activity", () => {
  const event = {
    type: "activity" as const,
    content: { type: "action" as const, action: "Running bash", parameter: "npm test" },
    ephemeral: true as const,
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});

test("rejects an unknown runner event", () => {
  assert.throws(() => parseRunnerEvent('{"type":"surprise"}'), /invalid event/);
  assert.throws(() => parseRunnerEvent('{"type":"activity","ephemeral":false,"content":{}}'), /invalid event/);
  assert.throws(() => parseRunnerEvent('{"type":"result","result":{"ok":true}}'), /invalid event/);
});

test("requires a human-owned disposition to match awaiting input", () => {
  const valid = {
    type: "result" as const,
    result: {
      ok: true,
      timedOut: false,
      awaitingInput: true,
      summary: "Waiting on the attention issue.",
      elapsedMs: 1,
      disposition: { status: "awaiting_steering" as const, reason: "Repository access is required." },
    },
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(valid).trim()), valid);
  assert.throws(
    () => parseRunnerEvent(encodeRunnerEvent({ ...valid, result: { ...valid.result, awaitingInput: false } }).trim()),
    /invalid event/,
  );
});
