import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { PiRunnerClient } from "../src/runner-client.js";
import { createRunnerServer } from "../src/runner-server.js";

test("streams structured events across the controller-runner boundary", async () => {
  const harness = {
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
  const server = createRunnerServer(harness);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address() as AddressInfo;
    const client = new PiRunnerClient(`http://127.0.0.1:${address.port}`);
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
