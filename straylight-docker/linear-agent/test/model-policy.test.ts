import assert from "node:assert/strict";
import { test } from "bun:test";
import { parseModelPolicy, selectedModelName } from "../src/model-policy.js";

const value = {
  classifier: { provider: "openai-codex", model: "gpt-5.6-luna", thinking: "low" },
  fallback: "terra",
  models: [
    { name: "luna", provider: "openai-codex", model: "gpt-5.6-luna", thinking: "low", description: "quick" },
    { name: "terra", provider: "openai-codex", model: "gpt-5.6-terra", thinking: "medium", description: "default" },
    { name: "sol", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high", description: "hard" },
  ],
};

test("parses an ordered model allowlist and classifier", () => {
  const policy = parseModelPolicy(value);
  assert.equal(policy.fallback, "terra");
  assert.deepEqual(policy.models.map((model) => `${model.name}:${model.thinking}`), ["luna:low", "terra:medium", "sol:high"]);
  assert.equal(selectedModelName('{"model":"sol","reason":"coupled"}', policy), "sol");
});

test("rejects a fallback outside the model allowlist", () => {
  assert.throws(() => parseModelPolicy({ ...value, fallback: "other" }), /not in the allowlist/);
});
