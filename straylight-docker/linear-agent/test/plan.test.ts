import assert from "node:assert/strict";
import { test } from "bun:test";
import { applyPlanRequest, parsePlan, reconcilePlan } from "../src/plan.js";

test("reconciles every plan item into an explicit native terminal state", () => {
  const plan = reconcilePlan({
    nextId: 4,
    items: [
      { id: 1, content: "Implement comment threads", status: "inProgress" },
      { id: 2, content: "Deploy to Straylight", status: "pending" },
      { id: 3, content: "Validate in Linear", status: "pending" },
    ],
  }, [
    { id: 1, disposition: "done", note: "Implemented and locally verified" },
    { id: 2, disposition: "deferred", note: "Deployment remains user-owned", owner: "Gaby", nextAction: "Pull and bootstrap Straylight" },
    { id: 3, disposition: "blocked", note: "Requires the deployed build", owner: "Gaby", nextAction: "Mention Straylight in a Document review thread" },
  ]);

  assert.deepEqual(plan.items.map((item) => item.status), ["completed", "canceled", "canceled"]);
  assert.match(plan.items[0]?.content ?? "", /Done: Implemented/);
  assert.match(plan.items[1]?.content ?? "", /Deferred: Deployment remains user-owned; Owner: Gaby; Next:/);
  assert.match(plan.items[2]?.content ?? "", /Blocked: Requires the deployed build/);
});

test("rejects incomplete closure and vague deferred work", () => {
  const plan = { nextId: 3, items: [
    { id: 1, content: "One", status: "completed" as const },
    { id: 2, content: "Two", status: "pending" as const },
  ] };
  assert.throws(
    () => reconcilePlan(plan, [{ id: 1, disposition: "done", note: "Done" }]),
    /missing: 2/,
  );
  assert.throws(
    () => reconcilePlan(plan, [
      { id: 1, disposition: "done", note: "Done" },
      { id: 2, disposition: "deferred", note: "Later" },
    ]),
    /requires nextAction/,
  );
});

test("keeps the closure disposition visible when plan prose is long", () => {
  const plan = reconcilePlan({
    nextId: 2,
    items: [{ id: 1, content: "Original ".repeat(100), status: "pending" }],
  }, [{
    id: 1,
    disposition: "deferred",
    note: "Await the rollout window",
    owner: "Gaby",
    nextAction: "Deploy and run the Document review smoke test",
  }]);
  assert.ok((plan.items[0]?.content.length ?? 501) <= 500);
  assert.match(plan.items[0]?.content ?? "", /Deferred: Await the rollout window/);
  assert.match(plan.items[0]?.content ?? "", /Next: Deploy and run the Document review smoke test/);
});

test("applies incremental plan operations without mutating the prior state", () => {
  const initial = { nextId: 2, items: [{ id: 1, content: "Inspect", status: "inProgress" as const }] };
  const added = applyPlanRequest(initial, { action: "add", content: "Implement" });
  const completed = applyPlanRequest(added, { action: "update", id: 1, status: "completed" });
  assert.deepEqual(initial, { nextId: 2, items: [{ id: 1, content: "Inspect", status: "inProgress" }] });
  assert.deepEqual(completed, {
    nextId: 3,
    items: [
      { id: 1, content: "Inspect", status: "completed" },
      { id: 2, content: "Implement", status: "pending" },
    ],
  });
});

test("rejects corrupt persisted plan state", () => {
  assert.throws(() => parsePlan({ nextId: 1, items: [{ id: 1, content: "Invalid", status: "pending" }] }), /nextId/);
  assert.throws(() => parsePlan({ nextId: 2, items: [{ id: 1, content: "Invalid", status: "mystery" }] }), /invalid item/);
});
