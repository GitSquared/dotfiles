import { encodeRunnerEvent, type PiResult, type RunRequest, type RunnerEvent, type SessionRequest } from "./runner-protocol.js";
import type { CapsuleResult } from "./capsule-client.js";
import type {
  LinearManageRequest,
  LinearManageResult,
  LinearSessionRequest,
  LinearSessionResult,
  LinearUploadRequest,
} from "./linear-actions.js";
import type { ServiceRequest, ServiceResult } from "./service-client.js";
import type { LinearInputFile, RepositoryCandidate } from "./types.js";
import { finalText } from "./redaction.js";

export const RUNNER_MAX_BODY_BYTES = 30 * 1024 * 1024;

const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

async function body<T>(request: Request): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > RUNNER_MAX_BODY_BYTES) throw new Error("request_too_large");
  const raw = await request.arrayBuffer();
  if (raw.byteLength > RUNNER_MAX_BODY_BYTES) throw new Error("request_too_large");
  return JSON.parse(new TextDecoder().decode(raw)) as T;
}

function json(status: number, value: unknown): Response {
  return Response.json(value, { status, headers: responseHeaders });
}

type RunnerHarness = {
  run(payload: RunRequest["payload"], send: (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>): Promise<PiResult>;
  followUp(sessionId: string, prompt: string, inputs?: LinearInputFile[]): Promise<boolean>;
  abort(sessionId: string): Promise<boolean>;
  repositories?(): Promise<RepositoryCandidate[]>;
  health?(): Promise<Record<string, unknown>>;
  askClaude?(token: string, request: string, signal?: AbortSignal): Promise<CapsuleResult>; // yadm-secret-scan: ignore
  manageService?(token: string, request: ServiceRequest, signal?: AbortSignal): Promise<ServiceResult>; // yadm-secret-scan: ignore
  manageLinear?(token: string, request: LinearManageRequest, signal?: AbortSignal): Promise<LinearManageResult>; // yadm-secret-scan: ignore
  collaborateLinear?(token: string, request: LinearSessionRequest, signal?: AbortSignal): Promise<LinearSessionResult>; // yadm-secret-scan: ignore
  uploadLinearFile?(token: string, request: LinearUploadRequest, signal?: AbortSignal): Promise<string>; // yadm-secret-scan: ignore
};

function authorized(request: Request, token: string): boolean { // yadm-secret-scan: ignore
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function bearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : ""; // yadm-secret-scan: ignore
}

export function createRunnerServer(pi: RunnerHarness, token: string): (request: Request) => Promise<Response> { // yadm-secret-scan: ignore
  return async (request) => {
    try {
      return await route(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("runner request failed", { message });
      return json(message === "request_too_large" ? 413 : 500, { ok: false, error: "internal_error" });
    }
  };

  async function route(request: Request): Promise<Response> {
    const method = request.method;
    const pathname = new URL(request.url).pathname;

    if (method === "GET" && pathname === "/healthz") {
      try {
        const details = await pi.health?.() ?? {};
        return json(200, { ok: true, service: "straylight-pi-runner", ...details });
      } catch (error) {
        return json(503, {
          ok: false,
          service: "straylight-pi-runner",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (method === "POST" && pathname === "/v1/ask") {
      const input = await body<{ request?: string }>(request);
      if (!pi.askClaude || typeof input.request !== "string") {
        return json(400, { status: "error", message: "Invalid Claude request." });
      }
      const result = await pi.askClaude(bearer(request), input.request, request.signal);
      return json(result.status === "error" ? 502 : 200, result);
    }

    if (method === "POST" && pathname === "/v1/services") {
      const input = await body<ServiceRequest>(request);
      if (!pi.manageService || !input || typeof input !== "object") {
        return json(400, { ok: false, message: "Invalid development service request." });
      }
      try {
        return json(200, await pi.manageService(bearer(request), input, request.signal));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(message.startsWith("Unauthorized") ? 401 : 502, { ok: false, message });
      }
    }

    if (method === "POST" && pathname === "/v1/linear") {
      const input = await body<LinearManageRequest>(request);
      if (!pi.manageLinear || !input || typeof input !== "object") {
        return json(400, { ok: false, message: "Invalid Linear operation." });
      }
      try {
        return json(200, await pi.manageLinear(bearer(request), input, request.signal));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(message.startsWith("Unauthorized") ? 401 : 502, { ok: false, message });
      }
    }

    if (method === "POST" && pathname === "/v1/linear-session") {
      const input = await body<LinearSessionRequest>(request);
      if (!pi.collaborateLinear || !input || typeof input !== "object") {
        return json(400, { ok: false, message: "Invalid Linear collaboration request." });
      }
      try {
        return json(200, await pi.collaborateLinear(bearer(request), input, request.signal));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(message.startsWith("Unauthorized") ? 401 : 502, { ok: false, message });
      }
    }

    if (method === "POST" && pathname === "/v1/linear-upload") {
      const input = await body<LinearUploadRequest>(request);
      if (!pi.uploadLinearFile || !input || typeof input !== "object") {
        return json(400, { ok: false, message: "Invalid Linear upload request." });
      }
      try {
        return json(200, { ok: true, assetUrl: await pi.uploadLinearFile(bearer(request), input, request.signal) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(message.startsWith("Unauthorized") ? 401 : 502, { ok: false, message });
      }
    }

    if (!authorized(request, token)) return json(401, { ok: false, error: "unauthorized" });

    if (method === "GET" && pathname === "/repositories") {
      return json(200, { ok: true, repositories: await pi.repositories?.() ?? [] });
    }

    if (method === "POST" && pathname === "/run") {
      const input = await body<RunRequest>(request);
      const sessionId = input.payload.agentSession?.id;
      if (!sessionId) return json(400, { ok: false, error: "missing_agent_session_id" });
      return streamRun(pi, sessionId, input.payload);
    }

    if (method === "POST" && pathname === "/follow-up") {
      const input = await body<SessionRequest>(request);
      const accepted = input.sessionId && input.prompt ? await pi.followUp(input.sessionId, input.prompt, input.inputs) : false;
      return json(200, { ok: true, accepted });
    }

    if (method === "POST" && pathname === "/abort") {
      const input = await body<SessionRequest>(request);
      const accepted = input.sessionId ? await pi.abort(input.sessionId) : false;
      return json(200, { ok: true, accepted });
    }

    return json(404, { ok: false, error: "not_found" });
  }
}

function streamRun(pi: RunnerHarness, sessionId: string, payload: RunRequest["payload"]): Response {
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let cancelled = false;
  let completed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pi.run(payload, async (event) => {
        if (!cancelled) controller.enqueue(encoder.encode(encodeRunnerEvent(event)));
      }).then((result) => {
        completed = true;
        if (cancelled) return;
        controller.enqueue(encoder.encode(encodeRunnerEvent({ type: "result", result })));
        controller.close();
      }).catch((error: unknown) => {
        completed = true;
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(encoder.encode(encodeRunnerEvent({
          type: "result",
          result: {
            ok: false,
            timedOut: false,
            awaitingInput: false,
            summary: finalText(`Pi workbench failed: ${message}`),
            elapsedMs: Date.now() - startedAt,
          },
        })));
        controller.close();
      });
    },
    async cancel() {
      cancelled = true;
      if (!completed) await pi.abort(sessionId).catch(() => undefined);
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      ...responseHeaders,
      "content-type": "application/x-ndjson; charset=utf-8",
    },
  });
}
