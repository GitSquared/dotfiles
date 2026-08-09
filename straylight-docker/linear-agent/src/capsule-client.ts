import http from "node:http";
import https from "node:https";

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
    let response: { status: number; raw: string };
    try {
      response = await capsuleRequest(`${this.baseUrl}/v1/ask`, this.token, JSON.stringify({ request }), signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return { status: "error", message: "The Claude workbench connection failed." };
    }
    const { raw } = response;
    let payload: CapsuleResult;
    try { payload = JSON.parse(raw) as CapsuleResult; }
    catch { return { status: "error", message: `The Claude workbench returned invalid JSON (HTTP ${response.status}).` }; }
    if (!payload || !["ok", "error"].includes(payload.status)) return { status: "error", message: "The Claude workbench returned an invalid status." };
    if (payload.status === "ok" && typeof payload.answer !== "string") return { status: "error", message: "The Claude workbench returned an invalid answer." };
    if (payload.status === "error" && typeof payload.message !== "string") return { status: "error", message: "The Claude workbench returned an invalid error." };
    if ((response.status < 200 || response.status >= 300) && payload.status !== "error") return { status: "error", message: "The Claude workbench request failed." };
    return payload;
  }
}

function capsuleRequest(url: string, token: string, body: string, signal?: AbortSignal): Promise<{ status: number; raw: string }> { // yadm-secret-scan: ignore
  const target = new URL(url);
  const transport = target.protocol === "https:" ? https : http;
  if (!(["http:", "https:"] as string[]).includes(target.protocol)) throw new Error("Unsupported Claude capsule protocol");
  return new Promise((resolve, reject) => {
    const request = transport.request(target, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        connection: "close",
        "content-length": Buffer.byteLength(body),
        "content-type": "application/json",
      },
      ...(signal ? { signal } : {}),
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_RESULT_BYTES) {
          request.destroy(new Error("The capsule response exceeded the safe result limit"));
          return;
        }
        chunks.push(buffer);
      });
      response.once("end", () => resolve({ status: response.statusCode ?? 500, raw: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.end(body);
  });
}
