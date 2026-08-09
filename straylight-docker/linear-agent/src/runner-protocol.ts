import type {
  AgentActivityContent,
  AgentActivitySignal,
  AgentActivitySignalMetadata,
  AgentPlanStep,
  AgentTaskPayload,
  LinearInputFile,
} from "./types.js";

export type PiResult = {
  ok: boolean;
  timedOut: boolean;
  awaitingInput: boolean;
  summary: string;
  elapsedMs: number;
};

export type RunnerEvent =
  | {
      type: "activity";
      content: AgentActivityContent;
      ephemeral?: boolean;
      signal?: AgentActivitySignal;
      signalMetadata?: AgentActivitySignalMetadata;
    }
  | { type: "plan"; steps: AgentPlanStep[] }
  | { type: "external_url"; label: string; url: string }
  | { type: "artifact"; filename: string; contentType: string; dataBase64: string; title?: string; body?: string }
  | {
      type: "linear_publish";
      publication:
        | { kind: "document"; id: string; title: string; body: string; update: boolean }
        | { kind: "attachment"; title: string; url: string; subtitle?: string; body?: string };
    }
  | { type: "result"; result: PiResult };

export type RunRequest = { payload: AgentTaskPayload };
export type SessionRequest = { sessionId: string; prompt?: string; inputs?: LinearInputFile[] };

export function encodeRunnerEvent(event: RunnerEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseRunnerEvent(line: string): RunnerEvent {
  const event = JSON.parse(line) as RunnerEvent;
  if (!event || typeof event !== "object" || !["activity", "plan", "external_url", "artifact", "linear_publish", "result"].includes(event.type)) {
    throw new Error("Runner returned an invalid event");
  }
  return event;
}
