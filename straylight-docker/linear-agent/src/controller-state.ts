import path from "node:path";
import { JsonStore } from "./storage.js";
import type { ActiveAttention } from "./attention.js";
import type { AgentSessionWebhook } from "./types.js";

export type ControllerSessionRecord = {
  sessionId: string;
  running: boolean;
  awaitingInput: boolean;
  generation: number;
  startedAt?: number;
  pending?: AgentSessionWebhook;
  active?: AgentSessionWebhook;
  issueId?: string;
  teamId?: string;
  humanAssigneeId?: string;
  attention?: ActiveAttention[];
  updatedAt: number;
};

type ControllerStateFile = {
  version: 1;
  sessions: ControllerSessionRecord[];
};

const MAX_STORED_SESSIONS = 500;

export class ControllerStateStore {
  private readonly store: JsonStore<ControllerStateFile>;

  constructor(stateDirectory: string) {
    this.store = new JsonStore(path.join(stateDirectory, "controller-sessions.json"), {
      version: 1,
      sessions: [],
    });
  }

  async load(): Promise<ControllerSessionRecord[]> {
    const state = await this.store.read();
    if (state.version !== 1 || !Array.isArray(state.sessions)) throw new Error("Unsupported controller session registry");
    return state.sessions.filter((record) => (
      record
      && typeof record.sessionId === "string"
      && typeof record.generation === "number"
      && typeof record.running === "boolean"
      && typeof record.awaitingInput === "boolean"
      && (record.humanAssigneeId === undefined || typeof record.humanAssigneeId === "string")
      && (record.attention === undefined || (Array.isArray(record.attention) && record.attention.every((attention) => (
        ["steering", "qa"].includes(attention.kind)
        && ["urgent", "high", "medium", "low", "none"].includes(attention.priority)
        && typeof attention.previousStateId === "string"
        && typeof attention.requestedAt === "number"
      ))))
      && typeof record.updatedAt === "number"
    ));
  }

  save(records: ControllerSessionRecord[]): Promise<void> {
    return this.store.update((state) => {
      state.version = 1;
      state.sessions = [...records]
        .filter((record) => record.running || record.awaitingInput || Boolean(record.pending) || Boolean(record.active) || Boolean(record.attention?.length))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_STORED_SESSIONS);
    });
  }
}
