import assert from "node:assert/strict";
import { test } from "bun:test";
import { isLinearManageRequest, isLinearUploadRequest } from "../src/linear-actions.js";

test("accepts generic issue, document, relation, subissue, and project operations", () => {
  assert.equal(isLinearManageRequest({ resource: "issue", operation: "update", fields: { priority: 2 } }), true);
  assert.equal(isLinearManageRequest({ resource: "relation", operation: "link", relatedId: "ENG-2", relationType: "blocks" }), true);
  assert.equal(isLinearManageRequest({ resource: "subissue", operation: "unlink", id: "ENG-3" }), true);
  assert.equal(isLinearManageRequest({ resource: "project", operation: "create", fields: { name: "Launch" } }), true);
  assert.equal(isLinearManageRequest({ resource: "document", operation: "list" }), true);
  assert.equal(isLinearManageRequest({ resource: "document", operation: "update", id: "doc-1", fields: { content: "# Revised" } }), true);
});

test("rejects raw or unknown Linear operations", () => {
  assert.equal(isLinearManageRequest({ resource: "graphql", operation: "execute" }), false);
  assert.equal(isLinearManageRequest({ resource: "issue", operation: "purge" }), false);
});

test("accepts only bounded Linear upload requests", () => {
  assert.equal(isLinearUploadRequest({ filename: "duck.png", contentType: "image/png", dataBase64: "AQID" }), true);
  assert.equal(isLinearUploadRequest({ filename: "../duck.png", contentType: "image/png", dataBase64: "AQID" }), false);
  assert.equal(isLinearUploadRequest({ filename: "duck.png", contentType: "image/png", dataBase64: "not base64" }), false);
});
