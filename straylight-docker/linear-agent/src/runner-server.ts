import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { encodeRunnerEvent, type PiResult, type RunRequest, type RunnerEvent, type SessionRequest } from "./runner-protocol.js";

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
};

export function createRunnerServer(pi: RunnerHarness): http.Server {
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
      json(response, 200, { ok: true, service: "straylight-pi-runner" });
      return;
    }
    if (method === "POST" && pathname === "/run") {
      const input = await body<RunRequest>(request);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/x-ndjson; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      const result = await pi.run(input.payload, async (event) => {
        if (!response.write(encodeRunnerEvent(event))) await new Promise<void>((resolve) => response.once("drain", resolve));
      });
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
