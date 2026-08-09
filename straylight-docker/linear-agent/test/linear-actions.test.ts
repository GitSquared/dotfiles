import assert from "node:assert/strict";
import { test } from "bun:test";
import { isLinearManageRequest } from "../src/linear-actions.js";

test("accepts generic issue, relation, subissue, and project operations", () => {
  assert.equal(isLinearManageRequest({ resource: "issue", operation: "update", fields: { priority: 2 } }), true);
  assert.equal(isLinearManageRequest({ resource: "relation", operation: "link", relatedId: "ENG-2", relationType: "blocks" }), true);
  assert.equal(isLinearManageRequest({ resource: "subissue", operation: "unlink", id: "ENG-3" }), true);
  assert.equal(isLinearManageRequest({ resource: "project", operation: "create", fields: { name: "Launch" } }), true);
});

test("rejects raw or unknown Linear operations", () => {
  assert.equal(isLinearManageRequest({ resource: "graphql", operation: "execute" }), false);
  assert.equal(isLinearManageRequest({ resource: "issue", operation: "purge" }), false);
});
