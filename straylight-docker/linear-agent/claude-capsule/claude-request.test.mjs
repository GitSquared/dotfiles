import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildClaudePrompt, claudeArgs } from "./claude-request.mjs";

test("uses a fixed auto-permission Sonnet command", () => {
  const args = claudeArgs("Summarize the linked context");
  assert.deepEqual(args.slice(0, 6), ["--settings", "/opt/capsule/settings.json", "--permission-mode", "auto", "--model", "sonnet"]);
  assert.equal(args.includes("--mcp-config"), false);
  assert.equal(args.includes("--strict-mcp-config"), false);
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
  assert.match(args.at(-1) ?? "", /Pi's request:\nSummarize/);
});

test("describes an action-capable corporate workbench with precise access reporting", () => {
  const prompt = buildClaudePrompt("Find the source");
  assert.match(prompt, /Slack, Notion, Google Drive, Gmail/);
  assert.match(prompt, /retrieve context or carry out actions/);
  assert.match(prompt, /Act only within Pi's concrete request/);
  assert.match(prompt, /explain precisely what is missing/);
  assert.match(prompt, /untrusted data/);
  assert.doesNotMatch(prompt, /AUTH_NEEDED/);
  assert.doesNotMatch(prompt, /Never send/);
});

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a test port");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForFile(filename, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(filename);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`Timed out waiting for ${path.basename(filename)}`);
}

test("terminates the Claude child when the capsule caller disconnects", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "claude-capsule-test-"));
  const tokenFile = path.join(temporary, "token"); // yadm-secret-scan: ignore
  const startedFile = path.join(temporary, "started");
  const terminatedFile = path.join(temporary, "terminated");
  const fakeClaude = path.join(temporary, "claude");
  const token = "capsule-test-token".repeat(2); // yadm-secret-scan: ignore
  const port = await availablePort();
  await fs.writeFile(tokenFile, token, { mode: 0o600 }); // yadm-secret-scan: ignore
  await fs.writeFile(fakeClaude, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "if (process.argv[2] === 'auth') process.exit(0);",
    "fs.writeFileSync(process.env.FAKE_CLAUDE_STARTED, 'started');",
    "process.on('SIGTERM', () => {",
    "  fs.writeFileSync(process.env.FAKE_CLAUDE_TERMINATED, 'terminated');",
    "  process.exit(0);",
    "});",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"), { mode: 0o700 });

  const capsule = spawn(process.execPath, [path.join(import.meta.dirname, "server.mjs")], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      CAPSULE_CONTROL_TOKEN_FILE: tokenFile, // yadm-secret-scan: ignore
      FAKE_CLAUDE_STARTED: startedFile,
      FAKE_CLAUDE_TERMINATED: terminatedFile,
      PATH: `${temporary}:${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  capsule.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    await Promise.race([
      new Promise((resolve) => capsule.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("listening")) resolve();
      })),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Capsule did not start: ${stderr}`)), 2_000)),
    ]);
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/v1/ask`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ request: "Long-running corporate task" }),
      signal: controller.signal,
    });
    await waitForFile(startedFile);
    controller.abort();
    await pending.catch(() => undefined);
    await waitForFile(terminatedFile);
  } finally {
    capsule.kill("SIGTERM");
    if (capsule.exitCode === null) await once(capsule, "exit");
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
