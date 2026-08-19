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
  const harness = {
    async askClaude(taskCredential: string, request: string) {
      return taskCredential === "one-time-task-token" && request === "Find the context"
        ? { status: "ok" as const, answer: "Corporate context" }
        : { status: "error" as const, message: "Unauthorized." };
    },
    async runClaude(taskCredential: string, request: { prompt: string; resume?: string }) {
      return taskCredential === "one-time-task-token" && request.prompt === "Implement it"
        ? { status: "ok" as const, answer: "Implemented.", sessionId: request.resume ?? "claude-session", awaitingInput: false, durationMs: 9, disposition: { status: "completed" as const, reason: "Implemented and checked." } }
        : { status: "error" as const, message: "Unauthorized." };
    },
    async shell(request: { command: string }) {
      return { ok: true, exitCode: 0, stdout: request.command, stderr: "" };
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
    async run(_payload: unknown, send: (event: {
      type: "activity";
      content: { type: "action"; action: string; parameter: string };
      ephemeral: true;
    }) => Promise<void>) {
      await send({ type: "activity", content: { type: "action", action: "Running tests", parameter: "npm test" }, ephemeral: true });
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 12 };
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
    const claude = await fetch(`${baseUrl}/v1/ask`, {
      method: "POST",
      headers: { authorization: "Bearer one-time-task-token", "content-type": "application/json" },
      body: JSON.stringify({ request: "Find the context" }),
    });
    assert.equal(claude.status, 200);
    assert.deepEqual(await claude.json(), { status: "ok", answer: "Corporate context" });
    const rejectedClaude = await new CapsuleClient(baseUrl, "wrong-task-token").ask("Find the context"); // yadm-secret-scan: ignore
    assert.deepEqual(rejectedClaude, { status: "error", message: "Unauthorized." });
    const agent = await new CapsuleClient(baseUrl, "one-time-task-token").runBrokeredAgent({ prompt: "Implement it" }); // yadm-secret-scan: ignore
    assert.deepEqual(agent, { status: "ok", answer: "Implemented.", sessionId: "claude-session", awaitingInput: false, durationMs: 9, disposition: { status: "completed", reason: "Implemented and checked." } });
    const shell = await fetch(`${baseUrl}/v1/shell`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ command: "pwd" }),
    });
    assert.deepEqual(await shell.json(), { ok: true, exitCode: 0, stdout: "pwd", stderr: "" });
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
    const result = await client.run({ agentSession: { id: "session" } }, async (event) => { events.push(event); });
    assert.deepEqual(events, [{
      type: "activity",
      content: { type: "action", action: "Running tests", parameter: "npm test" },
      ephemeral: true,
    }]);
    assert.equal(result.summary, "Done.");
    const input = { filename: "screen.png", mimeType: "image/png", size: 3, dataBase64: "YWJj" };
    assert.equal(await client.followUp("session", "Continue", [input]), true);
    assert.deepEqual(followUpInputs, [input]);
    assert.equal(await client.abort("session"), true);
  } finally {
    await server.stop(true);
  }
});

test("propagates a disconnected Claude request to the workbench abort signal", async () => {
  let markStarted!: () => void;
  let markAborted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const aborted = new Promise<void>((resolve) => { markAborted = resolve; });
  const harness = {
    askClaude(_taskCredential: string, _request: string, signal?: AbortSignal) {
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
  const baseUrl = server.url.origin;

  try {
    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/v1/ask`, {
      method: "POST",
      headers: { authorization: "Bearer one-time-task-token", "content-type": "application/json" },
      body: JSON.stringify({ request: "Keep working" }),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await pending.catch(() => undefined);
    await Promise.race([
      aborted,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("abort signal was not propagated")), 1_000)),
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
