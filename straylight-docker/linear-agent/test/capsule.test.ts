import assert from "node:assert/strict";
import { test } from "bun:test";
import { validClaudeRequest } from "../src/capsule-client.js";

test("accepts only bounded non-empty Claude requests", () => {
  assert.equal(validClaudeRequest("Ask Claude to summarize the Slack thread"), true);
  assert.equal(validClaudeRequest("   "), false);
  assert.equal(validClaudeRequest("x".repeat(20_001)), false);
});
