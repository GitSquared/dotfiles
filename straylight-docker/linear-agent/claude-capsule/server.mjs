import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { promisify } from "node:util";
import { claudeArgs } from "./claude-request.mjs";
import { runAgent } from "./agent-request.mjs";

const execFileAsync = promisify(execFile);
const host = process.env.HOST?.trim() || "0.0.0.0";
const port = Number(process.env.PORT || 8790);
const maxBodyBytes = 512 * 1024;
const maxOutputBytes = 256 * 1024;
const claudeTimeoutMs = 300_000;
const agentHeartbeatMs = 15_000;
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

function ndjson(response, value) {
  if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(value)}\n`);
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

async function claudeIsAuthenticated(signal) {
  try {
    await execFileAsync("claude", ["auth", "status"], { timeout: 15_000, maxBuffer: 128 * 1024, signal });
    return true;
  } catch (error) {
    if (signal.aborted) throw error;
    return false;
  }
}

async function askClaude(request, signal) {
  if (!(await claudeIsAuthenticated(signal))) {
    return {
      status: "error",
      message: "Claude CLI authentication is unavailable. The engineer may need to sign in to Claude in the interactive workbench.",
    };
  }
  try {
    const { stdout } = await execFileAsync("claude", claudeArgs(request), {
      timeout: claudeTimeoutMs,
      maxBuffer: maxOutputBytes,
      signal,
    });
    const output = stdout.trim();
    return output ? { status: "ok", answer: output } : { status: "error", message: "Claude returned no answer." };
  } catch {
    if (signal.aborted) return { status: "error", message: "The Claude workbench request was cancelled." };
    return { status: "error", message: "The Claude workbench request failed." };
  }
}

function cancellation(request, response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", abort);
  if (request.aborted || response.destroyed) controller.abort();
  return {
    signal: controller.signal,
    cleanup() {
      request.off("aborted", abort);
      response.off("close", abort);
    },
  };
}

const server = http.createServer((request, response) => {
  void route(request, response).catch((error) => {
    if (response.destroyed) return;
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
    const requestCancellation = cancellation(request, response);
    try {
      if (!authorized(request)) {
        if (!response.destroyed) json(response, 401, { status: "error", message: "Unauthorized." });
        return;
      }
      const input = await body(request);
      if (typeof input?.request !== "string" || input.request.trim().length === 0 || input.request.length > 20_000) {
        if (!response.destroyed) json(response, 400, { status: "error", message: "A request of 1-20,000 characters is required." });
        return;
      }
      const result = await askClaude(input.request, requestCancellation.signal);
      if (!response.destroyed) json(response, result.status === "error" ? 502 : 200, result);
      return;
    } finally {
      requestCancellation.cleanup();
    }
  }
  if (method === "POST" && pathname === "/v1/agent") {
    const requestCancellation = cancellation(request, response);
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let heartbeat;
    try {
      if (!authorized(request)) {
        if (!response.destroyed) json(response, 401, { status: "error", message: "Unauthorized." });
        return;
      }
      const input = await body(request);
      const validUrl = (value) => {
        try { return ["http:", "https:"].includes(new URL(value).protocol); }
        catch { return false; }
      };
      if (typeof input?.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 200_000
        || typeof input?.taskToken !== "string" || input.taskToken.length < 32
        || !validUrl(input?.taskUrl) || !validUrl(input?.workbenchUrl)
        || (input.resume !== undefined && (typeof input.resume !== "string" || input.resume.length > 200))
        || (input.timeBudgetMs !== undefined && (!Number.isSafeInteger(input.timeBudgetMs) || input.timeBudgetMs <= 0))) {
        if (!response.destroyed) json(response, 400, { status: "error", message: "Invalid Straylight agent request." });
        return;
      }
      console.info("Claude agent request accepted", {
        requestId,
        model: input.model || "sonnet",
        resumed: Boolean(input.resume),
      });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      heartbeat = setInterval(() => {
        if (!response.destroyed && !response.writableEnded) response.write("\n");
      }, agentHeartbeatMs);
      heartbeat.unref();
      const result = await runAgent(input, requestCancellation.signal, async (progress) => {
        ndjson(response, { type: "progress", progress });
      });
      ndjson(response, { type: "result", result });
      if (!response.destroyed) response.end();
      console.info("Claude agent request completed", {
        requestId,
        elapsedMs: Date.now() - startedAt,
        disposition: result.disposition?.status,
      });
      return;
    } catch (error) {
      if (!response.destroyed) {
        const result = {
          status: "error",
          message: requestCancellation.signal.aborted
            ? "The Claude agent run was cancelled."
            : (error instanceof Error ? error.message : "The Claude agent run failed."),
          ...(typeof error?.sessionId === "string" ? { sessionId: error.sessionId } : {}),
          ...(typeof error?.durationMs === "number" ? { durationMs: error.durationMs } : {}),
        };
        if (response.headersSent) {
          ndjson(response, { type: "result", result });
          response.end();
        } else {
          json(response, 502, result);
        }
      }
      console.error("Claude agent request failed", {
        requestId,
        elapsedMs: Date.now() - startedAt,
        cancelled: requestCancellation.signal.aborted,
        errorName: error instanceof Error ? error.name : "NonError",
      });
      return;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      requestCancellation.cleanup();
    }
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
