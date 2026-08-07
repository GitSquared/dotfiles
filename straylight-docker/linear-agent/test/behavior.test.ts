import assert from "node:assert/strict";
import test from "node:test";
import { isStopRequest } from "../src/controller.js";
import { followUpPrompt, initialPrompt } from "../src/pi.js";
import { finalText, progressText, redact } from "../src/redaction.js";

test("builds a repository-aware initial prompt", () => {
  const prompt = initialPrompt({
    action: "created",
    agentSession: {
      id: "session",
      issue: { identifier: "NEMO-42", title: "Teach the fish to delegate", description: "Use the nemo repository." },
    },
    guidance: [{ body: "Keep the change targeted." }],
  });
  assert.match(prompt, /NEMO-42/);
  assert.match(prompt, /Use the nemo repository/);
  assert.match(prompt, /Keep the change targeted/);
  assert.match(prompt, /Do not push/);
});

test("uses the activity body for follow-ups", () => {
  const prompt = followUpPrompt({ agentActivity: { content: { body: "Run the integration tests too." } } });
  assert.match(prompt, /Run the integration tests too/);
});

test("recognizes explicit stop requests", () => {
  assert.equal(isStopRequest({ action: "canceled" }), true);
  assert.equal(isStopRequest({ agentActivity: { content: { body: " stop " } } }), true);
  assert.equal(isStopRequest({ agentActivity: { content: { body: "keep going" } } }), false);
});

test("redacts common credentials and sensitive URL parameters", () => {
  const safe = redact("Authorization: Bearer abcdefghijklmnop https://x.test/a?token=hello sk-abcdefghijklmnop"); // yadm-secret-scan: ignore
  assert.doesNotMatch(safe, /abcdefghijklmnop/);
  assert.match(safe, /redacted/);
});

test("bounds progress and final output", () => {
  assert.ok(progressText("x".repeat(500)).length <= 240);
  assert.ok(finalText("x".repeat(10_000)).length <= 8_000);
});
