import assert from "node:assert/strict";
import { test } from "bun:test";
import { isAttentionRequest, isDeferredItemRequest, renderAttentionComment, renderAttentionRequest, renderDeferredItem } from "../src/attention.js";

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

test("renders a terse same-issue comment without restating intent or delta", () => {
  const comment = renderAttentionComment(steering);
  assert.match(comment, /\*\*Steering needed:\*\* Choose the migration boundary/);
  assert.match(comment, /Confirm whether the old table must remain writable/);
  assert.match(comment, /Keep old writer/);
  assert.doesNotMatch(comment, /Original intent/);
  assert.doesNotMatch(comment, /What changed/);
  assert.doesNotMatch(comment, /Why this deserves attention/);
  assert.ok(comment.length < renderAttentionRequest(steering).length / 2);
});

test("renders a QA comment with an approve instruction instead of an options list", () => {
  const { options: _options, ...steeringWithoutOptions } = steering;
  const qa = {
    ...steeringWithoutOptions,
    kind: "qa" as const,
    evidence: [{ label: "Preview", url: "https://preview.example.test" }],
  };
  const comment = renderAttentionComment(qa);
  assert.match(comment, /\*\*QA needed:\*\* Choose the migration boundary/);
  assert.match(comment, /Reply \*\*approve\*\* to complete/);
  assert.match(comment, /\[Preview\]\(https:\/\/preview\.example\.test\)/);
  assert.doesNotMatch(comment, /Approve and complete —/);
});

test("requires review evidence before asking for QA attention", () => {
  const { options: _options, ...qa } = steering;
  assert.equal(isAttentionRequest({ ...qa, kind: "qa" }), false);
  assert.equal(isAttentionRequest({
    ...qa,
    kind: "qa",
    evidence: [{ label: "Preview", url: "https://preview.example.test", description: "Checked at 1440px." }],
  }), true);
  const rendered = renderAttentionRequest({
    ...qa,
    kind: "qa",
    evidence: [{ label: "Preview", url: "https://preview.example.test" }],
  });
  assert.match(rendered, /approval required/);
  assert.match(rendered, /Approve and complete/);
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

test("makes Signal the only nonblocking lifecycle transition", () => {
  assert.equal(isAttentionRequest({ ...steering, kind: "signal", delivery: "queue", blocking: false }), true);
  assert.equal(isAttentionRequest({ ...steering, kind: "signal", delivery: "interrupt", priority: "urgent", blocking: false }), false);
  assert.equal(isAttentionRequest({ ...steering, kind: "steering", blocking: false }), false);
});

const deferred = {
  title: "Extract the shared retry helper",
  what: "Three call sites in linear.ts duplicate the same exponential-backoff loop.",
  whyNotNow: "Unrelated to the bug this task is fixing; touching it now would widen the diff.",
  resurface: "Next time a fourth call site needs the same retry logic, or during a dedicated cleanup pass.",
};

test("requires every deferred-follow-up field so a subissue can't be manufactured busywork", () => {
  assert.equal(isDeferredItemRequest(deferred), true);
  for (const field of ["title", "what", "whyNotNow", "resurface"] as const) {
    const { [field]: _omitted, ...incomplete } = deferred;
    assert.equal(isDeferredItemRequest(incomplete), false);
  }
  assert.equal(isDeferredItemRequest({ ...deferred, what: "" }), false);
});

test("renders a deferred follow-up with its justification, not just a title", () => {
  const rendered = renderDeferredItem(deferred);
  assert.match(rendered, /Deferred follow-up: Extract the shared retry helper/);
  assert.match(rendered, /duplicate the same exponential-backoff loop/);
  assert.match(rendered, /Why this isn't the current task's job/);
  assert.match(rendered, /fourth call site needs the same retry logic/);
});
