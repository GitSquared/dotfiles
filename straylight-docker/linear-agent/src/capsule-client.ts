import type { WorkDisposition } from "./runner-protocol.js";
import type { AgentActivityContent } from "./types.js";

export type CapsuleResult =
  | { status: "ok"; answer: string }
  | { status: "error"; message: string };

export type CapsuleAgentResult =
  | { status: "ok"; answer: string; sessionId: string; awaitingInput: boolean; durationMs: number; disposition: WorkDisposition }
  | { status: "error"; message: string };

export type CapsuleAgentRequest = {
  prompt: string;
  taskUrl: string;
  workbenchUrl: string;
  taskToken: string; // yadm-secret-scan: ignore
  resume?: string;
  model?: string;
};

export type BrokeredCapsuleAgentRequest = Pick<CapsuleAgentRequest, "prompt" | "resume" | "model">;
export type CapsuleAgentProgress = Extract<AgentActivityContent, { type: "thought" | "action" }>;
export type CapsuleAgentProgressHandler = (progress: CapsuleAgentProgress) => void | Promise<void>;

export type CapsuleAgentStreamEvent =
  | { type: "progress"; progress: CapsuleAgentProgress }
  | { type: "result"; result: CapsuleAgentResult };

const MAX_RESULT_BYTES = 256 * 1024;

export function validClaudeRequest(value: string): boolean {
  return value.trim().length > 0 && value.length <= 20_000;
}

export class CapsuleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string, // yadm-secret-scan: ignore
  ) {}

  async ask(request: string, signal?: AbortSignal): Promise<CapsuleResult> {
    if (!validClaudeRequest(request)) return { status: "error", message: "Claude requests must contain 1-20,000 characters." };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/ask`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ request }),
        ...(signal ? { signal } : {}),
        timeout: false,
      } as BunFetchRequestInit);
    } catch (error) {
      if (signal?.aborted) throw error;
      return { status: "error", message: "The Claude workbench connection failed." };
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESULT_BYTES) return { status: "error", message: "The capsule response exceeded the safe result limit." };
    let payload: CapsuleResult;
    try { payload = JSON.parse(raw) as CapsuleResult; }
    catch { return { status: "error", message: `The Claude workbench returned invalid JSON (HTTP ${response.status}).` }; }
    if (!payload || !["ok", "error"].includes(payload.status)) return { status: "error", message: "The Claude workbench returned an invalid status." };
    if (payload.status === "ok" && typeof payload.answer !== "string") return { status: "error", message: "The Claude workbench returned an invalid answer." };
    if (payload.status === "error" && typeof payload.message !== "string") return { status: "error", message: "The Claude workbench returned an invalid error." };
    if (!response.ok && payload.status !== "error") return { status: "error", message: "The Claude workbench request failed." };
    return payload;
  }

  async runAgent(
    request: CapsuleAgentRequest,
    signal?: AbortSignal,
    onProgress?: CapsuleAgentProgressHandler,
  ): Promise<CapsuleAgentResult> {
    return this.agentRequest(request, signal, onProgress);
  }

  async runBrokeredAgent(
    request: BrokeredCapsuleAgentRequest,
    signal?: AbortSignal,
    onProgress?: CapsuleAgentProgressHandler,
  ): Promise<CapsuleAgentResult> {
    return this.agentRequest(request, signal, onProgress);
  }

  private async agentRequest(
    request: CapsuleAgentRequest | BrokeredCapsuleAgentRequest,
    signal?: AbortSignal,
    onProgress?: CapsuleAgentProgressHandler,
  ): Promise<CapsuleAgentResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/agent`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
        timeout: false,
      } as BunFetchRequestInit);
    } catch (error) {
      if (signal?.aborted) throw error;
      return { status: "error", message: "The Claude agent capsule connection failed." };
    }
    if (response.headers.get("content-type")?.includes("application/x-ndjson")) {
      return readAgentStream(response, signal, onProgress);
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESULT_BYTES) return { status: "error", message: "The Claude agent response exceeded the safe result limit." };
    let payload: CapsuleAgentResult;
    try { payload = JSON.parse(raw) as CapsuleAgentResult; }
    catch { return { status: "error", message: `The Claude agent capsule returned invalid JSON (HTTP ${response.status}).` }; }
    if (!validAgentResult(payload)) {
      return { status: "error", message: "The Claude agent capsule returned an invalid result." };
    }
    if (payload.status === "error") return payload;
    if (!response.ok) return { status: "error", message: "The Claude agent capsule request failed." };
    return payload;
  }
}

export function encodeCapsuleAgentStreamEvent(event: CapsuleAgentStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

async function readAgentStream(
  response: Response,
  signal?: AbortSignal,
  onProgress?: CapsuleAgentProgressHandler,
): Promise<CapsuleAgentResult> {
  if (!response.body) return { status: "error", message: "The Claude agent capsule returned an empty stream." };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let result: CapsuleAgentResult | undefined;
  try {
    while (true) {
      const chunk = await reader.read();
      buffered += decoder.decode(chunk.value, { stream: !chunk.done });
      if (Buffer.byteLength(buffered) > MAX_RESULT_BYTES) {
        return { status: "error", message: "The Claude agent stream event exceeded the safe result limit." };
      }
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseAgentStreamEvent(line);
        if (!event) continue;
        if (event.type === "progress") await onProgress?.(event.progress);
        else result = event.result;
      }
      if (chunk.done) break;
    }
    const trailing = parseAgentStreamEvent(buffered);
    if (trailing?.type === "progress") await onProgress?.(trailing.progress);
    else if (trailing?.type === "result") result = trailing.result;
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      status: "error",
      message: error instanceof Error ? error.message : "The Claude agent capsule returned an invalid stream.",
    };
  } finally {
    reader.releaseLock();
  }
  return result ?? { status: "error", message: "The Claude agent capsule stream ended without a result." };
}

function parseAgentStreamEvent(line: string): CapsuleAgentStreamEvent | undefined {
  if (!line.trim()) return undefined;
  let event: unknown;
  try { event = JSON.parse(line); }
  catch { throw new Error("The Claude agent capsule returned invalid streaming JSON."); }
  if (!event || typeof event !== "object") throw new Error("The Claude agent capsule returned an invalid stream event.");
  const candidate = event as Partial<CapsuleAgentStreamEvent>;
  if (candidate.type === "progress" && validProgress(candidate.progress)) return candidate as Extract<CapsuleAgentStreamEvent, { type: "progress" }>;
  if (candidate.type === "result" && validAgentResult(candidate.result)) return candidate as Extract<CapsuleAgentStreamEvent, { type: "result" }>;
  throw new Error("The Claude agent capsule returned an invalid stream event.");
}

function validProgress(value: unknown): value is CapsuleAgentProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Partial<CapsuleAgentProgress>;
  if (progress.type === "thought") return typeof progress.body === "string" && progress.body.length > 0 && progress.body.length <= 8_000;
  return progress.type === "action"
    && typeof progress.action === "string" && progress.action.length > 0 && progress.action.length <= 1_000
    && typeof progress.parameter === "string" && progress.parameter.length > 0 && progress.parameter.length <= 8_000
    && (progress.result === undefined || (typeof progress.result === "string" && progress.result.length <= 8_000));
}

function validAgentResult(value: unknown): value is CapsuleAgentResult {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<CapsuleAgentResult>;
  if (payload.status === "error") return typeof payload.message === "string";
  return payload.status === "ok"
    && typeof payload.answer === "string"
    && typeof payload.sessionId === "string"
    && typeof payload.awaitingInput === "boolean"
    && typeof payload.durationMs === "number"
    && validDisposition(payload.disposition);
}

function validDisposition(value: unknown): value is WorkDisposition {
  if (!value || typeof value !== "object") return false;
  const disposition = value as Partial<WorkDisposition>;
  return ["awaiting_steering", "awaiting_qa", "blocked_external", "deferred"].includes(disposition.status ?? "")
    && typeof disposition.reason === "string"
    && disposition.reason.length > 0
    && (disposition.nextAction === undefined || typeof disposition.nextAction === "string")
    && (!["blocked_external", "deferred"].includes(disposition.status ?? "")
      || (typeof disposition.nextAction === "string" && disposition.nextAction.length > 0));
}
