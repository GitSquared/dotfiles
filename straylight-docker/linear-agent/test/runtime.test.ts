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

test("writes bounded command input through stdin", async () => {
  const result = await captureCommand("bun", ["-e", "process.stdin.pipe(process.stdout)"], {
    input: "patch-body",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "patch-body");
});
