import type { AgentActivityContent, AgentPlanStep, AgentSessionWebhook } from "./types.js";

export type PiResult = {
  ok: boolean;
  timedOut: boolean;
  awaitingInput: boolean;
  summary: string;
  elapsedMs: number;
};

export type RunnerEvent =
  | { type: "activity"; content: AgentActivityContent; ephemeral?: boolean }
  | { type: "plan"; steps: AgentPlanStep[] }
  | { type: "result"; result: PiResult };

export type RunRequest = { payload: AgentSessionWebhook };
export type SessionRequest = { sessionId: string; prompt?: string };

export function encodeRunnerEvent(event: RunnerEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseRunnerEvent(line: string): RunnerEvent {
  const event = JSON.parse(line) as RunnerEvent;
  if (!event || typeof event !== "object" || !["activity", "plan", "result"].includes(event.type)) {
    throw new Error("Runner returned an invalid event");
  }
  return event;
}
