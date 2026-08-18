import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import { ClaudeHarness } from "../src/claude.js";
import type { RunnerConfig } from "../src/config.js";

function config(workdir: string): RunnerConfig {
  return {
    runnerBackend: "claude",
    host: "127.0.0.1",
    port: 8788,
    piWorkdir: workdir,
    piSessionDirectory: path.join(workdir, "pi-sessions"),
    piConfigDirectory: path.join(workdir, "pi-config"),
    memoryDirectory: path.join(workdir, "memory"),
    piTheme: "dark",
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
    const requests: Array<{ prompt: string; resume?: string; model?: string }> = [];
    const capsule = {
      async runBrokeredAgent(request: { prompt: string; resume?: string; model?: string }) {
        requests.push(request);
        return {
          status: "ok" as const,
          answer: requests.length === 1 ? "Implemented the change." : "Applied the follow-up.",
          sessionId: "claude-session-1",
          awaitingInput: false,
          durationMs: 12,
        };
      },
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
    assert.match(requests[0]?.prompt ?? "", /primary Claude Code coding agent/);
    assert.equal(requests[0]?.resume, undefined);
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

test("runs shell commands in the task workspace and strips broker credentials", async () => {
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-claude-shell-"));
  const previous = process.env.PI_RUNNER_TOKEN;
  process.env.PI_RUNNER_TOKEN = "secret-runner-token-value"; // yadm-secret-scan: ignore
  try {
    const harness = new ClaudeHarness(config(workdir), { async runBrokeredAgent() { throw new Error("unused"); } });
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
      { async runBrokeredAgent() { throw new Error("unused"); } },
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
    const harness = new ClaudeHarness(config(workdir), { async runBrokeredAgent() { throw new Error("unused"); } });
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
