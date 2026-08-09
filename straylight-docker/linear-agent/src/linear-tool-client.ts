import type {
  LinearManageRequest,
  LinearManageResult,
} from "./linear-actions.js";

const MAX_RESULT_BYTES = 256 * 1024;

export class LinearToolClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string, // yadm-secret-scan: ignore
  ) {}

  async manage(request: LinearManageRequest, signal?: AbortSignal): Promise<LinearManageResult> {
    const response = await fetch(`${this.baseUrl}/v1/linear`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESULT_BYTES) throw new Error("Linear response exceeded the safe result limit");
    let payload: LinearManageResult | { ok?: false; message?: string };
    try { payload = JSON.parse(raw) as LinearManageResult | { ok?: false; message?: string }; }
    catch { throw new Error(`Linear workbench broker returned invalid JSON (HTTP ${response.status})`); }
    if (!response.ok || payload.ok !== true) {
      throw new Error("message" in payload && payload.message
        ? payload.message
        : `Linear workbench broker rejected the request (HTTP ${response.status})`);
    }
    return payload;
  }

  async upload(filename: string, contentType: string, contents: Uint8Array, signal?: AbortSignal): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/linear-upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({ filename, contentType, dataBase64: Buffer.from(contents).toString("base64") }),
      ...(signal ? { signal } : {}),
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESULT_BYTES) throw new Error("Linear upload preparation response exceeded the safe result limit");
    let payload: { ok?: boolean; assetUrl?: string; message?: string };
    try { payload = JSON.parse(raw) as typeof payload; }
    catch { throw new Error(`Linear upload broker returned invalid JSON (HTTP ${response.status})`); }
    if (!response.ok || payload.ok !== true || !payload.assetUrl) {
      throw new Error(payload.message || `Linear upload broker rejected the file (HTTP ${response.status})`);
    }
    return payload.assetUrl;
  }
}
