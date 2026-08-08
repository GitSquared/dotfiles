import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { CapsuleClient } from "../src/capsule-client.js";
import { PiRunnerClient } from "../src/runner-client.js";
import { createRunnerServer } from "../src/runner-server.js";

test("streams structured events across the controller-runner boundary", async () => {
  const harness = {
    async askClaude(taskCredential: string, request: string) {
      return taskCredential === "one-time-task-token" && request === "Find the context"
        ? { status: "ok" as const, answer: "Corporate context" }
        : { status: "error" as const, message: "Unauthorized." };
    },
    async run(_payload: unknown, send: (event: {
      type: "activity";
      content: { type: "action"; action: string; parameter: string };
      ephemeral: true;
    }) => Promise<void>) {
      await send({ type: "activity", content: { type: "action", action: "Running tests", parameter: "npm test" }, ephemeral: true });
      return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 12 };
    },
    async followUp(_sessionId: string, _prompt: string) { return true; },
    async abort(_sessionId: string) { return true; },
  };
  const token = "runner-test-token"; // yadm-secret-scan: ignore
  const server = createRunnerServer(harness, token);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const unauthorized = await fetch(`http://127.0.0.1:${address.port}/repositories`);
    assert.equal(unauthorized.status, 401);
    const health = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(health.status, 200);
    const claude = await fetch(`http://127.0.0.1:${address.port}/v1/ask`, {
      method: "POST",
      headers: { authorization: "Bearer one-time-task-token", "content-type": "application/json" },
      body: JSON.stringify({ request: "Find the context" }),
    });
    assert.equal(claude.status, 200);
    assert.deepEqual(await claude.json(), { status: "ok", answer: "Corporate context" });
    const rejectedClaude = await new CapsuleClient(`http://127.0.0.1:${address.port}`, "wrong-task-token").ask("Find the context"); // yadm-secret-scan: ignore
    assert.deepEqual(rejectedClaude, { status: "error", message: "Unauthorized." });
    const client = new PiRunnerClient(`http://127.0.0.1:${address.port}`, token);
    const events: unknown[] = [];
    const result = await client.run({ agentSession: { id: "session" } }, async (event) => { events.push(event); });
    assert.deepEqual(events, [{
      type: "activity",
      content: { type: "action", action: "Running tests", parameter: "npm test" },
      ephemeral: true,
    }]);
    assert.equal(result.summary, "Done.");
    assert.equal(await client.followUp("session", "Continue"), true);
    assert.equal(await client.abort("session"), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
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
  const server = createRunnerServer(harness, "runner-test-token"); // yadm-secret-scan: ignore
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${address.port}/v1/ask`, {
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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
