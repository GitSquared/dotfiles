import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { test } from "bun:test";
import { DockerEngine } from "../src/docker-engine.js";

// Unix domain socket paths are capped at ~104 bytes on macOS, so this deliberately avoids
// os.tmpdir() (which can already be 60+ chars) in favor of a short, fixed base directory.
function freshSocketPath(): string {
  return path.join("/tmp", `docker-engine-test-${crypto.randomBytes(6).toString("hex")}.sock`);
}

async function withServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  run: (socketPath: string) => Promise<void>,
): Promise<void> {
  const socketPath = freshSocketPath();
  await fs.rm(socketPath, { force: true });
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  try {
    await run(socketPath);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(socketPath, { force: true });
  }
}

test("resolves normally, well within its request timeout", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ Id: "container-abc", State: { Status: "running" } }));
    },
    async (socketPath) => {
      const engine = new DockerEngine(socketPath, 1_000);
      const inspection = await engine.inspect("container-abc");
      assert.equal(inspection.Id, "container-abc");
      assert.equal(inspection.State?.Status, "running");
    },
  );
});

test("aborts a request that never gets a response once its timeout elapses, instead of hanging forever", async () => {
  await withServer(
    () => { /* deliberately never respond - simulates a wedged Docker daemon */ },
    async (socketPath) => {
      const engine = new DockerEngine(socketPath, 30);
      const startedAt = Date.now();
      await assert.rejects(() => engine.inspect("container-abc"), /timed out after 30ms/);
      const elapsedMs = Date.now() - startedAt;
      assert.ok(elapsedMs < 1_000, `expected the abort to fire near the 30ms timeout, took ${elapsedMs}ms`);
    },
  );
});

test("surfaces Docker's own error message on a non-2xx response instead of a generic failure", async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "No such container: container-missing" }));
    },
    async (socketPath) => {
      const engine = new DockerEngine(socketPath, 1_000);
      await assert.rejects(() => engine.inspect("container-missing"), /No such container: container-missing/);
    },
  );
});

test("rejects immediately with the real connection error when nothing is listening on the socket", async () => {
  const socketPath = freshSocketPath();
  const engine = new DockerEngine(socketPath, 5_000);
  const startedAt = Date.now();
  await assert.rejects(() => engine.inspect("container-abc"), (error: unknown) => {
    const code = (error as NodeJS.ErrnoException)?.code ?? "";
    const message = error instanceof Error ? error.message : String(error);
    // Node reports ENOENT/ECONNREFUSED for a missing Unix socket; Bun's node:http compat
    // reports its own FailedToOpenSocket code instead. Either way it must not be our
    // "timed out" message - a real connection failure should surface as itself.
    assert.doesNotMatch(message, /timed out/);
    assert.match(`${code} ${message}`, /ENOENT|ECONNREFUSED|FailedToOpenSocket/);
    return true;
  });
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 1_000, `a real connection error should surface immediately, not wait for the timeout (took ${elapsedMs}ms)`);
});
