import type { RunnerEvent } from "./runner-protocol.js";

type ProgressSender = (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>;

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
