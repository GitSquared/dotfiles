import assert from "node:assert/strict";
import { test } from "bun:test";
import { putPreparedLinearUpload } from "../src/linear.js";

const capability = {
  assetUrl: "https://uploads.linear.app/workspace/duck",
  uploadUrl: "https://storage.example.test/signed-upload",
  headers: [{ key: "x-upload-token", value: "narrow-capability" }],
};

test("uploads a Linear asset with returned headers and retries a transient socket failure", async () => {
  const attempts: RequestInit[] = [];
  const result = await putPreparedLinearUpload(
    capability,
    "image/png",
    new Uint8Array([1, 2, 3]),
    undefined,
    async (_input, init) => {
      attempts.push(init ?? {});
      if (attempts.length === 1) throw new Error("socket closed");
      return new Response(null, { status: 200 });
    },
    async () => undefined,
  );
  assert.equal(result, capability.assetUrl);
  assert.equal(attempts.length, 2);
  const headers = new Headers(attempts[1]?.headers);
  assert.equal(headers.get("content-type"), "image/png");
  assert.equal(headers.get("x-upload-token"), "narrow-capability");
  assert.equal(attempts[1]?.redirect, "error");
});

test("rejects an upload capability with a non-Linear asset URL", async () => {
  await assert.rejects(
    putPreparedLinearUpload({ ...capability, assetUrl: "https://example.test/duck" }, "image/png", new Uint8Array([1])),
    /invalid private asset URL/,
  );
});

test("does not use a prepared upload after cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    putPreparedLinearUpload(capability, "image/png", new Uint8Array([1]), controller.signal),
    /cancelled/,
  );
});
