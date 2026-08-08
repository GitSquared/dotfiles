import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { promisify } from "node:util";
import { claudeArgs, needsAuth } from "./claude-request.mjs";

const execFileAsync = promisify(execFile);
const host = process.env.HOST?.trim() || "0.0.0.0";
const port = Number(process.env.PORT || 8790);
const maxBodyBytes = 24 * 1024;
const maxOutputBytes = 256 * 1024;
const claudeTimeoutMs = 300_000;
const controlToken = fs.readFileSync(process.env.CAPSULE_CONTROL_TOKEN_FILE || "/run/secrets/capsule-control-token", "utf8").trim(); // yadm-secret-scan: ignore
if (controlToken.length < 32) throw new Error("capsule control token is invalid");

function json(response, status, value) {
  const output = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(output),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(output);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorized(request) {
  const supplied = request.headers.authorization;
  if (typeof supplied !== "string" || !supplied.startsWith("Bearer ")) return false;
  const actual = Buffer.from(supplied.slice(7));
  const expected = Buffer.from(controlToken);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

async function claudeIsAuthenticated() {
  try {
    await execFileAsync("claude", ["auth", "status"], { timeout: 15_000, maxBuffer: 128 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function askClaude(request) {
  if (!(await claudeIsAuthenticated())) return { status: "needs_auth" };
  try {
    const { stdout } = await execFileAsync("claude", claudeArgs(request), { timeout: claudeTimeoutMs, maxBuffer: maxOutputBytes });
    const output = stdout.trim();
    if (needsAuth(output)) return { status: "needs_auth" };
    return output ? { status: "ok", answer: output } : { status: "error", message: "Claude returned no answer." };
  } catch (error) {
    const diagnostic = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    if (needsAuth(diagnostic)) return { status: "needs_auth" };
    return { status: "error", message: "The Claude workbench request failed." };
  }
}

const server = http.createServer((request, response) => {
  void route(request, response).catch((error) => {
    const status = error instanceof Error && error.message === "request_too_large" ? 413 : 500;
    json(response, status, { status: "error", message: status === 413 ? "Request too large." : "Capsule request failed." });
  });
});

async function route(request, response) {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", "http://capsule.internal").pathname;
  if (method === "GET" && pathname === "/healthz") {
    json(response, 200, { ok: true, service: "linear-agent-claude-capsule", mode: "personal-claude-workbench" });
    return;
  }
  if (method === "POST" && pathname === "/v1/ask") {
    if (!authorized(request)) {
      json(response, 401, { status: "error", message: "Unauthorized." });
      return;
    }
    const input = await body(request);
    if (typeof input?.request !== "string" || input.request.trim().length === 0 || input.request.length > 20_000) {
      json(response, 400, { status: "error", message: "A request of 1-20,000 characters is required." });
      return;
    }
    const result = await askClaude(input.request);
    json(response, result.status === "error" ? 502 : 200, result);
    return;
  }
  json(response, 404, { status: "error", message: "Not found." });
}

server.listen(port, host, () => {
  console.log("Straylight Claude workbench listening", { host, port, mode: "personal-claude-workbench" });
});

function stop() {
  server.close((error) => {
    if (error) process.exitCode = 1;
  });
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
