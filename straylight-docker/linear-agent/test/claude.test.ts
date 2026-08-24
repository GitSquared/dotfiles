import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import { ClaudeHarness } from "../src/claude.js";
import type { RunnerConfig } from "../src/config.js";
import type { LinearInputFile } from "../src/types.js";

function config(workdir: string): RunnerConfig {
  return {
    host: "127.0.0.1",
    port: 8788,
    piWorkdir: workdir,
    memoryDirectory: path.join(workdir, "memory"),
    piTimeoutMs: 1_800_000,
    progressDebounceMs: 3_000,
    progressHeartbeatMs: 300_000,
    authToken: "r".repeat(32), // yadm-secret-scan: ignore
    capsuleUrl: "http://linear-agent-runner:8788",
    workbenchUrl: "http://linear-agent-runner:8788",
    capsuleAuthUrl: "https://straylight.example.test/linear/capsule/auth",
    toolAuthUrl: "https://straylight.example.test/linear/tools/auth",
  };
}

test("uses Claude as a resumable brokered runner without mounting its identity into the task", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-"));
  try {
    await fs.writeFile(path.join(workdir, "AGENTS.md"), "Work carefully.\n");
    const requests: Array<{ prompt: string; resume?: string; model?: string; timeBudgetMs?: number }> = [];
    const capsule = {
      async runBrokeredAgent(request: { prompt: string; resume?: string; model?: string; timeBudgetMs?: number }) {
        requests.push(request);
        return {
          status: "ok" as const,
          answer: requests.length === 1 ? "Implemented the change." : "Applied the follow-up.",
          sessionId: "claude-session-1",
          awaitingInput: true,
          durationMs: 12,
          disposition: { status: "awaiting_qa" as const, reason: "Implemented and checked; ready for approval." },
        };
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const harness = new ClaudeHarness(config(workdir), capsule);
    const events: unknown[] = [];
    const first = await harness.run({
      action: "created",
      agentSession: { id: "linear-session-1", issueId: "issue-1", issue: { id: "issue-1", title: "Build it" } },
      agentActivity: { content: { body: "Implement the requested slice." } },
    }, async (event) => { events.push(event); });
    assert.equal(first.ok, true);
    assert.equal(first.summary, "Implemented the change.");
    assert.equal(first.disposition?.status, "awaiting_qa");
    assert.match(requests[0]?.prompt ?? "", /primary Claude Code coding agent/);
    assert.equal(requests[0]?.resume, undefined);
    assert.equal(requests[0]?.timeBudgetMs, 1_800_000);
    assert.equal(events.length, 1);

    await harness.run({
      action: "prompted",
      agentSession: { id: "linear-session-1", issueId: "issue-1" },
      agentActivity: { content: { body: "Please tighten the copy." } },
    }, async () => {});
    assert.equal(requests[1]?.resume, "claude-session-1");
    assert.match(requests[1]?.prompt ?? "", /Please tighten the copy/);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("aborts and reports a Claude run when the configured runner deadline expires", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-timeout-"));
  try {
    const timedConfig = { ...config(workdir), piTimeoutMs: 20 };
    const capsule = {
      async runBrokeredAgent(_request: unknown, signal?: AbortSignal): Promise<never> {
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new Error("aborted"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const harness = new ClaudeHarness(timedConfig, capsule);
    const result = await harness.run({
      action: "created",
      agentSession: { id: "linear-timeout-session", issueId: "issue-1", issue: { id: "issue-1", title: "Long task" } },
      agentActivity: { content: { body: "Keep working." } },
    }, async () => {});
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.match(result.summary, /Claude Code run timed out/);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("persists Claude's session id after a non-success result so the next turn can resume", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-recovery-"));
  try {
    const requests: Array<{ resume?: string }> = [];
    const capsule = {
      async runBrokeredAgent(request: { resume?: string }) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            status: "error" as const,
            message: "The upstream model stopped the run.",
            sessionId: "recoverable-claude-session",
            durationMs: 42,
          };
        }
        return {
          status: "ok" as const,
          answer: "Recovered and ready for QA.",
          sessionId: "recoverable-claude-session",
          awaitingInput: true,
          durationMs: 12,
          disposition: { status: "awaiting_qa" as const, reason: "Recovered, checked, and ready for approval." },
        };
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const harness = new ClaudeHarness(config(workdir), capsule);
    const payload = {
      action: "created" as const,
      agentSession: { id: "linear-recovery-session", issueId: "issue-1", issue: { id: "issue-1", title: "Recover it" } },
      agentActivity: { content: { body: "Keep the useful work." } },
    };
    const failed = await harness.run(payload, async () => {});
    assert.equal(failed.ok, false);
    assert.match(failed.summary, /upstream model stopped/);

    const resumed = await harness.run({ ...payload, action: "prompted" }, async () => {});
    assert.equal(resumed.ok, true);
    assert.equal(requests[1]?.resume, "recoverable-claude-session");
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("resumes a controller-supplied conversation for a fresh Linear session with no local history", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-mention-"));
  try {
    const requests: Array<{ resume?: string }> = [];
    const capsule = {
      async runBrokeredAgent(request: { resume?: string }) {
        requests.push(request);
        return {
          status: "ok" as const,
          answer: "Picked up where the last mention left off.",
          sessionId: "prior-issue-conversation",
          awaitingInput: true,
          durationMs: 8,
          disposition: { status: "awaiting_qa" as const, reason: "Checked and ready for approval." },
        };
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const harness = new ClaudeHarness(config(workdir), capsule);
    const result = await harness.run({
      action: "created",
      agentSession: { id: "linear-session-brand-new", issueId: "issue-1", issue: { id: "issue-1", title: "Build it" } },
      agentActivity: { content: { body: "One more thing on this issue." } },
      resumeConversationId: "prior-issue-conversation",
    }, async () => {});
    assert.equal(requests[0]?.resume, "prior-issue-conversation");
    assert.equal(result.conversationId, "prior-issue-conversation");
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("prefers this session's own local history over a controller-supplied resume hint", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-mention-priority-"));
  try {
    const requests: Array<{ resume?: string }> = [];
    const capsule = {
      async runBrokeredAgent(request: { resume?: string }) {
        requests.push(request);
        return {
          status: "ok" as const,
          answer: "Continued this session's own thread.",
          sessionId: "this-sessions-own-conversation",
          awaitingInput: true,
          durationMs: 4,
          disposition: { status: "awaiting_qa" as const, reason: "Checked and ready for approval." },
        };
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const harness = new ClaudeHarness(config(workdir), capsule);
    await harness.run({
      action: "created",
      agentSession: { id: "linear-session-own-history", issueId: "issue-1", issue: { id: "issue-1", title: "Build it" } },
      agentActivity: { content: { body: "Start the work." } },
    }, async () => {});
    await harness.run({
      action: "prompted",
      agentSession: { id: "linear-session-own-history", issueId: "issue-1" },
      agentActivity: { content: { body: "Keep going." } },
      resumeConversationId: "some-other-issue-conversation",
    }, async () => {});
    assert.equal(requests[1]?.resume, "this-sessions-own-conversation");
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("reports visible progress while Claude is quiet", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-progress-"));
  try {
    const progressConfig = { ...config(workdir), progressDebounceMs: 1, progressHeartbeatMs: 10 };
    const capsule = {
      async runBrokeredAgent() {
        await Bun.sleep(45);
        return {
          status: "ok" as const,
          answer: "Ready for review.",
          sessionId: "claude-progress-session",
          awaitingInput: true,
          durationMs: 45,
          disposition: { status: "awaiting_qa" as const, reason: "Checked and ready for approval." },
        };
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const events: unknown[] = [];
    const harness = new ClaudeHarness(progressConfig, capsule);
    await harness.run({
      action: "created",
      agentSession: { id: "linear-progress-session", issueId: "issue-1" },
      agentActivity: { content: { body: "Work quietly for a while." } },
    }, async (event) => { events.push(event); });
    assert.equal(events.some((event) => (event as { content?: { body?: string } }).content?.body === "The agent is still working."), true);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("publishes safe semantic Claude progress into Linear activity", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-semantic-progress-"));
  try {
    const progressConfig = { ...config(workdir), progressDebounceMs: 1, progressHeartbeatMs: 300_000 };
    const capsule = {
      async runBrokeredAgent(
        _request: unknown,
        _signal?: AbortSignal,
        onProgress?: (progress: { type: "thought"; body: string } | { type: "action"; action: string; parameter: string }) => void,
      ) {
        onProgress?.({ type: "thought", body: "Inspecting Authorization: Bearer very-secret-token-value." });
        await Bun.sleep(3);
        onProgress?.({ type: "action", action: "Running bash", parameter: "bun test" });
        await Bun.sleep(3);
        return {
          status: "ok" as const,
          answer: "Ready for review.",
          sessionId: "claude-semantic-progress-session",
          awaitingInput: true,
          durationMs: 6,
          disposition: { status: "awaiting_qa" as const, reason: "Checked and ready for approval." },
        };
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const events: unknown[] = [];
    const harness = new ClaudeHarness(progressConfig, capsule);
    await harness.run({
      action: "created",
      agentSession: { id: "linear-semantic-progress-session", issueId: "issue-1" },
      agentActivity: { content: { body: "Inspect and test." } },
    }, async (event) => { events.push(event); });
    assert.equal(events.some((event) => (event as { content?: { body?: string } }).content?.body === "Inspecting Authorization: Bearer [redacted]"), true);
    assert.equal(events.some((event) => (event as { content?: { action?: string } }).content?.action === "Running bash"), true);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("posts a completed action durably while in-progress actions and thoughts stay ephemeral", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-durable-progress-"));
  try {
    const progressConfig = { ...config(workdir), progressDebounceMs: 1, progressHeartbeatMs: 300_000 };
    const capsule = {
      async runBrokeredAgent(
        _request: unknown,
        _signal?: AbortSignal,
        onProgress?: (progress:
          | { type: "thought"; body: string }
          | { type: "action"; action: string; parameter: string; result?: string }) => void,
      ) {
        onProgress?.({ type: "thought", body: "Looking at the failing test." });
        await Bun.sleep(3);
        onProgress?.({ type: "action", action: "Running bash", parameter: "bun test" });
        await Bun.sleep(3);
        onProgress?.({ type: "action", action: "Running bash", parameter: "bun test", result: "12 passed" });
        await Bun.sleep(3);
        return {
          status: "ok" as const,
          answer: "Ready for review.",
          sessionId: "claude-durable-progress-session",
          awaitingInput: true,
          durationMs: 9,
          disposition: { status: "awaiting_qa" as const, reason: "Checked and ready for approval." },
        };
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const events: Array<{ ephemeral: boolean; content: { type: string; body?: string; result?: string } }> = [];
    const harness = new ClaudeHarness(progressConfig, capsule);
    await harness.run({
      action: "created",
      agentSession: { id: "linear-durable-progress-session", issueId: "issue-1" },
      agentActivity: { content: { body: "Fix the failing test." } },
    }, async (event) => { events.push(event as typeof events[number]); });

    const thought = events.find((event) => event.content.type === "thought");
    assert.equal(thought?.ephemeral, true);

    const inProgress = events.find((event) => event.content.type === "action" && event.content.result === undefined);
    assert.equal(inProgress?.ephemeral, true);

    const completed = events.find((event) => event.content.type === "action" && event.content.result === "12 passed");
    assert.equal(completed?.ephemeral, false);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("runs shell commands in the task workspace and strips broker credentials", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-shell-"));
  const previous = process.env.PI_RUNNER_TOKEN;
  process.env.PI_RUNNER_TOKEN = "secret-runner-token-value"; // yadm-secret-scan: ignore
  try {
    const harness = new ClaudeHarness(config(workdir), { async runBrokeredAgent() { throw new Error("unused"); }, async followUpBrokered() { throw new Error("unused"); } });
    const result = await harness.shell({ command: "pwd; printf '%s' \"${PI_RUNNER_TOKEN-unset}\"" });
    assert.equal(result.ok, true);
    assert.match(result.stdout, new RegExp(workdir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.stdout, /unset/);
    assert.doesNotMatch(result.stdout, /secret-runner-token-value/);
  } finally {
    if (previous === undefined) delete process.env.PI_RUNNER_TOKEN;
    else process.env.PI_RUNNER_TOKEN = previous;
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("applies a unified diff inside the selected workspace directory", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-patch-"));
  try {
    const repository = path.join(workdir, "repository");
    await fs.mkdir(repository);
    await fs.writeFile(path.join(repository, "note.txt"), "before\n");
    const harness = new ClaudeHarness(config(workdir), { async runBrokeredAgent() { throw new Error("unused"); }, async followUpBrokered() { throw new Error("unused"); } });
    const result = await harness.applyPatch({
      directory: "repository",
      patch: [
        "diff --git a/note.txt b/note.txt",
        "--- a/note.txt",
        "+++ b/note.txt",
        "@@ -1 +1 @@",
        "-before",
        "+after",
        "",
      ].join("\n"),
    });
    assert.equal(result.ok, true);
    assert.equal(await fs.readFile(path.join(repository, "note.txt"), "utf8"), "after\n");
    await assert.rejects(
      harness.applyPatch({ directory: "..", patch: "not a patch" }),
      /inside \/workspace/,
    );
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("persists and incrementally mirrors Claude's durable task plan", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-plan-"));
  try {
    const collaborations: unknown[] = [];
    const linear = {
      async upload() { throw new Error("unused"); },
      async collaborate(request: unknown) {
        collaborations.push(request);
        return { ok: true as const, action: "plan" as const, data: { mirrored: true } };
      },
    };
    const harness = new ClaudeHarness(
      config(workdir),
      { async runBrokeredAgent() { throw new Error("unused"); }, async followUpBrokered() { throw new Error("unused"); } },
      linear,
    );
    const replaced = await harness.managePlan({
      action: "replace",
      steps: [
        { content: "Inspect the affected path", status: "completed" },
        { content: "Implement and verify", status: "inProgress" },
      ],
    });
    assert.equal(replaced.mirrored, true);
    await harness.managePlan({ action: "add", content: "Prepare QA evidence" });
    const listed = await harness.managePlan({ action: "list" });
    assert.deepEqual(listed.plan.items.map(({ id, content, status }) => ({ id, content, status })), [
      { id: 1, content: "Inspect the affected path", status: "completed" },
      { id: 2, content: "Implement and verify", status: "inProgress" },
      { id: 3, content: "Prepare QA evidence", status: "pending" },
    ]);
    assert.equal(collaborations.length, 2);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(workdir, ".straylight", "plan.json"), "utf8")), listed.plan);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("uploads a workspace artifact through the Linear broker and shares it for review", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-artifact-"));
  try {
    await fs.mkdir(path.join(workdir, "review"));
    await fs.writeFile(path.join(workdir, "review", "preview.png"), "checked-preview");
    let upload: { filename: string; contentType: string; contents: string } | undefined;
    let collaboration: unknown;
    const linear = {
      async upload(filename: string, contentType: string, contents: Uint8Array) {
        upload = { filename, contentType, contents: Buffer.from(contents).toString("utf8") };
        return "https://uploads.linear.app/private/preview";
      },
      async collaborate(request: unknown) {
        collaboration = request;
        return { ok: true as const, action: "activity" as const };
      },
    };
    const harness = new ClaudeHarness(
      config(workdir),
      { async runBrokeredAgent() { throw new Error("unused"); }, async followUpBrokered() { throw new Error("unused"); } },
      linear,
    );
    const result = await harness.shareArtifact({
      path: "review/preview.png",
      title: "Preview",
      body: "Checked at desktop and mobile widths.",
    });
    assert.deepEqual(upload, { filename: "preview.png", contentType: "image/png", contents: "checked-preview" });
    assert.deepEqual(collaboration, {
      action: "activity",
      content: {
        type: "thought",
        body: "Checked at desktop and mobile widths.\n\n![Preview](https://uploads.linear.app/private/preview)",
      },
    });
    assert.equal(result.assetUrl, "https://uploads.linear.app/private/preview");
    await assert.rejects(harness.shareArtifact({ path: "../outside.png" }), /inside \/workspace|ENOENT/);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("returns only bounded workspace images as visual model input", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-image-"));
  try {
    const png = Buffer.from("iVBORw0KGgo=", "base64");
    await fs.writeFile(path.join(workdir, "intent.png"), png);
    await fs.writeFile(path.join(workdir, "intent.svg"), "<svg/>");
    const harness = new ClaudeHarness(config(workdir), { async runBrokeredAgent() { throw new Error("unused"); }, async followUpBrokered() { throw new Error("unused"); } });
    assert.deepEqual(await harness.viewImage({ path: "intent.png" }), {
      ok: true,
      dataBase64: png.toString("base64"),
      mimeType: "image/png",
    });
    await assert.rejects(harness.viewImage({ path: "intent.svg" }), /supports PNG, JPEG, GIF, and WebP/);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("resets the idle timeout on progress instead of enforcing one hard wall-clock deadline", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-idle-"));
  try {
    const idleConfig = { ...config(workdir), piTimeoutMs: 30 };
    const capsule = {
      async runBrokeredAgent(
        _request: unknown,
        _signal?: AbortSignal,
        onProgress?: (progress: { type: "thought"; body: string }) => void,
      ) {
        for (let i = 0; i < 5; i += 1) {
          await Bun.sleep(15);
          onProgress?.({ type: "thought", body: `Still working (${i}).` });
        }
        return {
          status: "ok" as const,
          answer: "Done despite a total duration past the idle budget.",
          sessionId: "claude-idle-session",
          awaitingInput: true,
          durationMs: 75,
          disposition: { status: "awaiting_qa" as const, reason: "Checked and ready for approval." },
        };
      },
      async followUpBrokered() { throw new Error("unused"); },
    };
    const harness = new ClaudeHarness(idleConfig, capsule);
    const result = await harness.run({
      action: "created",
      agentSession: { id: "linear-idle-session", issueId: "issue-1" },
      agentActivity: { content: { body: "Keep working steadily." } },
    }, async () => {});
    assert.equal(result.timedOut, false);
    assert.equal(result.ok, true);
    assert.equal(result.summary, "Done despite a total duration past the idle budget.");
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("pushes a follow-up into the live capsule turn and reports whether it landed", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-followup-"));
  try {
    const calls: Array<{ content: string; shouldQuery?: boolean }> = [];
    const harness = new ClaudeHarness(config(workdir), {
      async runBrokeredAgent() { throw new Error("unused"); },
      async followUpBrokered(content: string, shouldQuery?: boolean) {
        calls.push({ content, ...(shouldQuery !== undefined ? { shouldQuery } : {}) });
        return { accepted: calls.length === 1 };
      },
    });
    assert.equal(await harness.followUp("linear-session-1", "Actually, hold off on the migration."), true);
    assert.equal(await harness.followUp("linear-session-1", "One more thing."), false);
    assert.deepEqual(calls, [
      { content: "Actually, hold off on the migration." },
      { content: "One more thing." },
    ]);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("declines a follow-up carrying new input files, deferring to the cold queue", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-followup-inputs-"));
  try {
    const harness = new ClaudeHarness(config(workdir), {
      async runBrokeredAgent() { throw new Error("unused"); },
      async followUpBrokered() { throw new Error("must not be called when inputs are attached"); },
    });
    const inputs: LinearInputFile[] = [{ filename: "spec.pdf", mimeType: "application/pdf", size: 3, dataBase64: "abc" }];
    assert.equal(await harness.followUp("linear-session-1", "See the attached spec.", inputs), false);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});

test("treats a failed live push as a decline rather than throwing", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-followup-error-"));
  try {
    const harness = new ClaudeHarness(config(workdir), {
      async runBrokeredAgent() { throw new Error("unused"); },
      async followUpBrokered(): Promise<never> { throw new Error("capsule unreachable"); },
    });
    assert.equal(await harness.followUp("linear-session-1", "Ping"), false);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
});
