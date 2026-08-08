import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
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
