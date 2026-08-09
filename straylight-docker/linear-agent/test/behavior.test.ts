import assert from "node:assert/strict";
import { test } from "bun:test";
import { githubPullRequestUrl, isStopRequest } from "../src/controller.js";
import { currentLinearRequest, followUpPrompt, initialPrompt, modelSelectionPrompt } from "../src/prompts.js";
import { finalText, progressText, redact } from "../src/redaction.js";

test("builds a repository-aware initial prompt", () => {
  const prompt = initialPrompt({
    action: "created",
    agentSession: {
      id: "session",
      issue: { identifier: "NEMO-42", title: "Teach the fish to delegate", description: "Use the nemo repository." },
    },
    guidance: [{ body: "Keep the change targeted." }],
  });
  assert.match(prompt, /NEMO-42/);
  assert.match(prompt, /Use the nemo repository/);
  assert.match(prompt, /Keep the change targeted/);
  assert.match(prompt, /Do not push/);
  assert.match(prompt, /request_access/);
  assert.match(prompt, /manage_plan/);
  assert.match(prompt, /take actions in connected corporate systems/);
  assert.match(prompt, /persistent notes with memory/);
  assert.match(prompt, /reload_resources/);
  assert.doesNotMatch(prompt, /worktree\/branch/);
});

test("uses the activity body for follow-ups", () => {
  const prompt = followUpPrompt({ agentActivity: { content: { body: "Run the integration tests too." } } });
  assert.match(prompt, /Run the integration tests too/);
});

test("makes a mention comment authoritative over an older issue instruction", () => {
  const payload = {
    action: "created",
    promptContext: "Issue context and comments from Linear.",
    agentSession: {
      id: "session",
      comment: { id: "comment", body: "@straylight generate a bitmap duck and add it to the test document." },
      issue: {
        identifier: "GAB-5",
        title: "Generate duck bitmap picture for test document",
        description: "Report the current working directory and agent name.",
      },
    },
  };
  assert.equal(currentLinearRequest(payload), "@straylight generate a bitmap duck and add it to the test document.");
  const prompt = initialPrompt(payload);
  assert.ok(prompt.indexOf("generate a bitmap duck") < prompt.indexOf("Report the current working directory"));
  assert.match(prompt, /Current Linear request \(authoritative\)/);
  assert.match(prompt, /Do not let an older issue description override the current request/);

  const classifier = modelSelectionPrompt(payload);
  assert.ok(classifier.indexOf("generate a bitmap duck") < classifier.indexOf("Report the current working directory"));
  assert.match(classifier, /Current request \(authoritative\)/);
  assert.match(classifier, /Supporting issue description/);
});

test("recognizes explicit stop requests", () => {
  assert.equal(isStopRequest({ agentActivity: { signal: "stop", content: { body: "Please wrap up" } } }), true);
  assert.equal(isStopRequest({ action: "canceled" }), true);
  assert.equal(isStopRequest({ agentActivity: { content: { body: " stop " } } }), true);
  assert.equal(isStopRequest({ agentActivity: { content: { body: "keep going" } } }), false);
});

test("includes ranked workbench repositories without choosing for the agent", () => {
  const prompt = initialPrompt({
    agentSession: { id: "session" },
    workbench: {
      repositories: [{ hostname: "github.com", repositoryFullName: "GitSquared/nemo", path: "/repositories/nemo" }],
      repositorySuggestions: [{ hostname: "github.com", repositoryFullName: "GitSquared/nemo", confidence: 0.92 }],
    },
  });
  assert.match(prompt, /GitSquared\/nemo/);
  assert.match(prompt, /\/repositories\/nemo/);
  assert.match(prompt, /0\.92/);
  assert.match(prompt, /linear tool/);
});

test("redacts common credentials and sensitive URL parameters", () => {
  const safe = redact('Authorization: Bearer abcdefghijklmnop https://x.test/a?token=hello sk-abcdefghijklmnop {"refresh_token":"super-private-value"}'); // yadm-secret-scan: ignore
  assert.doesNotMatch(safe, /abcdefghijklmnop/);
  assert.doesNotMatch(safe, /super-private-value/);
  assert.match(safe, /redacted/);
});

test("bounds progress and final output", () => {
  assert.ok(progressText("x".repeat(500)).length <= 240);
  assert.ok(finalText("x".repeat(10_000)).length <= 8_000);
});

test("extracts a GitHub pull request for the Linear session", () => {
  assert.equal(
    githubPullRequestUrl("Opened https://github.com/GitSquared/nemo/pull/42 — ready for review."),
    "https://github.com/GitSquared/nemo/pull/42",
  );
  assert.equal(githubPullRequestUrl("No pull request was created."), undefined);
});
