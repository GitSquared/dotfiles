import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "bun:test";
import type { ControllerConfig } from "../src/config.js";
import type { AgentController } from "../src/controller.js";
import type { LinearClient } from "../src/linear.js";
import { createServer } from "../src/server.js";

const config: ControllerConfig = {
  linearClientId: "client",
  linearClientSecret: "s".repeat(32), // yadm-secret-scan: ignore
  linearWebhookSecret: "w".repeat(32), // yadm-secret-scan: ignore
  installSecret: "i".repeat(32), // yadm-secret-scan: ignore
  linearRedirectUri: "https://straylight.example.test/linear/oauth/callback",
  baseUrl: "https://straylight.example.test/",
  host: "127.0.0.1",
  port: 8787,
  stateDirectory: "/tmp/linear-agent-test",
  runnerUrl: "http://runner.test:8788",
  runnerToken: "r".repeat(32), // yadm-secret-scan: ignore
};

test("serves controller health through a Web Response", async () => {
  const controller = { async health() { return { mode: "bun" }; } } as unknown as AgentController;
  const handler = createServer(config, {} as LinearClient, controller);
  const response = await handler(new Request("https://straylight.example.test/healthz"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "straylight-linear-agent",
    workbench: { mode: "bun" },
  });
});

test("acknowledges a raw signed webhook before delayed dispatch", async () => {
  let handled = false;
  const controller = {
    async handle() { handled = true; },
  } as unknown as AgentController;
  const payload = JSON.stringify({
    type: "AgentSessionEvent",
    action: "created",
    webhookTimestamp: Date.now(),
    agentSession: { id: "session" },
  });
  const signature = crypto.createHmac("sha256", config.linearWebhookSecret).update(payload).digest("hex");
  const handler = createServer(config, {} as LinearClient, controller);
  const response = await handler(new Request("https://straylight.example.test/linear/webhook", {
    method: "POST",
    headers: { "linear-signature": signature },
    body: payload,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, accepted: true, duplicate: false });
  await Bun.sleep(1);
  assert.equal(handled, true);
});
