import assert from "node:assert/strict";
import { test } from "bun:test";
import { isAttentionRequest, renderAttentionRequest } from "../src/attention.js";

const steering = {
  kind: "steering" as const,
  delivery: "queue" as const,
  priority: "high" as const,
  blocking: true,
  title: "Choose the migration boundary",
  action: "Confirm whether the old table must remain writable during backfill.",
  originalIntent: "Migrate without losing customer data.",
  delta: "The old writer cannot dual-write without changing its transaction boundary.",
  recommendation: "Keep the old writer authoritative until the independent verification passes.",
  impact: "Choosing a destructive cutover could lose writes made during the migration.",
  timing: "No immediate deadline; the migration is safely paused before writes change.",
  options: [
    { label: "Keep old writer", value: "Use expand/backfill/verify/cutover", tradeoff: "Slower, but recoverable." },
    { label: "Immediate cutover", value: "Switch writers before backfill", tradeoff: "Faster, but unsafe." },
  ],
};

test("accepts a rationalized steering request and renders the decision before detail", () => {
  assert.equal(isAttentionRequest(steering), true);
  const rendered = renderAttentionRequest(steering);
  assert.match(rendered, /Steering · queued/);
  assert.match(rendered, /high · blocking input/);
  assert.ok(rendered.indexOf("Your action") < rendered.indexOf("Original intent"));
  assert.match(rendered, /Keep old writer/);
});

test("requires review evidence before asking for QA attention", () => {
  assert.equal(isAttentionRequest({ ...steering, kind: "qa" }), false);
  assert.equal(isAttentionRequest({
    ...steering,
    kind: "qa",
    evidence: [{ label: "Preview", url: "https://preview.example.test", description: "Checked at 1440px." }],
  }), true);
});

test("rejects unsafe evidence and duplicate choice values", () => {
  assert.equal(isAttentionRequest({
    ...steering,
    evidence: [{ label: "Local", url: "http://localhost:3000" }],
  }), false);
  assert.equal(isAttentionRequest({
    ...steering,
    options: [
      { label: "A", value: "same" },
      { label: "B", value: "same" },
    ],
  }), false);
});

test("reserves interrupt delivery for urgent blocking attention", () => {
  assert.equal(isAttentionRequest({ ...steering, delivery: "interrupt", priority: "high" }), false);
  assert.equal(isAttentionRequest({ ...steering, delivery: "interrupt", priority: "urgent", blocking: false }), false);
  assert.equal(isAttentionRequest({ ...steering, delivery: "interrupt", priority: "urgent", blocking: true }), true);
});
