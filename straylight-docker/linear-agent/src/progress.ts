import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { progressText } from "./redaction.js";

type ProgressSender = (body: string) => Promise<void>;

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const found = firstString(item);
    if (found) return found;
  }
  return undefined;
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

export class ProgressReporter {
  private pending: string | undefined;
  private timer: NodeJS.Timeout | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private lastSent: string | undefined;
  private lastSentAt = 0;

  constructor(
    private readonly send: ProgressSender,
    private readonly debounceMs: number,
    private readonly heartbeatMs: number,
  ) {}

  report(body: string): void {
    const next = progressText(body);
    if (!next || next === this.pending || next === this.lastSent) return;
    this.pending = next;
    if (this.timer) return;
    const delay = Math.max(0, this.debounceMs - (Date.now() - this.lastSentAt));
    this.timer = setTimeout(() => void this.flush(), delay);
    this.timer.unref();
  }

  handle(event: AgentSessionEvent): void {
    switch (event.type) {
      case "agent_start":
        this.report("Pi is starting the coding session.");
        break;
      case "tool_execution_start": {
        const target = toolTarget(event.toolName, event.args);
        this.report(target ? `Running ${event.toolName}: ${target}` : `Running ${event.toolName}`);
        break;
      }
      case "tool_execution_end":
        if (event.isError) this.report(`${event.toolName} reported an error; Pi is adjusting.`);
        break;
      case "compaction_start":
        this.report("Pi is compacting context before continuing.");
        break;
      case "auto_retry_start":
        this.report(`Pi is retrying after an error (${event.attempt}/${event.maxAttempts}).`);
        break;
      default:
        break;
    }
  }

  start(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (!this.pending && Date.now() - this.lastSentAt >= this.heartbeatMs) {
        this.report("Pi is still working.");
      }
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.timer) clearTimeout(this.timer);
    this.heartbeat = undefined;
    this.timer = undefined;
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const body = this.pending;
    this.pending = undefined;
    if (!body) return;
    try {
      await this.send(body);
      this.lastSent = body;
      this.lastSentAt = Date.now();
    } catch (error) {
      console.error("failed to post progress", { message: error instanceof Error ? error.message : String(error) });
    }
  }
}
