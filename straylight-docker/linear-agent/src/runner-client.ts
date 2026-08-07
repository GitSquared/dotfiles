import type { AgentSessionWebhook } from "./types.js";
import { parseRunnerEvent, type PiResult, type RunnerEvent, type SessionRequest } from "./runner-protocol.js";

export type RunnerEventHandler = (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>;

export interface AgentRunner {
  run(payload: AgentSessionWebhook, onEvent: RunnerEventHandler): Promise<PiResult>;
  followUp(sessionId: string, prompt: string): Promise<boolean>;
  abort(sessionId: string): Promise<boolean>;
}

export class PiRunnerClient implements AgentRunner {
  constructor(private readonly baseUrl: string) {}

  async run(payload: AgentSessionWebhook, onEvent: RunnerEventHandler): Promise<PiResult> {
    const response = await fetch(`${this.baseUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    if (!response.ok || !response.body) throw new Error(`Pi runner rejected run: HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: PiResult | undefined;
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseRunnerEvent(line);
        if (event.type === "result") result = event.result;
        else await onEvent(event);
      }
      if (chunk.done) break;
    }
    if (buffer.trim()) {
      const event = parseRunnerEvent(buffer);
      if (event.type === "result") result = event.result;
      else await onEvent(event);
    }
    if (!result) throw new Error("Pi runner ended without a result");
    return result;
  }

  followUp(sessionId: string, prompt: string): Promise<boolean> {
    return this.command("/follow-up", { sessionId, prompt });
  }

  abort(sessionId: string): Promise<boolean> {
    return this.command("/abort", { sessionId });
  }

  private async command(path: string, body: SessionRequest): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Pi runner command failed: HTTP ${response.status}`);
    const payload = await response.json() as { accepted?: boolean };
    return payload.accepted === true;
  }
}
