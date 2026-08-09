import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { test } from "bun:test";
import { DeliveryDeduper, PersistentDeliveryDeduper, freshWebhookTimestamp, verifyWebhookSignature } from "../src/signature.js";

test("accepts a valid Linear HMAC", () => {
  const body = Buffer.from('{"hello":"straylight"}');
  const signature = crypto.createHmac("sha256", "secret").update(body).digest("hex");
  assert.equal(verifyWebhookSignature("secret", signature, body), true);
});

test("rejects malformed and incorrect HMACs", () => {
  const body = Buffer.from("hello");
  assert.equal(verifyWebhookSignature("secret", undefined, body), false);
  assert.equal(verifyWebhookSignature("secret", "wat", body), false);
  assert.equal(verifyWebhookSignature("secret", "0".repeat(64), body), false);
});

test("allows only fresh webhook timestamps", () => {
  assert.equal(freshWebhookTimestamp(100_000, 100_010), true);
  assert.equal(freshWebhookTimestamp(1, 100_000), false);
  assert.equal(freshWebhookTimestamp("100000", 100_000), false);
});

test("deduplicates identical deliveries", () => {
  const deduper = new DeliveryDeduper(1_000, 10);
  assert.equal(deduper.accept(Buffer.from("one"), 100), true);
  assert.equal(deduper.accept(Buffer.from("one"), 101), false);
  assert.equal(deduper.accept(Buffer.from("one"), 1_200), true);
});

test("deduplicates webhook deliveries across process restarts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-deliveries-"));
  try {
    const payload = Buffer.from('{"type":"AgentSessionEvent","webhookId":"one"}');
    const first = new PersistentDeliveryDeduper(directory);
    assert.equal(await first.accept(payload, 1_000_000), true);
    const restarted = new PersistentDeliveryDeduper(directory);
    assert.equal(await restarted.accept(payload, 1_000_001), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
