import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { finalText, progressText } from "./redaction.js";
import type { RunnerEvent } from "./runner-protocol.js";

type ProgressSender = (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>;

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const found = firstString(item);
    if (found) return found;
  }
  return undefined;
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== "object" || (message as { role?: unknown }).role !== "assistant") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object" || (part as { type?: unknown }).type !== "text") return [];
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  }).join("\n").trim();
}

function toolTarget(name: string, args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const values = args as Record<string, unknown>;
  if (name.toLowerCase() === "bash") return firstString(values.command ?? values.cmd);
  for (const key of ["path", "file_path", "query", "pattern", "glob", "url", "name"]) {
    const found = firstString(values[key]);
    if (found) return found;
  }
  return undefined;
}

function actionName(name: string): string {
  const normalized = name.replace(/[_-]+/g, " ").trim();
  return normalized ? `Running ${normalized}` : "Running tool";
}

export class ProgressReporter {
  private pending: Exclude<RunnerEvent, { type: "result" }> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private lastSent = "";
  private lastSentAt = 0;
  private active = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly send: ProgressSender,
    private readonly debounceMs: number,
    private readonly heartbeatMs: number,
  ) {}

  report(event: Exclude<RunnerEvent, { type: "result" }>): void {
    if (!this.active) return;
    const encoded = JSON.stringify(event);
    if (encoded === this.lastSent || encoded === JSON.stringify(this.pending)) return;
    this.pending = event;
    if (this.timer) return;
    const delay = Math.max(0, this.debounceMs - (Date.now() - this.lastSentAt));
    this.timer = setTimeout(() => void this.flush(), delay);
    this.timer.unref();
  }

  handle(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.report({ type: "activity", content: { type: "thought", body: "The coding agent is starting." }, ephemeral: true });
        break;
      case "message_update": {
        const body = assistantText(event.message);
        if (body) this.report({ type: "activity", content: { type: "thought", body: finalText(body) }, ephemeral: true });
        break;
      }
      case "tool_execution_start": {
        if (event.toolName === "linear" || event.toolName === "request_access" || event.toolName === "manage_plan") break;
        const target = toolTarget(event.toolName, event.args);
        this.report({
          type: "activity",
          content: {
            type: "action",
            action: actionName(event.toolName),
            parameter: target ? progressText(target) : event.toolName,
          },
          ephemeral: true,
        });
        break;
      }
      case "tool_execution_end":
        if (event.isError) {
          this.report({
            type: "activity",
            content: {
              type: "action",
              action: `${actionName(event.toolName)} failed`,
              parameter: event.toolName,
              result: "The agent is adjusting.",
            },
            ephemeral: true,
          });
        }
        break;
      case "compaction_start":
        this.report({ type: "activity", content: { type: "thought", body: "The agent is compacting context before continuing." }, ephemeral: true });
        break;
      case "auto_retry_start":
        this.report({
          type: "activity",
          content: { type: "thought", body: `The agent is retrying after an error (${event.attempt}/${event.maxAttempts}).` },
          ephemeral: true,
        });
        break;
      default:
        break;
    }
  }

  start(): void {
    this.active = true;
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (!this.pending && Date.now() - this.lastSentAt >= this.heartbeatMs) {
        // Heartbeats intentionally repeat the same replacement-style activity.
        // Ordinary progress is deduplicated, but a quiet run must keep renewing
        // its visible proof-of-life instead of showing the message only once.
        this.pending = {
          type: "activity",
          content: { type: "thought", body: "The agent is still working." },
          ephemeral: true,
        };
        void this.flush();
      }
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  stop(): void {
    this.active = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.timer) clearTimeout(this.timer);
    this.heartbeat = undefined;
    this.timer = undefined;
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const event = this.pending;
    this.pending = undefined;
    if (!event) return this.inFlight;
    this.inFlight = this.inFlight.then(async () => {
      try {
        await this.send(event);
        this.lastSent = JSON.stringify(event);
        this.lastSentAt = Date.now();
      } catch (error) {
        console.error("failed to stream progress", { message: error instanceof Error ? error.message : String(error) });
      }
    });
    await this.inFlight;
  }
}
