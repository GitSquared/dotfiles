import type { AgentActivityContent, AgentTaskPayload, LinearInputFile } from "./types.js";

export type WorkDisposition = {
  status: "completed" | "blocked_human" | "blocked_external" | "deferred";
  reason: string;
  nextAction?: string;
};

export type PiResult = {
  ok: boolean;
  timedOut: boolean;
  awaitingInput: boolean;
  summary: string;
  elapsedMs: number;
  disposition?: WorkDisposition;
};

export type RunnerEvent =
  | {
      type: "activity";
      content: AgentActivityContent;
      ephemeral: true;
    }
  | { type: "result"; result: PiResult };

export type RunRequest = { payload: AgentTaskPayload };
export type SessionRequest = { sessionId: string; prompt?: string; inputs?: LinearInputFile[] };

export function encodeRunnerEvent(event: RunnerEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function parseRunnerEvent(line: string): RunnerEvent {
  const event = JSON.parse(line) as Partial<RunnerEvent>;
  if (!event || typeof event !== "object") throw new Error("Runner returned an invalid event");
  if (event.type === "activity") {
    if (event.ephemeral !== true || !event.content || typeof event.content !== "object") {
      throw new Error("Runner returned an invalid event");
    }
    return event as Extract<RunnerEvent, { type: "activity" }>;
  }
  if (event.type === "result") {
    const result = event.result;
    if (!result || typeof result !== "object"
      || typeof result.ok !== "boolean"
      || typeof result.timedOut !== "boolean"
      || typeof result.awaitingInput !== "boolean"
      || typeof result.summary !== "string"
      || typeof result.elapsedMs !== "number"
      || (result.disposition !== undefined && !validWorkDisposition(result.disposition))
      || (result.disposition !== undefined
        && result.awaitingInput !== (result.disposition.status === "blocked_human"))) {
      throw new Error("Runner returned an invalid event");
    }
    return event as Extract<RunnerEvent, { type: "result" }>;
  }
  throw new Error("Runner returned an invalid event");
}

function validWorkDisposition(value: unknown): value is WorkDisposition {
  if (!value || typeof value !== "object") return false;
  const disposition = value as Partial<WorkDisposition>;
  return ["completed", "blocked_human", "blocked_external", "deferred"].includes(disposition.status ?? "")
    && typeof disposition.reason === "string"
    && disposition.reason.length > 0
    && (disposition.nextAction === undefined || typeof disposition.nextAction === "string");
}
