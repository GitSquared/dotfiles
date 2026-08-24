import assert from "node:assert/strict";
import { test } from "bun:test";
import { AgentController } from "../src/controller.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";

type AttachmentCall = { issueId: string; url: string; title: string | undefined };

function baseLinear(overrides: Partial<LinearClient>): LinearClient {
  return {
    async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
    async beginHumanDelegation() {},
    async repositorySuggestions() { return []; },
    async createActivity() {},
    async addExternalUrl() {},
    ...overrides,
  } as unknown as LinearClient;
}

async function primedController(linear: LinearClient): Promise<AgentController> {
  const runner = {
    async repositories() { return []; },
    async health() { return { mode: "test" }; },
    async run() { return new Promise(() => {}); },
  } as unknown as AgentRunner;
  const controller = new AgentController(linear, runner);
  await controller.handle({
    action: "created",
    appUserId: "agent-1",
    agentSession: { id: "session-1", issueId: "issue-1", creatorId: "human-1", issue: { id: "issue-1", teamId: "team-1" } },
  });
  return controller;
}

test("prefers the rich GitHub pull request attachment for a PR link with no subtitle or body", async () => {
  const prCalls: AttachmentCall[] = [];
  const urlCalls: AttachmentCall[] = [];
  const basicCalls: unknown[] = [];
  const linear = baseLinear({
    async linkGitHubPullRequestAttachment(issueId: string, url: string, title?: string) {
      prCalls.push({ issueId, url, title });
      return { id: "attachment-1", title: title ?? "Pull request", url };
    },
    async linkUrlAttachment(issueId: string, url: string, title?: string) { urlCalls.push({ issueId, url, title }); throw new Error("should not be called"); },
    async createIssueAttachment(_issueId: string, attachment: unknown) { basicCalls.push(attachment); throw new Error("should not be called"); },
  });
  const controller = await primedController(linear);

  const result = await controller.collaborateLinear("session-1", {
    action: "publish",
    publication: { kind: "attachment", title: "Fix the thing", url: "https://github.com/acme/widgets/pull/42" },
  });

  assert.deepEqual(prCalls, [{ issueId: "issue-1", url: "https://github.com/acme/widgets/pull/42", title: "Fix the thing" }]);
  assert.equal(urlCalls.length, 0);
  assert.equal(basicCalls.length, 0);
  assert.deepEqual(result.data, { id: "attachment-1", title: "Fix the thing", url: "https://github.com/acme/widgets/pull/42", richness: "github_pr" });
});

test("uses the rich URL attachment for a non-PR link with no subtitle or body", async () => {
  const urlCalls: AttachmentCall[] = [];
  const linear = baseLinear({
    async linkGitHubPullRequestAttachment() { throw new Error("should not be called"); },
    async linkUrlAttachment(issueId: string, url: string, title?: string) {
      urlCalls.push({ issueId, url, title });
      return { id: "attachment-2", title: title ?? "Preview", url };
    },
    async createIssueAttachment() { throw new Error("should not be called"); },
  });
  const controller = await primedController(linear);

  const result = await controller.collaborateLinear("session-1", {
    action: "publish",
    publication: { kind: "attachment", title: "Preview deploy", url: "https://widgets-pr-42.vercel.app" },
  });

  assert.deepEqual(urlCalls, [{ issueId: "issue-1", url: "https://widgets-pr-42.vercel.app", title: "Preview deploy" }]);
  assert.deepEqual(result.data, { id: "attachment-2", title: "Preview deploy", url: "https://widgets-pr-42.vercel.app", richness: "url" });
});

test("skips the rich attachment mutations entirely when a subtitle or body is supplied", async () => {
  const basicCalls: unknown[] = [];
  const linear = baseLinear({
    async linkGitHubPullRequestAttachment() { throw new Error("should not be called"); },
    async linkUrlAttachment() { throw new Error("should not be called"); },
    async createIssueAttachment(issueId: string, attachment: unknown) {
      basicCalls.push({ issueId, attachment });
      return { id: "attachment-3", title: "Fix the thing", url: "https://github.com/acme/widgets/pull/42" };
    },
  });
  const controller = await primedController(linear);

  const result = await controller.collaborateLinear("session-1", {
    action: "publish",
    publication: { kind: "attachment", title: "Fix the thing", url: "https://github.com/acme/widgets/pull/42", subtitle: "Ready for review" },
  });

  assert.equal(basicCalls.length, 1);
  assert.deepEqual(result.data, { id: "attachment-3", title: "Fix the thing", url: "https://github.com/acme/widgets/pull/42", richness: "basic" });
  assert.equal((result.data as { fallbackReason?: string }).fallbackReason, undefined, "no rich attempt was made, so there is nothing to report a fallback from");
});

test("falls back through url-link to a basic attachment when every richer attempt fails, and reports why", async () => {
  const linear = baseLinear({
    async linkGitHubPullRequestAttachment() { throw new Error("GitHub integration not configured"); },
    async linkUrlAttachment() { throw new Error("Linear rejected the URL attachment"); },
    async createIssueAttachment(_issueId: string, attachment: { title: string; url: string }) {
      return { id: "attachment-4", title: attachment.title, url: attachment.url };
    },
  });
  const controller = await primedController(linear);

  const result = await controller.collaborateLinear("session-1", {
    action: "publish",
    publication: { kind: "attachment", title: "Fix the thing", url: "https://github.com/acme/widgets/pull/42" },
  });

  assert.deepEqual(result.data, {
    id: "attachment-4",
    title: "Fix the thing",
    url: "https://github.com/acme/widgets/pull/42",
    richness: "basic",
    fallbackReason: "a richer Linear attachment link failed; used a basic attachment instead",
  });
});

test("falls back from a failed GitHub pull request link to the generic rich URL link, not straight to basic", async () => {
  const linear = baseLinear({
    async linkGitHubPullRequestAttachment() { throw new Error("GitHub integration not configured for this repository"); },
    async linkUrlAttachment(_issueId: string, url: string, title?: string) {
      return { id: "attachment-5", title: title ?? "Pull request", url };
    },
    async createIssueAttachment() { throw new Error("should not be called"); },
  });
  const controller = await primedController(linear);

  const result = await controller.collaborateLinear("session-1", {
    action: "publish",
    publication: { kind: "attachment", title: "Fix the thing", url: "https://github.com/acme/widgets/pull/42" },
  });

  assert.deepEqual(result.data, {
    id: "attachment-5",
    title: "Fix the thing",
    url: "https://github.com/acme/widgets/pull/42",
    richness: "url",
  });
});
