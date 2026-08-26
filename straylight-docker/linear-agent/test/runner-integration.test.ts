import assert from "node:assert/strict";
import { test } from "bun:test";
import { CapsuleClient } from "../src/capsule-client.js";
import { LinearToolClient } from "../src/linear-tool-client.js";
import { PiRunnerClient } from "../src/runner-client.js";
import { createRunnerServer } from "../src/runner-server.js";
import { ServiceClient } from "../src/service-client.js";

test("streams structured events across the controller-runner boundary", async () => {
  let followUpInputs: unknown;
  let uploaded: { token: string; filename: string; contentType: string; dataBase64: string } | undefined;
  let collaboration: unknown;
  let sharedArtifact: unknown;
  let viewedImage: unknown;
  let appliedPatch: unknown;
  let managedPlan: unknown;
  let runPayload: unknown;
  const harness = {
    async runClaude(taskCredential: string, request: { prompt: string; resume?: string }, _signal?: AbortSignal, onProgress?: (progress: { type: "thought"; body: string }) => void) {
      if (taskCredential === "one-time-task-token" && request.prompt === "Implement it") {
        onProgress?.({ type: "thought", body: "Inspecting the affected module." });
        return { status: "ok" as const, answer: "Ready for QA.", sessionId: request.resume ?? "claude-session", awaitingInput: true, durationMs: 9, disposition: { status: "awaiting_qa" as const, reason: "Implemented, checked, and ready for approval." } };
      }
      return { status: "error" as const, message: "Unauthorized." };
    },
    async shell(request: { command: string }) {
      return { ok: true, exitCode: 0, stdout: request.command, stderr: "" };
    },
    async applyPatch(request: { patch: string; directory?: string }) {
      appliedPatch = request;
      return { ok: true, exitCode: 0, stdout: "applied", stderr: "" };
    },
    async managePlan(request: unknown) {
      managedPlan = request;
      return {
        ok: true as const,
        plan: { nextId: 2, items: [{ id: 1, content: "Implement", status: "inProgress" as const }] },
        mirrored: true,
        message: "Durable plan updated and mirrored to Linear.",
      };
    },
    async shareArtifact(request: { path: string; title?: string }) {
      sharedArtifact = request;
      return {
        ok: true as const,
        assetUrl: "https://uploads.linear.app/workspace/preview",
        contentType: "image/png",
        filename: "preview.png",
      };
    },
    async viewImage(request: { path: string }) {
      viewedImage = request;
      return { ok: true as const, dataBase64: "aW1hZ2U=", mimeType: "image/png" };
    },
    async manageService(taskCredential: string, request: { action: "start"; service: "postgres" }) {
      return taskCredential === "one-time-task-token"
        ? { ok: true, service: request.service, status: "starting" as const, connection: { host: "postgres", port: 5432 } }
        : { ok: false, service: request.service, status: "failed" as const, message: "Unauthorized task service request" };
    },
    async uploadLinearFile(taskCredential: string, request: { filename: string; contentType: string; dataBase64: string }) {
      uploaded = { token: taskCredential, ...request };
      return "https://uploads.linear.app/workspace/duck-png";
    },
    async collaborateLinear(taskCredential: string, request: unknown) {
      assert.equal(taskCredential, "one-time-task-token");
      collaboration = request;
      return { ok: true as const, action: "external_url" as const };
    },
    async run(payload: unknown, send: (event: {
      type: "activity";
      content: { type: "action"; action: string; parameter: string };
      ephemeral: true;
    }) => Promise<void>) {
      runPayload = payload;
      await send({ type: "activity", content: { type: "action", action: "Running tests", parameter: "npm test" }, ephemeral: true });
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 12, conversationId: "claude-conversation" };
    },
    async followUp(_sessionId: string, _prompt: string, inputs?: unknown) { followUpInputs = inputs; return true; },
    async abort(_sessionId: string) { return true; },
  };
  const token = "runner-test-token"; // yadm-secret-scan: ignore
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createRunnerServer(harness, token),
  });
  const baseUrl = server.url.origin;

  try {
    const unauthorized = await fetch(`${baseUrl}/repositories`);
    assert.equal(unauthorized.status, 401);
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    const agentProgress: unknown[] = [];
    const agent = await new CapsuleClient(baseUrl, "one-time-task-token").runBrokeredAgent(
      { prompt: "Implement it" },
      undefined,
      (progress) => { agentProgress.push(progress); },
    ); // yadm-secret-scan: ignore
    assert.deepEqual(agent, { status: "ok", answer: "Ready for QA.", sessionId: "claude-session", awaitingInput: true, durationMs: 9, disposition: { status: "awaiting_qa", reason: "Implemented, checked, and ready for approval." } });
    assert.deepEqual(agentProgress, [{ type: "thought", body: "Inspecting the affected module." }]);
    const shell = await fetch(`${baseUrl}/v1/shell`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "pwd" }),
    });
    assert.deepEqual(await shell.json(), { ok: true, exitCode: 0, stdout: "pwd", stderr: "" });
    const patch = await fetch(`${baseUrl}/v1/patch`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        directory: "carbonfact",
        patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
      }),
    });
    assert.deepEqual(await patch.json(), { ok: true, exitCode: 0, stdout: "applied", stderr: "" });
    assert.deepEqual(appliedPatch, {
      directory: "carbonfact",
      patch: "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n",
    });
    const plan = await fetch(`${baseUrl}/v1/plan`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "add", content: "Implement", status: "inProgress" }),
    });
    assert.equal(plan.status, 200);
    assert.deepEqual(await plan.json(), {
      ok: true,
      plan: { nextId: 2, items: [{ id: 1, content: "Implement", status: "inProgress" }] },
      mirrored: true,
      message: "Durable plan updated and mirrored to Linear.",
    });
    assert.deepEqual(managedPlan, { action: "add", content: "Implement", status: "inProgress" });
    const invalidPlan = await fetch(`${baseUrl}/v1/plan`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "update", id: 1 }),
    });
    assert.equal(invalidPlan.status, 400);
    const artifact = await fetch(`${baseUrl}/v1/artifact`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ path: "/workspace/preview.png", title: "Preview" }),
    });
    assert.equal(artifact.status, 200);
    assert.deepEqual(await artifact.json(), {
      ok: true,
      assetUrl: "https://uploads.linear.app/workspace/preview",
      contentType: "image/png",
      filename: "preview.png",
    });
    assert.deepEqual(sharedArtifact, { path: "/workspace/preview.png", title: "Preview" });
    const image = await fetch(`${baseUrl}/v1/image`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ path: "/workspace/preview.png" }),
    });
    assert.deepEqual(await image.json(), { ok: true, dataBase64: "aW1hZ2U=", mimeType: "image/png" });
    assert.deepEqual(viewedImage, { path: "/workspace/preview.png" });
    const service = await new ServiceClient(baseUrl, "one-time-task-token").manage({ action: "start", service: "postgres" }); // yadm-secret-scan: ignore
    assert.equal(service.status, "starting");
    assert.deepEqual(service.connection, { host: "postgres", port: 5432 });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5xkAAAAASUVORK5CYII=", "base64");
    const assetUrl = await new LinearToolClient(baseUrl, "one-time-task-token").upload("duck.png", "image/png", png); // yadm-secret-scan: ignore
    assert.equal(assetUrl, "https://uploads.linear.app/workspace/duck-png");
    assert.deepEqual(uploaded, {
      token: "one-time-task-token", // yadm-secret-scan: ignore
      filename: "duck.png",
      contentType: "image/png",
      dataBase64: png.toString("base64"),
    });
    const linear = new LinearToolClient(baseUrl, "one-time-task-token"); // yadm-secret-scan: ignore
    assert.deepEqual(await linear.collaborate({ action: "external_url", label: "Review", url: "https://example.com/review" }), {
      ok: true,
      action: "external_url",
    });
    assert.deepEqual(collaboration, { action: "external_url", label: "Review", url: "https://example.com/review" });
    const client = new PiRunnerClient(baseUrl, token);
    const events: unknown[] = [];
    const result = await client.run(
      { agentSession: { id: "session" }, resumeConversationId: "prior-conversation" },
      async (event) => { events.push(event); },
    );
    assert.deepEqual(events, [{
      type: "activity",
      content: { type: "action", action: "Running tests", parameter: "npm test" },
      ephemeral: true,
    }]);
    assert.equal(result.summary, "Done.");
    assert.equal(result.conversationId, "claude-conversation");
    assert.deepEqual(runPayload, { agentSession: { id: "session" }, resumeConversationId: "prior-conversation" });
    const input = { filename: "screen.png", mimeType: "image/png", size: 3, dataBase64: "YWJj" };
    assert.equal(await client.followUp("session", "Continue", [input]), true);
    assert.deepEqual(followUpInputs, [input]);
    assert.equal(await client.abort("session"), true);
  } finally {
    await server.stop(true);
  }
});

test("cancels a streamed Claude agent run when its task caller disconnects", async () => {
  let markStarted!: () => void;
  let markAborted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
  const harness = {
    runClaude(_taskCredential: string, _request: unknown, signal?: AbortSignal) {
      markStarted();
      return new Promise<{ status: "error"; message: string }>((resolve) => {
        const cancel = () => {
          markAborted();
          resolve({ status: "error", message: "Cancelled." });
        };
        if (signal?.aborted) cancel();
        else signal?.addEventListener("abort", cancel, { once: true });
      });
    },
    async run() { return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 }; },
    async followUp() { return false; },
    async abort() { return false; },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createRunnerServer(harness, "runner-test-token"), // yadm-secret-scan: ignore
  });
  try {
    const controller = new AbortController();
    const pending = fetch(`${server.url.origin}/v1/agent`, {
      method: "POST",
      headers: { authorization: "Bearer one-time-task-token", "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Keep working" }),
      signal: controller.signal,
    }).then((response) => response.text());
    await started;
    controller.abort();
    await pending.catch(() => undefined);
    await Promise.race([
      aborted,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("stream abort signal was not propagated")), 1_000)),
    ]);
  } finally {
    await server.stop(true);
  }
});

test("returns a structured failed result when the workbench run throws", async () => {
  const harness = {
    async run() { throw new Error("task container exited with code 137"); },
    async followUp() { return false; },
    async abort() { return false; },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createRunnerServer(harness, "runner-test-token"), // yadm-secret-scan: ignore
  });
  try {
    const client = new PiRunnerClient(server.url.origin, "runner-test-token"); // yadm-secret-scan: ignore
    const result = await client.run({ agentSession: { id: "session" } }, async () => {});
    assert.equal(result.ok, false);
    assert.match(result.summary, /task container exited with code 137/);
  } finally {
    await server.stop(true);
  }
});

test("keeps quiet Pi and broker requests alive beyond the Bun server idle timeout", async () => {
  const harness = {
    async run() {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Still here.", elapsedMs: 1_100 };
    },
    async collaborateLinear() {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      throw new Error("Linear GraphQL request failed: Argument Validation Error");
    },
    async followUp() { return false; },
    async abort() { return false; },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 1,
    fetch: createRunnerServer(harness, "runner-test-token"), // yadm-secret-scan: ignore
  });
  try {
    const client = new PiRunnerClient(server.url.origin, "runner-test-token"); // yadm-secret-scan: ignore
    const linear = new LinearToolClient(server.url.origin, "one-time-task-token"); // yadm-secret-scan: ignore
    const [result, brokerError] = await Promise.all([
      client.run({ agentSession: { id: "quiet-session" } }, async () => {}),
      linear.collaborate({ action: "external_url", label: "Review", url: "https://example.com/review" })
        .then(() => undefined, (error: unknown) => error),
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.summary, "Still here.");
    assert.match(brokerError instanceof Error ? brokerError.message : String(brokerError), /Argument Validation Error/);
  } finally {
    await server.stop(true);
  }
});

test("emits transport heartbeats while a runner turn is otherwise silent", async () => {
  const harness = {
    async run() {
      await Bun.sleep(55);
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Quiet work finished.", elapsedMs: 55 };
    },
    async followUp() { return false; },
    async abort() { return false; },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createRunnerServer(harness, "runner-test-token", { heartbeatMs: 10 }), // yadm-secret-scan: ignore
  });
  try {
    const response = await fetch(new URL("/run", server.url), {
      method: "POST",
      headers: { authorization: "Bearer runner-test-token", "content-type": "application/json" }, // yadm-secret-scan: ignore
      body: JSON.stringify({ payload: { agentSession: { id: "heartbeat-session" } } }),
    });
    const raw = await response.text();
    const blankLines = raw.split("\n").filter((line) => line === "").length;
    assert.ok(blankLines >= 3, `expected at least two heartbeats plus the terminal newline, got ${blankLines}`);
    assert.match(raw, /Quiet work finished/);
  } finally {
    await server.stop(true);
  }
});

test("relays pull request watch/abort/reviews calls to the runner harness", async () => {
  const watchCalls: Array<{ sessionId: string; prUrl: string }> = [];
  const abortCalls: string[] = [];
  const reviewCalls: string[] = [];
  const harness = {
    async run() { return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 }; },
    async followUp() { return false; },
    async abort() { return false; },
    async watchPullRequestChecks(sessionId: string, prUrl: string) {
      watchCalls.push({ sessionId, prUrl });
      return { accepted: true };
    },
    async abortPullRequestWatch(sessionId: string) { abortCalls.push(sessionId); },
    async checkPullRequestReviews(prUrl: string) {
      reviewCalls.push(prUrl);
      return { reviews: [{ id: 1, author: "gaby", state: "APPROVED", submittedAt: "2026-08-26T10:00:00Z", body: "LGTM" }] };
    },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createRunnerServer(harness, "runner-test-token"), // yadm-secret-scan: ignore
  });
  try {
    const client = new PiRunnerClient(server.url.origin, "runner-test-token"); // yadm-secret-scan: ignore
    const watched = await client.watchPullRequestChecks("session-1", "https://github.com/GitSquared/nemo/pull/42");
    assert.deepEqual(watched, { accepted: true });
    assert.deepEqual(watchCalls, [{ sessionId: "session-1", prUrl: "https://github.com/GitSquared/nemo/pull/42" }]);

    await client.abortPullRequestWatch("session-1");
    assert.deepEqual(abortCalls, ["session-1"]);

    const { reviews } = await client.checkPullRequestReviews("https://github.com/GitSquared/nemo/pull/42");
    assert.deepEqual(reviewCalls, ["https://github.com/GitSquared/nemo/pull/42"]);
    assert.deepEqual(reviews, [{ id: 1, author: "gaby", state: "APPROVED", submittedAt: "2026-08-26T10:00:00Z", body: "LGTM" }]);
  } finally {
    await server.stop(true);
  }
});

test("rejects pull request watch/abort/reviews calls without the shared runner token", async () => {
  const harness = {
    async run() { return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 }; },
    async followUp() { return false; },
    async abort() { return false; },
    async watchPullRequestChecks() { return { accepted: true }; },
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createRunnerServer(harness, "runner-test-token"), // yadm-secret-scan: ignore
  });
  try {
    const response = await fetch(new URL("/pull-requests/watch", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1", prUrl: "https://github.com/GitSquared/nemo/pull/42" }),
    });
    assert.equal(response.status, 401);
  } finally {
    await server.stop(true);
  }
});
