import assert from "node:assert/strict";
import { test } from "bun:test";
import { githubPullRequestUrl, isStopRequest } from "../src/controller.js";
import { claudeFollowUpPrompt, claudeInitialPrompt, currentLinearRequest } from "../src/prompts.js";
import { finalText, progressText, redact } from "../src/redaction.js";

test("builds a repository-aware initial prompt", () => {
  const prompt = claudeInitialPrompt({
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
  assert.match(prompt, /blocking Steering attention item/);
  assert.match(prompt, /finish_work/);
  assert.match(prompt, /manage_plan/);
  assert.match(prompt, /persistent notes under/);
  assert.match(prompt, /browser-rendered UI/);
  assert.doesNotMatch(prompt, /worktree\/branch/);
  assert.match(prompt, /include "NEMO-42" in its name/);
  assert.match(prompt, /an altitude filter/);
  assert.match(prompt, /linear_activity's non-blocking ask action/);
  assert.match(prompt, /it belongs in the durable session journal/);
  assert.match(prompt, /not a Signal comment/);
  assert.match(prompt, /can now join this conversation while you're still mid-task/);
});

test("uses the activity body for follow-ups", () => {
  const prompt = claudeFollowUpPrompt({ agentActivity: { content: { body: "Run the integration tests too." } } });
  assert.match(prompt, /Run the integration tests too/);
});

test("requires Claude to finish through the human-owned lifecycle", () => {
  const prompt = claudeInitialPrompt({
    agentSession: { id: "session", issue: { identifier: "GAB-5", title: "Try the repository" } },
    agentActivity: { content: { body: "Inspect the repository." } },
  });
  assert.match(prompt, /finish_work/);
  assert.match(prompt, /only three ordinary lifecycle transitions/);
  assert.match(prompt, /hand apparently finished work to QA/);
});

test("tells Claude it is resuming its own prior conversation on a routed mention", () => {
  const fresh = claudeInitialPrompt({
    agentSession: { id: "session", issue: { identifier: "GAB-5", title: "Try the repository" } },
    agentActivity: { content: { body: "One more thing on this issue." } },
  });
  assert.doesNotMatch(fresh, /resumes your own prior Claude Code conversation/);

  const resumed = claudeInitialPrompt({
    agentSession: { id: "session", issue: { identifier: "GAB-5", title: "Try the repository" } },
    agentActivity: { content: { body: "One more thing on this issue." } },
    resumeConversationId: "prior-conversation",
  });
  assert.match(resumed, /resumes your own prior Claude Code conversation/);
  assert.match(resumed, /Verify current state/);
  assert.match(resumed, /fresh, empty workspace container/);
  assert.match(resumed, /re-clone any repository/);
  assert.match(resumed, /local plan file is equally fresh/);
  assert.match(resumed, /start a fresh plan or list current plan state/);
  assert.doesNotMatch(fresh, /local plan file is equally fresh/);
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
  const prompt = claudeInitialPrompt(payload);
  assert.ok(prompt.indexOf("generate a bitmap duck") < prompt.indexOf("Report the current working directory"));
  assert.match(prompt, /Current Linear request \(authoritative\)/);
  assert.match(prompt, /Do not let an older issue description override the current request/);
});

test("classifies a resolved source comment instead of the stale thread root", () => {
  const payload = {
    action: "created",
    agentSession: {
      id: "session",
      comment: { id: "root", body: "Comment the working directory and name, then stop." },
      issue: { identifier: "GAB-5", title: "Agent QA" },
    },
    linearSourceComment: {
      id: "source",
      body: "@straylight handle the review comments on the attached document.",
      parentId: "root",
    },
  };
  assert.equal(currentLinearRequest(payload), "@straylight handle the review comments on the attached document.");
});

test("classifies a follow-up prompt instead of the session's original source comment", () => {
  const payload = {
    action: "prompted",
    agentActivity: { content: { body: "Now publish the reviewed document." } },
    agentSession: { id: "session", issue: { identifier: "GAB-5", title: "Agent QA" } },
    linearSourceComment: { id: "source", body: "First inspect the document comments." },
  };
  assert.equal(currentLinearRequest(payload), "Now publish the reviewed document.");
});

test("includes bounded Document review context after the authoritative mention", () => {
  const prompt = claudeInitialPrompt({
    action: "created",
    agentSession: {
      id: "session",
      comment: { id: "comment-2", body: "@straylight apply this review." },
      issue: { identifier: "GAB-12", title: "Review the setup document" },
    },
    linearDocumentReview: {
      document: { id: "doc-1", title: "Setup", url: "https://linear.app/document/doc-1", content: "# Setup\n\nOld wording." },
      comment: { id: "comment-2", body: "@straylight apply this review.", quotedText: "Old wording." },
      thread: [
        { id: "comment-1", body: "Please make this concrete.", quotedText: "Old wording.", user: { id: "user-1", name: "Gaby" } },
        { id: "comment-2", body: "@straylight apply this review.", parentId: "comment-1", user: { id: "user-1", name: "Gaby" } },
      ],
    },
  });
  assert.ok(prompt.indexOf("@straylight apply this review") < prompt.indexOf("Current Document Markdown"));
  assert.match(prompt, /Document review context/);
  assert.match(prompt, /Comment comment-1 by Gaby \[open\]/);
  assert.match(prompt, /Selected text for the current request: Old wording/);
  assert.match(prompt, /# Setup/);
});

test("recognizes explicit stop requests", () => {
  assert.equal(isStopRequest({ agentActivity: { signal: "stop", content: { body: "Please wrap up" } } }), true);
  assert.equal(isStopRequest({ action: "canceled" }), true);
  assert.equal(isStopRequest({ agentActivity: { content: { body: " stop " } } }), true);
  assert.equal(isStopRequest({ agentActivity: { content: { body: "keep going" } } }), false);
});

test("includes ranked workbench repositories without choosing for the agent", () => {
  const prompt = claudeInitialPrompt({
    agentSession: { id: "session" },
    workbench: {
      repositories: [{ hostname: "github.com", repositoryFullName: "GitSquared/nemo", path: "/repositories/nemo" }],
      repositorySuggestions: [{ hostname: "github.com", repositoryFullName: "GitSquared/nemo", confidence: 0.92 }],
    },
  });
  assert.match(prompt, /GitSquared\/nemo/);
  assert.match(prompt, /\/repositories\/nemo/);
  assert.match(prompt, /0\.92/);
  assert.match(prompt, /https:\/\/github\.com\/GitSquared\/nemo\.git/);
  assert.match(prompt, /manage_linear/);
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
