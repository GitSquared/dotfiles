import { encodeRunnerEvent, type PiResult, type RunRequest, type RunnerEvent, type SessionRequest } from "./runner-protocol.js";
import type { PullRequestReview } from "./runner-client.js";
import {
  encodeCapsuleAgentStreamEvent,
  type CapsuleAgentProgressHandler,
  type CapsuleAgentResult,
} from "./capsule-client.js";
import type {
  LinearManageRequest,
  LinearManageResult,
  LinearSessionRequest,
  LinearSessionResult,
  LinearUploadRequest,
} from "./linear-actions.js";
import type { ServiceRequest, ServiceResult } from "./service-client.js";
import type { LinearInputFile, RepositoryCandidate } from "./types.js";
import type { PlanDetails, PlanRequest } from "./plan.js";
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
  runClaude?(token: string, request: { prompt: string; resume?: string; model?: string; timeBudgetMs?: number }, signal?: AbortSignal, onProgress?: CapsuleAgentProgressHandler): Promise<CapsuleAgentResult>; // yadm-secret-scan: ignore
  pushAgentInput?(token: string, request: { content: string; shouldQuery?: boolean }): Promise<{ accepted: boolean; reason?: string }>; // yadm-secret-scan: ignore
  watchPullRequestChecks?(sessionId: string, prUrl: string): Promise<{ accepted: boolean }>;
  abortPullRequestWatch?(sessionId: string): Promise<void>;
  checkPullRequestReviews?(prUrl: string): Promise<{ reviews: PullRequestReview[] }>;
  shell?(request: { command: string; timeoutMs?: number }, signal?: AbortSignal): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }>;
  applyPatch?(request: { patch: string; directory?: string }, signal?: AbortSignal): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }>;
  managePlan?(request: PlanRequest, signal?: AbortSignal): Promise<{ ok: true; plan: PlanDetails; mirrored?: boolean; message: string }>;
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

    if (method === "POST" && pathname === "/v1/agent") {
      const input = await body<{ prompt?: string; resume?: string; model?: string; timeBudgetMs?: number }>(request);
      if (!pi.runClaude || typeof input.prompt !== "string" || !input.prompt.trim()
        || (input.timeBudgetMs !== undefined && (!Number.isSafeInteger(input.timeBudgetMs) || input.timeBudgetMs <= 0))) {
        return json(400, { status: "error", message: "Invalid Claude agent request." });
      }
      server?.timeout(request, 0);
      return streamClaudeAgent((signal, onProgress) => pi.runClaude!(bearer(request), {
        prompt: input.prompt!,
        ...(input.resume ? { resume: input.resume } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.timeBudgetMs !== undefined ? { timeBudgetMs: input.timeBudgetMs } : {}),
      }, signal, onProgress), request.signal, options.heartbeatMs ?? RUNNER_HEARTBEAT_MS);
    }

    if (method === "POST" && pathname === "/v1/agent/input") {
      const input = await body<{ content?: string; shouldQuery?: boolean }>(request);
      if (!pi.pushAgentInput || typeof input.content !== "string" || !input.content.trim() || input.content.length > 20_000
        || (input.shouldQuery !== undefined && typeof input.shouldQuery !== "boolean")) {
        return json(400, { accepted: false, reason: "invalid_request" });
      }
      return json(200, await pi.pushAgentInput(bearer(request), {
        content: input.content,
        ...(input.shouldQuery !== undefined ? { shouldQuery: input.shouldQuery } : {}),
      }));
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

    if (method === "POST" && pathname === "/v1/patch") {
      const input = await body<{ patch?: string; directory?: string }>(request);
      if (!pi.applyPatch || typeof input.patch !== "string" || !input.patch.trim() || input.patch.length > 200_000
        || (input.directory !== undefined && (typeof input.directory !== "string" || !input.directory.trim() || input.directory.length > 4_096))) {
        return json(400, { ok: false, error: "invalid_patch_request" });
      }
      server?.timeout(request, 0);
      return json(200, await pi.applyPatch({
        patch: input.patch,
        ...(input.directory ? { directory: input.directory } : {}),
      }, request.signal));
    }

    if (method === "POST" && pathname === "/v1/plan") {
      const input = await body<PlanRequest>(request);
      if (!pi.managePlan || !validPlanRequest(input)) {
        return json(400, { ok: false, error: "invalid_plan_request" });
      }
      server?.timeout(request, 0);
      return json(200, await pi.managePlan(input, request.signal));
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

    if (method === "POST" && pathname === "/pull-requests/watch") {
      const input = await body<{ sessionId?: string; prUrl?: string }>(request);
      if (!pi.watchPullRequestChecks || !input.sessionId || !input.prUrl) {
        return json(400, { ok: false, error: "invalid_request" });
      }
      return json(200, { ok: true, ...await pi.watchPullRequestChecks(input.sessionId, input.prUrl) });
    }

    if (method === "POST" && pathname === "/pull-requests/abort") {
      const input = await body<{ sessionId?: string }>(request);
      if (!pi.abortPullRequestWatch || !input.sessionId) return json(400, { ok: false, error: "invalid_request" });
      await pi.abortPullRequestWatch(input.sessionId);
      return json(200, { ok: true });
    }

    if (method === "POST" && pathname === "/pull-requests/reviews") {
      const input = await body<{ prUrl?: string }>(request);
      if (!pi.checkPullRequestReviews || !input.prUrl) return json(400, { ok: false, error: "invalid_request" });
      return json(200, { ok: true, ...await pi.checkPullRequestReviews(input.prUrl) });
    }

    return json(404, { ok: false, error: "not_found" });
  }
}

function validPlanRequest(input: PlanRequest): boolean {
  if (!input || typeof input !== "object" || !["list", "replace", "add", "update", "remove", "reconcile"].includes(input.action)) {
    return false;
  }
  if (input.steps !== undefined && (!Array.isArray(input.steps) || input.steps.length > 20
    || input.steps.some((step) => !step || typeof step.content !== "string" || !step.content.trim() || step.content.length > 500
      || !["pending", "inProgress", "completed", "canceled"].includes(step.status)))) return false;
  if (input.id !== undefined && (!Number.isSafeInteger(input.id) || input.id < 1)) return false;
  if (input.content !== undefined && (typeof input.content !== "string" || !input.content.trim() || input.content.length > 500)) return false;
  if (input.status !== undefined && !["pending", "inProgress", "completed", "canceled"].includes(input.status)) return false;
  if (input.dispositions !== undefined && (!Array.isArray(input.dispositions) || input.dispositions.length > 20
    || input.dispositions.some((item) => !item || !Number.isSafeInteger(item.id) || item.id < 1
      || !["done", "blocked", "deferred", "abandoned"].includes(item.disposition)
      || typeof item.note !== "string" || !item.note.trim() || item.note.length > 500
      || (item.owner !== undefined && (typeof item.owner !== "string" || !item.owner.trim() || item.owner.length > 200))
      || (item.nextAction !== undefined && (typeof item.nextAction !== "string" || !item.nextAction.trim() || item.nextAction.length > 500))))) return false;
  if (input.action === "replace") return input.steps !== undefined;
  if (input.action === "add") return input.content !== undefined;
  if (input.action === "update") return input.id !== undefined && (input.content !== undefined || input.status !== undefined);
  if (input.action === "remove") return input.id !== undefined;
  if (input.action === "reconcile") return input.dispositions !== undefined;
  return input.action === "list";
}

function streamClaudeAgent(
  run: (signal: AbortSignal, onProgress: CapsuleAgentProgressHandler) => Promise<CapsuleAgentResult>,
  requestSignal: AbortSignal,
  heartbeatMs: number,
): Response {
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  if (requestSignal.aborted) abort();
  else requestSignal.addEventListener("abort", abort, { once: true });
  let cancelled = false;
  let completed = false;
  let heartbeat: NodeJS.Timeout | undefined;
  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = undefined;
    requestSignal.removeEventListener("abort", abort);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      heartbeat = setInterval(() => {
        if (!cancelled && !completed) controller.enqueue(encoder.encode("\n"));
      }, Math.max(1, heartbeatMs));
      heartbeat.unref();
      void run(abortController.signal, async (progress) => {
        if (!cancelled) controller.enqueue(encoder.encode(encodeCapsuleAgentStreamEvent({ type: "progress", progress })));
      }).then((result) => {
        completed = true;
        cleanup();
        if (cancelled) return;
        controller.enqueue(encoder.encode(encodeCapsuleAgentStreamEvent({ type: "result", result })));
        controller.close();
      }).catch((error: unknown) => {
        completed = true;
        cleanup();
        if (cancelled) return;
        controller.enqueue(encoder.encode(encodeCapsuleAgentStreamEvent({
          type: "result",
          result: { status: "error", message: error instanceof Error ? error.message : String(error) },
        })));
        controller.close();
      });
    },
    cancel() {
      cancelled = true;
      cleanup();
      abortController.abort();
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
