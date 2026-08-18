export type CapsuleResult =
  | { status: "ok"; answer: string }
  | { status: "error"; message: string };

export type CapsuleAgentResult =
  | { status: "ok"; answer: string; sessionId: string; awaitingInput: boolean; durationMs: number }
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
      });
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

  async runAgent(request: CapsuleAgentRequest, signal?: AbortSignal): Promise<CapsuleAgentResult> {
    return this.agentRequest(request, signal);
  }

  async runBrokeredAgent(request: BrokeredCapsuleAgentRequest, signal?: AbortSignal): Promise<CapsuleAgentResult> {
    return this.agentRequest(request, signal);
  }

  private async agentRequest(request: CapsuleAgentRequest | BrokeredCapsuleAgentRequest, signal?: AbortSignal): Promise<CapsuleAgentResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/agent`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(request),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      return { status: "error", message: "The Claude agent capsule connection failed." };
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESULT_BYTES) return { status: "error", message: "The Claude agent response exceeded the safe result limit." };
    let payload: CapsuleAgentResult;
    try { payload = JSON.parse(raw) as CapsuleAgentResult; }
    catch { return { status: "error", message: `The Claude agent capsule returned invalid JSON (HTTP ${response.status}).` }; }
    if (payload?.status === "error" && typeof payload.message === "string") return payload;
    if (payload?.status !== "ok"
      || typeof payload.answer !== "string"
      || typeof payload.sessionId !== "string"
      || typeof payload.awaitingInput !== "boolean"
      || typeof payload.durationMs !== "number") {
      return { status: "error", message: "The Claude agent capsule returned an invalid result." };
    }
    if (!response.ok) return { status: "error", message: "The Claude agent capsule request failed." };
    return payload;
  }
}
