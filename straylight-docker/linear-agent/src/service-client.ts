export type DevelopmentService = "postgres" | "browser";
export type DevelopmentServiceAction = "start" | "status" | "logs" | "stop";

export type ServiceRequest = {
  action: DevelopmentServiceAction;
  service: DevelopmentService;
  persistent?: boolean;
  tail?: number;
};

export type ServiceResult = {
  ok: boolean;
  service: DevelopmentService;
  status: "starting" | "running" | "stopped" | "missing" | "failed";
  connection?: Record<string, string | number>;
  logs?: string;
  message?: string;
};

const MAX_RESULT_BYTES = 128 * 1024;

export class ServiceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string, // yadm-secret-scan: ignore
  ) {}

  async manage(request: ServiceRequest, signal?: AbortSignal): Promise<ServiceResult> {
    const response = await fetch(`${this.baseUrl}/v1/services`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESULT_BYTES) throw new Error("Development service response exceeded the safe result limit");
    let payload: ServiceResult;
    try { payload = JSON.parse(raw) as ServiceResult; }
    catch { throw new Error(`Development service supervisor returned invalid JSON (HTTP ${response.status})`); }
    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error(payload?.message || `Development service supervisor rejected the request (HTTP ${response.status})`);
    }
    return payload;
  }
}
