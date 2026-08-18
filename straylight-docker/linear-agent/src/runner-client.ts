import type { AgentTaskPayload, LinearInputFile, RepositoryCandidate } from "./types.js";
import { parseRunnerEvent, type PiResult, type RunnerEvent, type SessionRequest } from "./runner-protocol.js";

export type RunnerEventHandler = (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>;

export interface AgentRunner {
  run(payload: AgentTaskPayload, onEvent: RunnerEventHandler): Promise<PiResult>;
  followUp(sessionId: string, prompt: string, inputs?: LinearInputFile[]): Promise<boolean>;
  abort(sessionId: string): Promise<boolean>;
  repositories(): Promise<RepositoryCandidate[]>;
  health(): Promise<Record<string, unknown>>;
}

export class PiRunnerClient implements AgentRunner {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string, // yadm-secret-scan: ignore
  ) {}

  async run(payload: AgentTaskPayload, onEvent: RunnerEventHandler): Promise<PiResult> {
    const response = await fetch(`${this.baseUrl}/run`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ payload }),
    });
    if (!response.ok || !response.body) throw new Error(`Agent runner rejected run: HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: PiResult | undefined;
    let eventCount = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = parseRunnerEvent(line);
          eventCount += 1;
          if (event.type === "result") result = event.result;
          else await onEvent(event);
        }
        if (chunk.done) break;
      }
      if (buffer.trim()) {
        const event = parseRunnerEvent(buffer);
        eventCount += 1;
        if (event.type === "result") result = event.result;
        else await onEvent(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Agent runner stream failed after ${eventCount} event${eventCount === 1 ? "" : "s"}: ${message}`, { cause: error });
    }
    if (!result) throw new Error(`Agent runner stream ended after ${eventCount} event${eventCount === 1 ? "" : "s"} without a result`);
    return result;
  }

  followUp(sessionId: string, prompt: string, inputs?: LinearInputFile[]): Promise<boolean> {
    return this.command("/follow-up", { sessionId, prompt, ...(inputs?.length ? { inputs } : {}) });
  }

  abort(sessionId: string): Promise<boolean> {
    return this.command("/abort", { sessionId });
  }

  async repositories(): Promise<RepositoryCandidate[]> {
    const response = await fetch(`${this.baseUrl}/repositories`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Agent runner repository discovery failed: HTTP ${response.status}`);
    const payload = await response.json() as { repositories?: RepositoryCandidate[] };
    return Array.isArray(payload.repositories) ? payload.repositories : [];
  }

  async health(): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.baseUrl}/healthz`);
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`Agent runner is unhealthy: HTTP ${response.status}`);
    return payload;
  }

  private async command(path: string, body: SessionRequest): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Agent runner command failed: HTTP ${response.status}`);
    const payload = await response.json() as { accepted?: boolean };
    return payload.accepted === true;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, "content-type": "application/json" };
  }
}
