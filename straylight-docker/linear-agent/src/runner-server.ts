import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { encodeRunnerEvent, type PiResult, type RunRequest, type RunnerEvent, type SessionRequest } from "./runner-protocol.js";
import type { CapsuleResult } from "./capsule-client.js";
import type { RepositoryCandidate } from "./types.js";

const MAX_BODY_BYTES = 1024 * 1024;

async function body<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const output = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(output),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(output);
}

type RunnerHarness = {
  run(payload: RunRequest["payload"], send: (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>): Promise<PiResult>;
  followUp(sessionId: string, prompt: string): Promise<boolean>;
  abort(sessionId: string): Promise<boolean>;
  repositories?(): Promise<RepositoryCandidate[]>;
  health?(): Promise<Record<string, unknown>>;
  askClaude?(token: string, request: string): Promise<CapsuleResult>; // yadm-secret-scan: ignore
};

function authorized(request: IncomingMessage, token: string): boolean { // yadm-secret-scan: ignore
  return request.headers.authorization === `Bearer ${token}`;
}

export function createRunnerServer(pi: RunnerHarness, token: string): http.Server { // yadm-secret-scan: ignore
  return http.createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("runner request failed", { message });
      if (!response.headersSent) json(response, message === "request_too_large" ? 413 : 500, { ok: false, error: "internal_error" });
      else response.end();
    });
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? "GET";
    const pathname = new URL(request.url ?? "/", "http://runner.internal").pathname;
    if (method === "GET" && pathname === "/healthz") {
      try {
        const details = await pi.health?.() ?? {};
        json(response, 200, { ok: true, service: "straylight-pi-runner", ...details });
      } catch (error) {
        json(response, 503, {
          ok: false,
          service: "straylight-pi-runner",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (method === "POST" && pathname === "/v1/ask") {
      const authorization = request.headers.authorization;
      const taskToken = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : ""; // yadm-secret-scan: ignore
      const input = await body<{ request?: string }>(request);
      if (!pi.askClaude || typeof input.request !== "string") {
        json(response, 400, { status: "error", message: "Invalid Claude request." });
        return;
      }
      const result = await pi.askClaude(taskToken, input.request);
      json(response, result.status === "error" ? 502 : 200, result);
      return;
    }
    if (!authorized(request, token)) {
      json(response, 401, { ok: false, error: "unauthorized" });
      return;
    }
    if (method === "GET" && pathname === "/repositories") {
      json(response, 200, { ok: true, repositories: await pi.repositories?.() ?? [] });
      return;
    }
    if (method === "POST" && pathname === "/run") {
      const input = await body<RunRequest>(request);
      const sessionId = input.payload.agentSession?.id;
      if (!sessionId) {
        json(response, 400, { ok: false, error: "missing_agent_session_id" });
        return;
      }
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      let completed = false;
      response.once("close", () => {
        if (!completed) void pi.abort(sessionId).catch(() => undefined);
      });
      const result = await pi.run(input.payload, async (event) => {
        if (!response.write(encodeRunnerEvent(event))) await new Promise<void>((resolve) => response.once("drain", resolve));
      });
      completed = true;
      response.end(encodeRunnerEvent({ type: "result", result }));
      return;
    }
    if (method === "POST" && pathname === "/follow-up") {
      const input = await body<SessionRequest>(request);
      const accepted = input.sessionId && input.prompt ? await pi.followUp(input.sessionId, input.prompt) : false;
      json(response, 200, { ok: true, accepted });
      return;
    }
    if (method === "POST" && pathname === "/abort") {
      const input = await body<SessionRequest>(request);
      const accepted = input.sessionId ? await pi.abort(input.sessionId) : false;
      json(response, 200, { ok: true, accepted });
      return;
    }
    json(response, 404, { ok: false, error: "not_found" });
  }
}
