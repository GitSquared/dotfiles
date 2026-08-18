import assert from "node:assert/strict";
import { test } from "bun:test";
import { isLinearManageRequest, isLinearSessionRequest, isLinearUploadRequest } from "../src/linear-actions.js";

test("accepts generic issue, document, comment, relation, subissue, and project operations", () => {
  assert.equal(isLinearManageRequest({ resource: "issue", operation: "update", fields: { priority: 2 } }), true);
  assert.equal(isLinearManageRequest({ resource: "relation", operation: "link", relatedId: "ENG-2", relationType: "blocks" }), true);
  assert.equal(isLinearManageRequest({ resource: "subissue", operation: "unlink", id: "ENG-3" }), true);
  assert.equal(isLinearManageRequest({ resource: "project", operation: "create", fields: { name: "Launch" } }), true);
  assert.equal(isLinearManageRequest({ resource: "document", operation: "list" }), true);
  assert.equal(isLinearManageRequest({ resource: "document", operation: "update", id: "doc-1", fields: { content: "# Revised" } }), true);
  assert.equal(isLinearManageRequest({ resource: "comment", operation: "list", parentId: "doc-1" }), true);
  assert.equal(isLinearManageRequest({ resource: "comment", operation: "reply", id: "comment-1", fields: { body: "Applied." } }), true);
  assert.equal(isLinearManageRequest({ resource: "comment", operation: "resolve", id: "comment-1", relatedId: "reply-1" }), true);
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

test("accepts bounded generic Agent Session collaboration", () => {
  assert.equal(isLinearSessionRequest({
    action: "attention",
    request: {
      kind: "qa",
      delivery: "queue",
      priority: "medium",
      blocking: true,
      title: "Review the preview",
      action: "Approve or point to the first visual mismatch.",
      originalIntent: "Match the reviewed account header design.",
      delta: "The implementation and responsive states are ready.",
      recommendation: "Approve; the checked states match the reference.",
      impact: "Nothing ships until review; waiting has no customer impact.",
      timing: "No immediate deadline; review at the next normal break.",
      evidence: [{ label: "Preview", url: "https://preview.example.test" }],
    },
  }), true);
  assert.equal(isLinearSessionRequest({
    action: "activity",
    content: { type: "elicitation", body: "Choose a repository" },
    signal: "select",
    signalMetadata: { options: [{ label: "Nemo", value: "nemo" }, { label: "Dotfiles", value: "dotfiles" }] },
  }), true);
  assert.equal(isLinearSessionRequest({ action: "external_url", label: "Review", url: "https://example.com/review" }), true);
  assert.equal(isLinearSessionRequest({ action: "plan", steps: [{ content: "Inspect", status: "inProgress" }] }), true);
  assert.equal(isLinearSessionRequest({
    action: "publish",
    publication: { kind: "document", id: "doc-1", title: "Review", body: "# Review", update: true },
  }), true);
});

test("rejects unsafe or malformed Agent Session collaboration", () => {
  assert.equal(isLinearSessionRequest({
    action: "attention",
    request: {
      kind: "qa",
      delivery: "queue",
      title: "Review this",
      action: "Approve it.",
      originalIntent: "Build it.",
      delta: "It is done.",
      recommendation: "Approve.",
      impact: "Work remains paused.",
      timing: "Whenever.",
    },
  }), false);
  assert.equal(isLinearSessionRequest({ action: "external_url", label: "Local", url: "http://localhost:3000" }), false);
  assert.equal(isLinearSessionRequest({ action: "external_url", label: "Secret", url: "https://user:password@example.com" }), false);
  assert.equal(isLinearSessionRequest({ action: "activity", content: { type: "thought", body: "" } }), false);
  assert.equal(isLinearSessionRequest({ action: "activity", content: { type: "elicitation", body: "Choose" }, signal: "select" }), false);
  assert.equal(isLinearSessionRequest({
    action: "activity",
    content: { type: "elicitation", body: "Authenticate" },
    signal: "select",
    signalMetadata: { url: "https://example.com/auth" },
  }), false);
  assert.equal(isLinearSessionRequest({ action: "plan", steps: [{ content: "Inspect", status: "surprise" }] }), false);
});
