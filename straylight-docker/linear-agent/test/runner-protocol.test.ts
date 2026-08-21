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

test("round-trips a durable (non-ephemeral) runner activity", () => {
  const event = {
    type: "activity" as const,
    content: { type: "action" as const, action: "Running bash", parameter: "npm test", result: "12 passed" },
    ephemeral: false as const,
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(event).trim()), event);
});

test("rejects an unknown runner event", () => {
  assert.throws(() => parseRunnerEvent('{"type":"surprise"}'), /invalid event/);
  assert.throws(() => parseRunnerEvent('{"type":"activity","content":{}}'), /invalid event/);
  assert.throws(() => parseRunnerEvent('{"type":"activity","ephemeral":"false","content":{}}'), /invalid event/);
  assert.throws(() => parseRunnerEvent('{"type":"result","result":{"ok":true}}'), /invalid event/);
});

test("round-trips a conversation id on the result event", () => {
  const withId = {
    type: "result" as const,
    result: {
      ok: true,
      timedOut: false,
      awaitingInput: false,
      summary: "Done.",
      elapsedMs: 1,
      conversationId: "conv-123",
    },
  };
  assert.deepEqual(parseRunnerEvent(encodeRunnerEvent(withId).trim()), withId);

  const { conversationId: _omit, ...withoutId } = withId.result;
  assert.deepEqual(
    parseRunnerEvent(encodeRunnerEvent({ type: "result", result: withoutId }).trim()),
    { type: "result", result: withoutId },
  );

  assert.throws(
    () => parseRunnerEvent('{"type":"result","result":{"ok":true,"timedOut":false,"awaitingInput":false,"summary":"Done.","elapsedMs":1,"conversationId":42}}'),
    /invalid event/,
  );
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
