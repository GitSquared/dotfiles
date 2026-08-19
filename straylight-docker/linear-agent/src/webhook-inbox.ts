import crypto from "node:crypto";
import path from "node:path";
import { finalText } from "./redaction.js";
import { JsonStore } from "./storage.js";
import type { LinearWebhook } from "./types.js";

type PendingDelivery = {
  key: string;
  status: "pending";
  receivedAt: number;
  attempts: number;
  nextAttemptAt: number;
  payload: LinearWebhook;
  lastError?: string;
};

type CompletedDelivery = {
  key: string;
  status: "complete";
  receivedAt: number;
  completedAt: number;
};

type DeadDelivery = {
  key: string;
  status: "dead";
  receivedAt: number;
  failedAt: number;
  attempts: number;
  message: string;
  event: {
    type?: string;
    action?: string;
    issueId?: string;
    documentId?: string;
    commentId?: string;
  };
};

type StoredDelivery = PendingDelivery | CompletedDelivery | DeadDelivery;
type InboxState = { version: 1; deliveries: StoredDelivery[] };

const MAX_COMPLETED = 2_048;
const MAX_DEAD = 128;

export class PermanentWebhookDeliveryError extends Error {
  override readonly name = "PermanentWebhookDeliveryError";
}

function deliveryKey(body: Buffer): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export type WebhookInboxStatus = {
  persistent: true;
  pending: number;
  completed: number;
  deadLetters: number;
  attempts: number;
  nextAttemptAt?: string;
  lastFailure?: string;
  lastDeadLetter?: {
    at: string;
    attempts: number;
    type?: string;
    action?: string;
    message: string;
  };
};

export class DurableWebhookInbox {
  private readonly store: JsonStore<InboxState>;
  private draining = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly retentionMs: number;
  private readonly retryBaseMs: number;
  private readonly maxRetryMs: number;
  private readonly deadRetentionMs: number;

  constructor(
    stateDirectory: string,
    private readonly handler: (payload: LinearWebhook) => Promise<void>,
    options: { retentionMs?: number; retryBaseMs?: number; maxRetryMs?: number; deadRetentionMs?: number } = {},
  ) {
    this.store = new JsonStore(path.join(stateDirectory, "webhook-inbox.json"), {
      version: 1,
      deliveries: [],
    });
    this.retentionMs = options.retentionMs ?? 10 * 60_000;
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.maxRetryMs = options.maxRetryMs ?? 5 * 60_000;
    this.deadRetentionMs = options.deadRetentionMs ?? 7 * 24 * 60 * 60_000;
  }

  async initialize(): Promise<void> {
    this.closed = false;
    await this.store.update((state) => { this.prune(state, Date.now()); });
    this.kick(0);
  }

  shutdown(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async enqueue(body: Buffer, payload: LinearWebhook, now = Date.now()): Promise<boolean> {
    const key = deliveryKey(body);
    const fresh = await this.store.update((state) => {
      this.prune(state, now);
      if (state.deliveries.some((delivery) => delivery.key === key)) return false;
      state.deliveries.push({
        key,
        status: "pending",
        receivedAt: now,
        attempts: 0,
        nextAttemptAt: now,
        payload,
      });
      return true;
    });
    if (fresh) this.kick(0);
    return fresh;
  }

  async status(): Promise<WebhookInboxStatus> {
    const state = await this.store.read();
    const pending = state.deliveries.filter((delivery): delivery is PendingDelivery => delivery.status === "pending");
    const completed = state.deliveries.filter((delivery) => delivery.status === "complete").length;
    const dead = state.deliveries
      .filter((delivery): delivery is DeadDelivery => delivery.status === "dead")
      .sort((left, right) => right.failedAt - left.failedAt);
    const next = pending.map((delivery) => delivery.nextAttemptAt).sort((left, right) => left - right)[0];
    const failed = [...pending].filter((delivery) => delivery.lastError).sort((left, right) => right.nextAttemptAt - left.nextAttemptAt)[0];
    return {
      persistent: true,
      pending: pending.length,
      completed,
      deadLetters: dead.length,
      attempts: pending.reduce((total, delivery) => total + delivery.attempts, 0),
      ...(next === undefined ? {} : { nextAttemptAt: new Date(next).toISOString() }),
      ...(failed?.lastError ? { lastFailure: failed.lastError } : {}),
      ...(dead[0] ? {
        lastDeadLetter: {
          at: new Date(dead[0].failedAt).toISOString(),
          attempts: dead[0].attempts,
          ...(dead[0].event.type ? { type: dead[0].event.type } : {}),
          ...(dead[0].event.action ? { action: dead[0].event.action } : {}),
          message: dead[0].message,
        },
      } : {}),
    };
  }

  private kick(delayMs: number): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, Math.max(0, delayMs));
    this.timer.unref?.();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.closed) return;
    this.draining = true;
    try {
      for (;;) {
        if (this.closed) return;
        const state = await this.store.read();
        const pending = state.deliveries
          .filter((delivery): delivery is PendingDelivery => delivery.status === "pending")
          .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt)[0];
        if (!pending) return;
        const wait = pending.nextAttemptAt - Date.now();
        if (wait > 0) {
          this.kick(wait);
          return;
        }
        try {
          await this.handler(pending.payload);
          await this.store.update((current) => {
            const index = current.deliveries.findIndex((delivery) => delivery.key === pending.key);
            if (index < 0) return;
            current.deliveries[index] = {
              key: pending.key,
              status: "complete",
              receivedAt: pending.receivedAt,
              completedAt: Date.now(),
            };
            this.prune(current, Date.now());
          });
        } catch (error) {
          const message = finalText(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
          if (error instanceof PermanentWebhookDeliveryError) {
            await this.store.update((current) => {
              const index = current.deliveries.findIndex((delivery) => delivery.key === pending.key);
              if (index < 0) return;
              current.deliveries[index] = {
                key: pending.key,
                status: "dead",
                receivedAt: pending.receivedAt,
                failedAt: Date.now(),
                attempts: pending.attempts + 1,
                message,
                event: eventSummary(pending.payload),
              };
              this.prune(current, Date.now());
            });
            console.error("permanent Linear webhook delivery quarantined", {
              key: pending.key.slice(0, 12),
              message,
              event: eventSummary(pending.payload),
            });
            continue;
          }
          let nextAttemptAt = Date.now() + this.retryBaseMs;
          await this.store.update((current) => {
            const delivery = current.deliveries.find((item): item is PendingDelivery => item.key === pending.key && item.status === "pending");
            if (!delivery) return;
            delivery.attempts += 1;
            delivery.lastError = message;
            const delay = Math.min(this.maxRetryMs, this.retryBaseMs * 2 ** Math.min(delivery.attempts - 1, 12));
            delivery.nextAttemptAt = Date.now() + delay;
            nextAttemptAt = delivery.nextAttemptAt;
          });
          console.error("durable Linear webhook delivery failed; retry scheduled", {
            key: pending.key.slice(0, 12),
            message,
            nextAttemptAt: new Date(nextAttemptAt).toISOString(),
          });
          this.kick(Math.max(0, nextAttemptAt - Date.now()));
          return;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private prune(state: InboxState, now: number): void {
    const cutoff = now - this.retentionMs;
    const deadCutoff = now - this.deadRetentionMs;
    const pending = state.deliveries.filter((delivery) => delivery.status === "pending");
    const completed = state.deliveries
      .filter((delivery): delivery is CompletedDelivery => delivery.status === "complete" && delivery.completedAt >= cutoff)
      .sort((left, right) => right.completedAt - left.completedAt)
      .slice(0, MAX_COMPLETED);
    const dead = state.deliveries
      .filter((delivery): delivery is DeadDelivery => delivery.status === "dead" && delivery.failedAt >= deadCutoff)
      .sort((left, right) => right.failedAt - left.failedAt)
      .slice(0, MAX_DEAD);
    state.version = 1;
    state.deliveries = [...pending, ...completed, ...dead];
  }
}

function eventSummary(payload: LinearWebhook): DeadDelivery["event"] {
  const notification = "notification" in payload ? payload.notification : undefined;
  const agentSession = "agentSession" in payload ? payload.agentSession : undefined;
  const issueId = notification?.issueId ?? agentSession?.issueId;
  return {
    ...(payload.type ? { type: payload.type } : {}),
    ...(payload.action ? { action: payload.action } : {}),
    ...(issueId ? { issueId } : {}),
    ...(notification?.documentId ? { documentId: notification.documentId } : {}),
    ...(notification?.commentId ? { commentId: notification.commentId } : {}),
  };
}
