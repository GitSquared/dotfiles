import assert from "node:assert/strict";
import { test } from "bun:test";
import { loadControllerConfig, loadRunnerConfig } from "../src/config.js";

function environment(): NodeJS.ProcessEnv {
  return {
    LINEAR_CLIENT_ID: "client",
    LINEAR_CLIENT_SECRET: "client-secret", // yadm-secret-scan: ignore
    LINEAR_WEBHOOK_SECRET: "webhook-secret", // yadm-secret-scan: ignore
    LINEAR_AGENT_INSTALL_SECRET: "x".repeat(32), // yadm-secret-scan: ignore
    PI_RUNNER_TOKEN: "r".repeat(32), // yadm-secret-scan: ignore
    LINEAR_REDIRECT_URI: "https://straylight.example.ts.net/linear/oauth/callback",
    LINEAR_AGENT_PUBLIC_URL: "https://straylight.example.ts.net/",
  };
}

test("loads safe defaults", () => {
  const config = loadControllerConfig(environment());
  assert.equal(config.baseUrl, "https://straylight.example.ts.net");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8787);
  assert.equal(config.runnerUrl, "http://linear-agent-runner:8788");
});

test("rejects a short install secret", () => {
  const env = environment();
  env.LINEAR_AGENT_INSTALL_SECRET = "too-short"; // yadm-secret-scan: ignore
  assert.throws(() => loadControllerConfig(env), /at least 32/);
});

test("rejects non-HTTPS public URLs", () => {
  const env = environment();
  env.LINEAR_AGENT_PUBLIC_URL = "http://localhost:8787";
  assert.throws(() => loadControllerConfig(env), /must use https/);
});

test("rejects invalid numeric configuration", () => {
  assert.throws(() => loadRunnerConfig({ PI_TIMEOUT_MS: "none" }), /positive integer/);
});

test("loads isolated runner defaults without Linear configuration", () => {
  const config = loadRunnerConfig({
    PI_RUNNER_TOKEN: "r".repeat(32), // yadm-secret-scan: ignore
    CAPSULE_AUTH_URL: "https://straylight.example.ts.net/linear/capsule/auth",
    TOOL_AUTH_URL: "https://straylight.example.ts.net/linear/tools/auth",
  });
  assert.equal(config.port, 8788);
  assert.equal(config.runnerBackend, "claude");
  assert.equal(config.piWorkdir, "/workspace");
  assert.equal(config.memoryDirectory, "/memory");
  assert.equal(config.piTimeoutMs, 1_800_000);
  assert.equal(config.capsuleUrl, "http://linear-agent-claude-capsule:8790");
  assert.equal(config.workbenchUrl, "http://linear-agent-runner:8788");
});

test("keeps Pi as an explicit fallback backend", () => {
  const config = loadRunnerConfig({
    PI_RUNNER_TOKEN: "r".repeat(32), // yadm-secret-scan: ignore
    CAPSULE_AUTH_URL: "https://straylight.example.ts.net/linear/capsule/auth",
    TOOL_AUTH_URL: "https://straylight.example.ts.net/linear/tools/auth",
    STRAYLIGHT_RUNNER: "pi",
  });
  assert.equal(config.runnerBackend, "pi");
});
