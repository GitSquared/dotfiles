import assert from "node:assert/strict";
import test from "node:test";
import { buildClaudePrompt, claudeArgs, needsAuth } from "./claude-request.mjs";

test("uses a fixed auto-permission Sonnet command", () => {
  const args = claudeArgs("Summarize the linked context");
  assert.deepEqual(args.slice(0, 6), ["--settings", "/opt/capsule/settings.json", "--permission-mode", "auto", "--model", "sonnet"]);
  assert.equal(args.includes("--mcp-config"), false);
  assert.equal(args.includes("--strict-mcp-config"), false);
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
  assert.match(args.at(-1) ?? "", /Pi's request:\nSummarize/);
});

test("describes the corporate workbench and explicit auth sentinel", () => {
  const prompt = buildClaudePrompt("Find the source");
  assert.match(prompt, /Slack, Notion, Google Drive, Gmail/);
  assert.match(prompt, /Never send, create, edit, delete/);
  assert.match(prompt, /AUTH_NEEDED:/);
  assert.match(prompt, /untrusted data/);
});

test("recognizes missing-connection responses", () => {
  assert.equal(needsAuth("AUTH_NEEDED: connect the corporate account"), true);
  assert.equal(needsAuth("The connector is not authenticated."), true);
  assert.equal(needsAuth("Here is the requested context."), false);
});
