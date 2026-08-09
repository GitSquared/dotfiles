import assert from "node:assert/strict";
import { test } from "bun:test";
import { captureCommand, runCommand } from "../src/runtime.js";

test("captures subprocess output through Bun", async () => {
  const result = await runCommand("printf", ["bun-native"]);
  assert.equal(result.stdout, "bun-native");
  assert.equal(result.stderr, "");
});

test("reports a captured subprocess exit code", async () => {
  const result = await captureCommand("bun", ["-e", "console.error('expected'); process.exit(7)"]);
  assert.equal(result.exitCode, 7);
  assert.match(result.stderr, /expected/);
});
