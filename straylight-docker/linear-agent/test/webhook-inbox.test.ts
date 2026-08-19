import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import type { LinearWebhook } from "../src/types.js";
import { DurableWebhookInbox, PermanentWebhookDeliveryError } from "../src/webhook-inbox.js";

async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await Bun.sleep(2);
  }
  throw new Error("condition was not reached");
}

const payload: LinearWebhook = {
  type: "AgentSessionEvent",
  action: "prompted",
  webhookTimestamp: Date.now(),
  agentSession: { id: "session-1" },
};

test("persists a completed delivery for deduplication across restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-inbox-"));
  try {
    let handled = 0;
    const first = new DurableWebhookInbox(directory, async () => { handled += 1; }, { retryBaseMs: 5 });
    await first.initialize();
    const body = Buffer.from(JSON.stringify(payload));
    assert.equal(await first.enqueue(body, payload), true);
    await waitFor(() => handled === 1);
    await waitFor(async () => (await first.status()).completed === 1);
    first.shutdown();

    const restarted = new DurableWebhookInbox(directory, async () => { handled += 1; }, { retryBaseMs: 5 });
    await restarted.initialize();
    assert.equal(await restarted.enqueue(body, payload), false);
    await Bun.sleep(10);
    assert.equal(handled, 1);
    restarted.shutdown();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("replays a failed pending delivery after restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-inbox-"));
  try {
    const failing = new DurableWebhookInbox(directory, async () => { throw new Error("temporary Linear failure"); }, {
      retryBaseMs: 20,
      maxRetryMs: 20,
    });
    await failing.initialize();
    assert.equal(await failing.enqueue(Buffer.from(JSON.stringify(payload)), payload), true);
    await waitFor(async () => (await failing.status()).attempts === 1);
    failing.shutdown();

    let handled = 0;
    const restarted = new DurableWebhookInbox(directory, async () => { handled += 1; }, {
      retryBaseMs: 5,
      maxRetryMs: 5,
    });
    await restarted.initialize();
    await waitFor(() => handled === 1);
    await waitFor(async () => (await restarted.status()).pending === 0);
    restarted.shutdown();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("quarantines a permanent delivery without retaining private payload text", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-inbox-"));
  try {
    const documentPayload: LinearWebhook = {
      type: "AppUserNotification",
      action: "documentCommentMention",
      notification: {
        documentId: "document-1",
        commentId: "comment-1",
        comment: { id: "comment-1", body: "private review text" },
      },
    };
    const inbox = new DurableWebhookInbox(directory, async () => {
      throw new PermanentWebhookDeliveryError("unsupported document comment anchor");
    }, { retryBaseMs: 5 });
    await inbox.initialize();
    await inbox.enqueue(Buffer.from(JSON.stringify(documentPayload)), documentPayload);
    await waitFor(async () => (await inbox.status()).deadLetters === 1);
    const status = await inbox.status();
    assert.equal(status.pending, 0);
    assert.equal(status.lastDeadLetter?.action, "documentCommentMention");
    const stored = await fs.readFile(path.join(directory, "webhook-inbox.json"), "utf8");
    assert.doesNotMatch(stored, /private review text/);
    inbox.shutdown();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
