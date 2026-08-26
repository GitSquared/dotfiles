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
  attentionStateName: "In Review",
  graphqlTimeoutMs: 15_000,
};

test("serves controller health through a Web Response", async () => {
  const controller = { async health() { return { controller: { trackedSessions: 0 }, workbench: { mode: "bun" } }; } } as unknown as AgentController;
  const handler = createServer(config, {} as LinearClient, controller);
  const response = await handler(new Request("https://straylight.example.test/healthz"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "straylight-linear-agent",
    controller: { trackedSessions: 0 },
    workbench: { mode: "bun" },
  });
});

test("brokers authenticated runner Linear operations", async () => {
  const controller = {
    async manageLinear(sessionId: string, request: unknown) {
      assert.equal(sessionId, "session-1");
      assert.deepEqual(request, { resource: "issue", operation: "get" });
      return { ok: true, resource: "issue", operation: "get", data: { id: "issue-1" } };
    },
  } as unknown as AgentController;
  const handler = createServer(config, {} as LinearClient, controller);
  const response = await handler(new Request("https://straylight.example.test/internal/linear", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.runnerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sessionId: "session-1", request: { resource: "issue", operation: "get" } }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    resource: "issue",
    operation: "get",
    data: { id: "issue-1" },
  });
});

test("rejects unauthenticated runner Linear operations", async () => {
  const handler = createServer(config, {} as LinearClient, {} as AgentController);
  const response = await handler(new Request("https://straylight.example.test/internal/linear", {
    method: "POST",
    body: JSON.stringify({ sessionId: "session-1", request: { resource: "issue", operation: "get" } }),
  }));
  assert.equal(response.status, 401);
});

test("brokers acknowledged Agent Session collaboration", async () => {
  const request = { action: "external_url", label: "Pull request", url: "https://github.com/GitSquared/nemo/pull/42" } as const;
  const controller = {
    async collaborateLinear(sessionId: string, supplied: unknown) {
      assert.equal(sessionId, "session-1");
      assert.deepEqual(supplied, request);
      return { ok: true, action: "external_url" };
    },
  } as unknown as AgentController;
  const handler = createServer(config, {} as LinearClient, controller);
  const response = await handler(new Request("https://straylight.example.test/internal/linear-session", {
    method: "POST",
    headers: { authorization: `Bearer ${config.runnerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "session-1", request }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, action: "external_url" });
});

test("brokers a bounded Linear upload through the trusted controller", async () => {
  const controller = {
    async uploadLinearFile(sessionId: string, request: unknown) {
      assert.equal(sessionId, "session-1");
      assert.deepEqual(request, { filename: "duck.png", contentType: "image/png", dataBase64: "AQID" });
      return "https://uploads.linear.app/workspace/duck";
    },
  } as unknown as AgentController;
  const handler = createServer(config, {} as LinearClient, controller);
  const response = await handler(new Request("https://straylight.example.test/internal/linear-upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.runnerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "session-1",
      request: { filename: "duck.png", contentType: "image/png", dataBase64: "AQID" },
    }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    assetUrl: "https://uploads.linear.app/workspace/duck",
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

test("serves git commit identity and signing key setup alongside GitHub CLI auth instructions", async () => {
  const controller = {} as unknown as AgentController;
  const handler = createServer(config, {} as LinearClient, controller);
  const response = await handler(new Request("https://straylight.example.test/linear/tools/auth"));
  assert.equal(response.status, 200);
  const bodyText = await response.text();
  assert.match(bodyText, /entrypoint git linear-agent-runner config --global user\.name/);
  assert.match(bodyText, /entrypoint git linear-agent-runner config --global user\.email/);
  assert.match(bodyText, /entrypoint git linear-agent-runner config --global gpg\.format ssh/);
  assert.match(bodyText, /entrypoint git linear-agent-runner config --global user\.signingkey \/tool-profile\/signing\/id_ed25519/);
  assert.match(bodyText, /entrypoint git linear-agent-runner config --global commit\.gpgsign true/);
  assert.match(bodyText, /GH_CONFIG_DIR and GIT_CONFIG_GLOBAL point there, so authentication, commit identity, and signing keys survive/);
});
