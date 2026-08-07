import crypto from "node:crypto";

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
    const key = crypto.createHash("sha256").update(body).digest("hex");
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
