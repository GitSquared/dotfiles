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
export const RUNNER_HEARTBEAT_MS = 15_000;

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
  runClaude?(token: string, request: { prompt: string; resume?: string; model?: string }, signal?: AbortSignal): Promise<import("./capsule-client.js").CapsuleAgentResult>; // yadm-secret-scan: ignore
  shell?(request: { command: string; timeoutMs?: number }, signal?: AbortSignal): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }>;
  shareArtifact?(request: { path: string; title?: string; body?: string }, signal?: AbortSignal): Promise<{ ok: true; assetUrl: string; contentType: string; filename: string }>;
  viewImage?(request: { path: string }): Promise<{ ok: true; dataBase64: string; mimeType: string }>;
  manageService?(token: string, request: ServiceRequest, signal?: AbortSignal): Promise<ServiceResult>; // yadm-secret-scan: ignore
  manageLinear?(token: string, request: LinearManageRequest, signal?: AbortSignal): Promise<LinearManageResult>; // yadm-secret-scan: ignore
  collaborateLinear?(token: string, request: LinearSessionRequest, signal?: AbortSignal): Promise<LinearSessionResult>; // yadm-secret-scan: ignore
  uploadLinearFile?(token: string, request: LinearUploadRequest, signal?: AbortSignal): Promise<string>; // yadm-secret-scan: ignore
};

type RunnerServer = Pick<Bun.Server<undefined>, "timeout">;

function authorized(request: Request, token: string): boolean { // yadm-secret-scan: ignore
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function bearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : ""; // yadm-secret-scan: ignore
}

export function createRunnerServer(
  pi: RunnerHarness,
  token: string,
  options: { heartbeatMs?: number } = {},
): (request: Request, server?: RunnerServer) => Promise<Response> { // yadm-secret-scan: ignore
  return async (request, server) => {
    try {
      return await route(request, server);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("runner request failed", { message });
      return json(message === "request_too_large" ? 413 : 500, { ok: false, error: "internal_error" });
    }
  };

  async function route(request: Request, server?: RunnerServer): Promise<Response> {
    const method = request.method;
    const pathname = new URL(request.url).pathname;

    if (method === "GET" && pathname === "/healthz") {
      try {
        const details = await pi.health?.() ?? {};
        return json(200, { ok: true, service: "straylight-agent-runner", ...details });
      } catch (error) {
        return json(503, {
          ok: false,
          service: "straylight-agent-runner",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (method === "POST" && pathname === "/v1/ask") {
      const input = await body<{ request?: string }>(request);
      if (!pi.askClaude || typeof input.request !== "string") {
        return json(400, { status: "error", message: "Invalid Claude request." });
      }
      server?.timeout(request, 0);
      const result = await pi.askClaude(bearer(request), input.request, request.signal);
      return json(result.status === "error" ? 502 : 200, result);
    }

    if (method === "POST" && pathname === "/v1/agent") {
      const input = await body<{ prompt?: string; resume?: string; model?: string }>(request);
      if (!pi.runClaude || typeof input.prompt !== "string" || !input.prompt.trim()) {
        return json(400, { status: "error", message: "Invalid Claude agent request." });
      }
      server?.timeout(request, 0);
      const result = await pi.runClaude(bearer(request), {
        prompt: input.prompt,
        ...(input.resume ? { resume: input.resume } : {}),
        ...(input.model ? { model: input.model } : {}),
      }, request.signal);
      return json(result.status === "error" ? 502 : 200, result);
    }

    if (method === "POST" && pathname === "/v1/services") {
      const input = await body<ServiceRequest>(request);
      if (!pi.manageService || !input || typeof input !== "object") {
        return json(400, { ok: false, message: "Invalid development service request." });
      }
      server?.timeout(request, 0);
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
      server?.timeout(request, 0);
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
      server?.timeout(request, 0);
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
      server?.timeout(request, 0);
      try {
        return json(200, { ok: true, assetUrl: await pi.uploadLinearFile(bearer(request), input, request.signal) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(message.startsWith("Unauthorized") ? 401 : 502, { ok: false, message });
      }
    }

    if (!authorized(request, token)) return json(401, { ok: false, error: "unauthorized" });

    if (method === "POST" && pathname === "/v1/shell") {
      const input = await body<{ command?: string; timeoutMs?: number }>(request);
      if (!pi.shell || typeof input.command !== "string" || !input.command.trim() || input.command.length > 20_000) {
        return json(400, { ok: false, error: "invalid_shell_request" });
      }
      server?.timeout(request, 0);
      return json(200, await pi.shell({
        command: input.command,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      }, request.signal));
    }

    if (method === "POST" && pathname === "/v1/artifact") {
      const input = await body<{ path?: string; title?: string; body?: string }>(request);
      if (!pi.shareArtifact || typeof input.path !== "string" || !input.path.trim() || input.path.length > 4_096
        || (input.title !== undefined && (typeof input.title !== "string" || input.title.length > 200))
        || (input.body !== undefined && (typeof input.body !== "string" || input.body.length > 20_000))) {
        return json(400, { ok: false, error: "invalid_artifact_request" });
      }
      server?.timeout(request, 0);
      return json(200, await pi.shareArtifact({
        path: input.path,
        ...(input.title ? { title: input.title } : {}),
        ...(input.body ? { body: input.body } : {}),
      }, request.signal));
    }

    if (method === "POST" && pathname === "/v1/image") {
      const input = await body<{ path?: string }>(request);
      if (!pi.viewImage || typeof input.path !== "string" || !input.path.trim() || input.path.length > 4_096) {
        return json(400, { ok: false, error: "invalid_image_request" });
      }
      return json(200, await pi.viewImage({ path: input.path }));
    }

    if (method === "GET" && pathname === "/repositories") {
      return json(200, { ok: true, repositories: await pi.repositories?.() ?? [] });
    }

    if (method === "POST" && pathname === "/run") {
      const input = await body<RunRequest>(request);
      const sessionId = input.payload.agentSession?.id;
      if (!sessionId) return json(400, { ok: false, error: "missing_agent_session_id" });
      // Agent turns can legitimately be quiet while the model reasons or a tool runs.
      // Bun otherwise resets this streaming response after 10 idle seconds.
      server?.timeout(request, 0);
      return streamRun(pi, sessionId, input.payload, options.heartbeatMs ?? RUNNER_HEARTBEAT_MS);
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

function streamRun(pi: RunnerHarness, sessionId: string, payload: RunRequest["payload"], heartbeatMs: number): Response {
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let cancelled = false;
  let completed = false;
  let heartbeat: NodeJS.Timeout | undefined;
  const stopHeartbeat = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      heartbeat = setInterval(() => {
        if (!cancelled && !completed) controller.enqueue(encoder.encode("\n"));
      }, Math.max(1, heartbeatMs));
      heartbeat.unref();
      void pi.run(payload, async (event) => {
        if (!cancelled) controller.enqueue(encoder.encode(encodeRunnerEvent(event)));
      }).then((result) => {
        completed = true;
        stopHeartbeat();
        if (cancelled) return;
        controller.enqueue(encoder.encode(encodeRunnerEvent({ type: "result", result })));
        controller.close();
      }).catch((error: unknown) => {
        completed = true;
        stopHeartbeat();
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(encoder.encode(encodeRunnerEvent({
          type: "result",
          result: {
            ok: false,
            timedOut: false,
            awaitingInput: false,
            summary: finalText(`Agent workbench failed: ${message}`),
            elapsedMs: Date.now() - startedAt,
          },
        })));
        controller.close();
      });
    },
    async cancel() {
      cancelled = true;
      stopHeartbeat();
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
