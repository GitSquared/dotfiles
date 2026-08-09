import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import { downloadLinearInputs, linearInputReferences } from "../src/linear-inputs.js";
import { materializeLinearInputs } from "../src/pi.js";

test("extracts only deduplicated uploads.linear.app references from Linear context", () => {
  const references = linearInputReferences({
    promptContext: [
      "![Screenshot](https://uploads.linear.app/workspace/screenshot)",
      "[spec.pdf](https://uploads.linear.app/workspace/spec)",
      "https://uploads.linear.app/workspace/screenshot",
      "https://uploads.linear.app.evil.test/stolen",
    ].join("\n"),
  });
  assert.deepEqual(references, [
    { url: "https://uploads.linear.app/workspace/screenshot", label: "Screenshot" },
    { url: "https://uploads.linear.app/workspace/spec", label: "spec.pdf" },
  ]);
});

test("downloads bounded authenticated Linear files and validates image signatures", async () => {
  const seen: Array<{ url: string; authorization: string | null; redirect: RequestRedirect | undefined }> = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({ url, authorization: headers.get("authorization"), redirect: init?.redirect });
    if (url.endsWith("/bad")) return new Response("not an image", { headers: { "content-type": "image/png" } });
    return new Response(png, {
      headers: {
        "content-type": "image/png",
        "content-length": String(png.length),
        "content-disposition": 'attachment; filename="screen.png"',
      },
    });
  }) as typeof fetch;
  const result = await downloadLinearInputs({
    promptContext: [
      "![Good](https://uploads.linear.app/workspace/good)",
      "![Bad](https://uploads.linear.app/workspace/bad)",
    ].join("\n"),
  }, "linear-access-token", fetcher); // yadm-secret-scan: ignore

  assert.equal(result.inputs.length, 1);
  assert.equal(result.inputs[0]?.filename, "screen.png");
  assert.equal(result.inputs[0]?.mimeType, "image/png");
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(seen.map((request) => request.authorization), ["Bearer linear-access-token", "Bearer linear-access-token"]); // yadm-secret-scan: ignore
  assert.deepEqual(seen.map((request) => request.redirect), ["error", "error"]);
});

test("materializes files inside the workspace and returns image parts", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-inputs-"));
  try {
    const bytes = Buffer.from("hello");
    const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = await materializeLinearInputs(directory, [{
      filename: "../note.txt",
      mimeType: "text/plain",
      size: bytes.length,
      dataBase64: bytes.toString("base64"),
    }, {
      filename: "screen.png",
      mimeType: "image/png",
      size: image.length,
      dataBase64: image.toString("base64"),
    }]);
    const listed = result.prompt.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
    const realDirectory = await fs.realpath(directory);
    assert.equal(listed.length, 2);
    assert.equal(listed.every((filename) => path.relative(realDirectory, filename).startsWith("..") === false), true);
    assert.equal(await fs.readFile(listed[0] ?? "", "utf8"), "hello");
    assert.deepEqual(result.images, [{ type: "image", data: image.toString("base64"), mimeType: "image/png" }]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
