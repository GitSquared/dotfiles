import type { WorkDisposition } from "./runner-protocol.js";
import type { AgentActivityContent } from "./types.js";

// SDK-reported usage for one runAgent turn. Two token counts are captured on
// purpose: `usage` (from the SDK's own `result` message) and `observed` (this
// harness's own running total across streamed assistant messages) - it is not
// yet confirmed whether `result.usage` reflects the whole multi-turn
// streaming-input session (Slice 19) or just the final turn. Compare the two
// on the first live run and drop whichever one turns out redundant.
export type CapsuleAgentUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  // The SDK's own cost estimate. Under subscription auth this is very likely
  // a notional API-equivalent price, not money actually spent - do not
  // relabel it as real spend without confirming the billing model first.
  sdkReportedCostUsd: number | undefined;
  modelTurns: number;
  toolCallCount: number;
  observed: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
};

export type CapsuleAgentResult =
  | { status: "ok"; answer: string; sessionId: string; awaitingInput: boolean; durationMs: number; disposition: WorkDisposition; usage?: CapsuleAgentUsage }
  | { status: "error"; message: string; sessionId?: string; durationMs?: number };

export type CapsuleAgentRequest = {
  prompt: string;
  taskUrl: string;
  workbenchUrl: string;
  taskToken: string; // yadm-secret-scan: ignore
  capsuleAuthUrl: string;
  toolAuthUrl: string;
  resume?: string;
  model?: string;
  timeBudgetMs?: number;
  requestId?: string;
};

export type PushInputResult = { accepted: boolean; reason?: string };

export type BrokeredCapsuleAgentRequest = Pick<CapsuleAgentRequest, "prompt" | "resume" | "model" | "timeBudgetMs">;
export type CapsuleAgentProgress = Extract<AgentActivityContent, { type: "thought" | "response" | "action" }>;
export type CapsuleAgentProgressHandler = (progress: CapsuleAgentProgress) => void | Promise<void>;

export type CapsuleAgentStreamEvent =
  | { type: "progress"; progress: CapsuleAgentProgress }
  | { type: "result"; result: CapsuleAgentResult };

const MAX_RESULT_BYTES = 256 * 1024;

export class CapsuleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string, // yadm-secret-scan: ignore
  ) {}

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

  // Pushes into a specific already-running capsule request (Slice 19) - used
  // by the workbench, which knows the requestId it minted when it started
  // that run via runAgent above.
  async pushInput(requestId: string, content: string, shouldQuery?: boolean): Promise<PushInputResult> {
    return this.postForAcceptance(`/v1/agent/${encodeURIComponent(requestId)}/input`, content, shouldQuery);
  }

  // Same idea, but from inside the task container: it never sees the real
  // capsule's requestId, only its own per-task bearer token, so it asks its
  // broker (the workbench's own /v1/agent/input route) to resolve which live
  // run that token belongs to.
  async followUpBrokered(content: string, shouldQuery?: boolean): Promise<PushInputResult> {
    return this.postForAcceptance("/v1/agent/input", content, shouldQuery);
  }

  private async postForAcceptance(pathname: string, content: string, shouldQuery?: boolean): Promise<PushInputResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ content, ...(shouldQuery !== undefined ? { shouldQuery } : {}) }),
      });
    } catch {
      return { accepted: false, reason: "network_error" };
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { return { accepted: false, reason: "invalid_response" }; }
    if (!payload || typeof payload !== "object" || typeof (payload as Partial<PushInputResult>).accepted !== "boolean") {
      return { accepted: false, reason: "invalid_response" };
    }
    return payload as PushInputResult;
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
  // "response" (the model's own composed narration) shares thought's plain body
  // shape - only the who's-speaking label differs, decided downstream in
  // claude.ts. Without this, every capsule stream event carrying the model's
  // own words throws "invalid stream event" instead of surfacing them.
  if (progress.type === "thought" || progress.type === "response") {
    return typeof progress.body === "string" && progress.body.length > 0 && progress.body.length <= 8_000;
  }
  return progress.type === "action"
    && typeof progress.action === "string" && progress.action.length > 0 && progress.action.length <= 1_000
    && typeof progress.parameter === "string" && progress.parameter.length > 0 && progress.parameter.length <= 8_000
    && (progress.result === undefined || (typeof progress.result === "string" && progress.result.length <= 8_000));
}

function validAgentResult(value: unknown): value is CapsuleAgentResult {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<CapsuleAgentResult>;
  if (payload.status === "error") {
    return typeof payload.message === "string"
      && (payload.sessionId === undefined || typeof payload.sessionId === "string")
      && (payload.durationMs === undefined || typeof payload.durationMs === "number");
  }
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
