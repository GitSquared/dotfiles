import assert from "node:assert/strict";
import { test } from "bun:test";
import { isAttentionRequest, isDeferredItemRequest, isQaApproval, QA_APPROVE_VALUE, QA_REVISE_VALUE, renderAttentionComment, renderDeferredItem } from "../src/attention.js";

const steering = {
  kind: "steering" as const,
  delivery: "queue" as const,
  priority: "high" as const,
  blocking: true,
  title: "Choose the migration boundary",
  action: "Confirm whether the old table must remain writable during backfill.",
  recommendation: "Keep the old writer authoritative until the independent verification passes.",
  options: [
    { label: "Keep old writer", value: "Use expand/backfill/verify/cutover", tradeoff: "Slower, but recoverable." },
    { label: "Immediate cutover", value: "Switch writers before backfill", tradeoff: "Faster, but unsafe." },
  ],
};

test("accepts a rationalized steering request", () => {
  assert.equal(isAttentionRequest(steering), true);
});

test("renders a terse same-issue comment without restating intent or delta", () => {
  const comment = renderAttentionComment(steering);
  assert.match(comment, /\*\*Steering needed:\*\* Choose the migration boundary/);
  assert.match(comment, /Confirm whether the old table must remain writable/);
  assert.match(comment, /Keep old writer/);
  assert.doesNotMatch(comment, /Original intent/);
  assert.doesNotMatch(comment, /What changed/);
  assert.doesNotMatch(comment, /Why this deserves attention/);
});

test("renders a Signal comment with no hardcoded action-needed footer", () => {
  const { options: _options, ...signal } = steering;
  const comment = renderAttentionComment({ ...signal, kind: "signal", delivery: "queue" });
  assert.match(comment, /\*\*Update:\*\* Choose the migration boundary/);
  assert.doesNotMatch(comment, /No action needed/, "Signal has nothing actionable to instruct - a hardcoded reassurance line is just filler");
});

test("renders a QA comment with no approve instruction or options list - the native controls already cover it", () => {
  const { options: _options, ...steeringWithoutOptions } = steering;
  const qa = {
    ...steeringWithoutOptions,
    kind: "qa" as const,
    evidence: [{ label: "Preview", url: "https://preview.example.test" }],
  };
  const comment = renderAttentionComment(qa);
  assert.match(comment, /\*\*QA needed:\*\* Choose the migration boundary/);
  assert.doesNotMatch(comment, /Reply \*\*approve\*\*/);
  assert.match(comment, /\[Preview\]\(https:\/\/preview\.example\.test\)/);
  assert.doesNotMatch(comment, /Approve and complete —/);
});

test("embeds image evidence inline instead of linking it", () => {
  const { options: _options, ...steeringWithoutOptions } = steering;
  const comment = renderAttentionComment({
    ...steeringWithoutOptions,
    kind: "qa" as const,
    evidence: [
      { label: "Before", url: "https://assets.example.test/before.png", image: true },
      { label: "Test run", url: "https://ci.example.test/run/42" },
    ],
  });
  assert.match(comment, /!\[Before\]\(https:\/\/assets\.example\.test\/before\.png\)/);
  assert.match(comment, /- \[Test run\]\(https:\/\/ci\.example\.test\/run\/42\)/);
});

test("omits the recommendation line entirely when none is given", () => {
  const { options: _options, recommendation: _recommendation, ...steeringWithoutRecommendation } = steering;
  const comment = renderAttentionComment({
    ...steeringWithoutRecommendation,
    kind: "qa" as const,
    evidence: [{ label: "Preview", url: "https://preview.example.test" }],
  });
  assert.doesNotMatch(comment, /Recommendation/);
});

test("accepts the literal word the QA instruction tells the human to type, not just the button's canonical value", () => {
  assert.equal(isQaApproval("approve"), true);
  assert.equal(isQaApproval(" Approve "), true);
  assert.equal(isQaApproval("APPROVED"), true);
  assert.equal(isQaApproval(QA_APPROVE_VALUE), true);
});

test("never treats a substring match as approval", () => {
  assert.equal(isQaApproval(QA_REVISE_VALUE), false);
  assert.equal(isQaApproval("not approved"), false);
  assert.equal(isQaApproval("looks good, approve pending one more check"), false);
});

test("requires review evidence before asking for QA attention", () => {
  const { options: _options, ...qa } = steering;
  assert.equal(isAttentionRequest({ ...qa, kind: "qa" }), false);
  assert.equal(isAttentionRequest({
    ...qa,
    kind: "qa",
    evidence: [{ label: "Preview", url: "https://preview.example.test" }],
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

test("makes Signal the only nonblocking lifecycle transition", () => {
  assert.equal(isAttentionRequest({ ...steering, kind: "signal", delivery: "queue", blocking: false }), true);
  assert.equal(isAttentionRequest({ ...steering, kind: "signal", delivery: "interrupt", priority: "urgent", blocking: false }), false);
  assert.equal(isAttentionRequest({ ...steering, kind: "steering", blocking: false }), false);
});

test("accepts an access-repair steering request and renders its link", () => {
  const accessRepair = { url: "https://straylight.example.test/linear/tools/auth", providerName: "GitHub" };
  assert.equal(isAttentionRequest({ ...steering, accessRepair }), true);
  const comment = renderAttentionComment({ ...steering, accessRepair });
  assert.match(comment, /\[GitHub\]\(https:\/\/straylight\.example\.test\/linear\/tools\/auth\)/);
});

test("rejects access repair outside a blocking steering request or with an unsafe url", () => {
  const accessRepair = { url: "https://straylight.example.test/linear/tools/auth", providerName: "GitHub" };
  assert.equal(isAttentionRequest({ ...steering, kind: "qa", evidence: [{ label: "x", url: "https://x.test" }], accessRepair }), false);
  assert.equal(isAttentionRequest({ ...steering, accessRepair: { ...accessRepair, url: "http://straylight.example.test/linear/tools/auth" } }), false);
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
