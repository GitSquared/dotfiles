import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import type { ControllerConfig } from "../src/config.js";
import { documentCreateInput, graphqlErrorMessage, LinearClient, type TokenFile } from "../src/linear.js";
import { JsonStore } from "../src/storage.js";

test("creates an issue-backed Linear document without an invalid optional icon", () => {
  assert.deepEqual(documentCreateInput("issue-id", "document-id", "Review", "# Hello"), {
    id: "document-id",
    issueId: "issue-id",
    title: "Review",
    content: "# Hello",
  });
});

test("surfaces safe Linear argument validation details", () => {
  assert.equal(graphqlErrorMessage({
    message: "Argument Validation Error",
    extensions: {
      code: "INVALID_INPUT",
      validationErrors: [{ constraints: { isValid: "icon must be a supported icon name" } }],
    },
  }, 200), "Argument Validation Error: icon must be a supported icon name");
});

function testControllerConfig(stateDirectory: string): ControllerConfig {
  return {
    linearClientId: "client",
    linearClientSecret: "s".repeat(32), // yadm-secret-scan: ignore
    linearWebhookSecret: "w".repeat(32), // yadm-secret-scan: ignore
    installSecret: "i".repeat(32), // yadm-secret-scan: ignore
    linearRedirectUri: "https://straylight.example.test/linear/oauth/callback",
    baseUrl: "https://straylight.example.test/",
    host: "127.0.0.1",
    port: 8787,
    stateDirectory,
    runnerUrl: "http://runner.test:8788",
    runnerToken: "r".repeat(32), // yadm-secret-scan: ignore
    attentionStateName: "In Review",
    graphqlTimeoutMs: 15_000,
  };
}

// Seeds a non-expiring access token directly into LinearClient's own token store file, so a
// real call can reach graphqlWithToken's fetch without an actual OAuth exchange.
async function seedAccessToken(stateDirectory: string): Promise<void> {
  const tokens = new JsonStore<TokenFile>(path.join(stateDirectory, "linear-tokens.json"), { installations: {} });
  await tokens.update((store) => {
    store.defaultAppUserId = "app-user-1";
    store.installations["app-user-1"] = {
      accessToken: "test-access-token", // yadm-secret-scan: ignore
      expiresAt: Date.now() + 3_600_000,
      updatedAt: Date.now(),
    };
  });
}

async function withRealServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  run: (localGraphqlUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  // A POST body still mid-write when the client aborts never delivers a graceful FIN to the
  // server's side of the socket - confirmed empirically: a "never respond" handler plus a real
  // request body left server.close()'s callback waiting forever, even though the exact same
  // setup without a body (or without ever aborting) closes immediately. server.close() only
  // stops accepting *new* connections and waits for existing ones to end on their own; Bun's
  // own closeAllConnections() didn't unstick it either. Tracking and force-destroying the
  // accepted socket is what actually makes teardown deterministic here.
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a network server address");
  try {
    await run(`http://127.0.0.1:${address.port}/graphql`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("resolves a real GraphQL response well within its configured timeout", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-client-test-"));
  try {
    await seedAccessToken(directory);
    await withRealServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: { issue: { state: { id: "state-1", name: "In Progress", type: "started" } } } }));
      },
      async (localGraphqlUrl) => {
        // fetchImpl discards the real (hardcoded) Linear GraphQL URL and points the request at
        // the local test server, while leaving every other fetch option - method, headers,
        // body, and crucially the real AbortSignal.timeout - untouched, so what's under test is
        // genuinely graphqlWithToken's own fetch+timeout wiring, not a stand-in for it.
        const client = new LinearClient(testControllerConfig(directory), 1_000, (_input, init) => fetch(localGraphqlUrl, init));
        const state = await client.issueState("issue-1");
        assert.deepEqual(state, { id: "state-1", name: "In Progress", type: "started" });
      },
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("aborts a GraphQL call that never gets a response once its timeout elapses, instead of hanging forever", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-client-test-"));
  try {
    await seedAccessToken(directory);
    await withRealServer(
      () => { /* deliberately never respond - simulates a wedged Linear API */ },
      async (localGraphqlUrl) => {
        const client = new LinearClient(testControllerConfig(directory), 30, (_input, init) => fetch(localGraphqlUrl, init));
        const startedAt = Date.now();
        await assert.rejects(() => client.issueState("issue-1"), /timed out/i);
        const elapsedMs = Date.now() - startedAt;
        assert.ok(elapsedMs < 1_000, `expected the abort to fire near the 30ms timeout, took ${elapsedMs}ms`);
      },
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("rejects assigneeId/delegateId on subissue creation, but still creates one without them (GAB-25)", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-client-test-"));
    try {
      await seedAccessToken(directory);
      await withRealServer(
        (request, response) => {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            response.writeHead(200, { "content-type": "application/json" });
            if (body.includes("ManagedSubissueParent")) {
              response.end(JSON.stringify({ data: { issue: { id: "parent-1", team: { id: "team-1" } } } }));
            } else {
              response.end(JSON.stringify({
                data: { issueCreate: { success: true, issue: { id: "sub-1", identifier: "GAB-99", title: "Follow-up" } } },
              }));
            }
          });
        },
        async (localGraphqlUrl) => {
          const client = new LinearClient(testControllerConfig(directory), 1_000, (_input, init) => fetch(localGraphqlUrl, init));
          await assert.rejects(
            () => client.manage(
              { resource: "subissue", operation: "create", parentId: "parent-1", fields: { title: "Follow-up", assigneeId: "human-1" } },
              { agentSessionId: "session-1", issueId: "parent-1" },
            ),
            /subissue create does not allow field: assigneeId/,
          );
          await assert.rejects(
            () => client.manage(
              { resource: "subissue", operation: "create", parentId: "parent-1", fields: { title: "Follow-up", delegateId: "agent-1" } },
              { agentSessionId: "session-1", issueId: "parent-1" },
            ),
            /subissue create does not allow field: delegateId/,
          );
          const result = await client.manage(
            { resource: "subissue", operation: "create", parentId: "parent-1", fields: { title: "Follow-up" } },
            { agentSessionId: "session-1", issueId: "parent-1" },
          );
          assert.deepEqual(result.data, { id: "sub-1", identifier: "GAB-99", title: "Follow-up" });
        },
      );
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
});
