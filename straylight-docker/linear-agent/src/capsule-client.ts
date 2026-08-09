export type CapsuleResult =
  | { status: "ok"; answer: string }
  | { status: "error"; message: string };

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
}
