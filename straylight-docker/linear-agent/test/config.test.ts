import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

function environment(): NodeJS.ProcessEnv {
  return {
    LINEAR_CLIENT_ID: "client",
    LINEAR_CLIENT_SECRET: "client-secret", // yadm-secret-scan: ignore
    LINEAR_WEBHOOK_SECRET: "webhook-secret", // yadm-secret-scan: ignore
    LINEAR_AGENT_INSTALL_SECRET: "x".repeat(32), // yadm-secret-scan: ignore
    LINEAR_REDIRECT_URI: "https://straylight.example.ts.net/linear/oauth/callback",
    LINEAR_AGENT_PUBLIC_URL: "https://straylight.example.ts.net/",
  };
}

test("loads safe defaults", () => {
  const config = loadConfig(environment());
  assert.equal(config.baseUrl, "https://straylight.example.ts.net");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8787);
  assert.equal(config.piWorkdir, "/workspace");
});

test("rejects a short install secret", () => {
  const env = environment();
  env.LINEAR_AGENT_INSTALL_SECRET = "too-short"; // yadm-secret-scan: ignore
  assert.throws(() => loadConfig(env), /at least 32/);
});

test("rejects non-HTTPS public URLs", () => {
  const env = environment();
  env.LINEAR_AGENT_PUBLIC_URL = "http://localhost:8787";
  assert.throws(() => loadConfig(env), /must use https/);
});

test("rejects invalid numeric configuration", () => {
  const env = environment();
  env.PI_TIMEOUT_MS = "none";
  assert.throws(() => loadConfig(env), /positive integer/);
});
