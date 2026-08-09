import crypto from "node:crypto";
import path from "node:path";
import { JsonStore } from "./storage.js";

type DeliveryRecord = { key: string; receivedAt: number };
type DeliveryState = { version: 1; deliveries: DeliveryRecord[] };

function deliveryKey(body: Buffer): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

export function verifyWebhookSignature(secret: string, signature: string | undefined, body: Buffer): boolean { // yadm-secret-scan: ignore
  if (!signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest(); // yadm-secret-scan: ignore
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function freshWebhookTimestamp(timestamp: unknown, now = Date.now(), toleranceMs = 60_000): boolean {
  return typeof timestamp === "number"
    && Number.isFinite(timestamp)
    && Math.abs(now - timestamp) <= toleranceMs;
}

export class DeliveryDeduper {
  private readonly deliveries = new Map<string, number>();

  constructor(
    private readonly retentionMs = 10 * 60_000,
    private readonly maximumEntries = 2_048,
  ) {}

  accept(body: Buffer, now = Date.now()): boolean {
    const key = deliveryKey(body);
    const cutoff = now - this.retentionMs;
    for (const [known, receivedAt] of this.deliveries) {
      if (receivedAt < cutoff) this.deliveries.delete(known);
    }
    if (this.deliveries.has(key)) return false;
    this.deliveries.set(key, now);
    while (this.deliveries.size > this.maximumEntries) {
      const oldest = this.deliveries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.deliveries.delete(oldest);
    }
    return true;
  }
}

export class PersistentDeliveryDeduper {
  private readonly store: JsonStore<DeliveryState>;

  constructor(
    stateDirectory: string,
    private readonly retentionMs = 10 * 60_000,
    private readonly maximumEntries = 2_048,
  ) {
    this.store = new JsonStore(path.join(stateDirectory, "webhook-deliveries.json"), {
      version: 1,
      deliveries: [],
    });
  }

  accept(body: Buffer, now = Date.now()): Promise<boolean> {
    const key = deliveryKey(body);
    return this.store.update((state) => {
      const cutoff = now - this.retentionMs;
      state.deliveries = state.deliveries
        .filter((record) => record.receivedAt >= cutoff && /^[a-f\d]{64}$/i.test(record.key))
        .slice(-this.maximumEntries);
      if (state.deliveries.some((record) => record.key === key)) return false;
      state.deliveries.push({ key, receivedAt: now });
      if (state.deliveries.length > this.maximumEntries) {
        state.deliveries.splice(0, state.deliveries.length - this.maximumEntries);
      }
      return true;
    });
  }
}
