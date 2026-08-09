import assert from "node:assert/strict";
import { test } from "bun:test";
import { AdaptiveSlots } from "../src/capacity.js";

test("opens adaptive slots gradually while the VM has p75 headroom", () => {
  let demand = 5;
  const capacity = new AdaptiveSlots(() => demand);
  assert.equal(capacity.available(0), true);
  assert.equal(capacity.available(1), false);
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(1), true);
  assert.equal(capacity.available(2), false);
  capacity.record({ at: Date.now(), cpuPercent: 25, memoryPercent: 45 });
  assert.equal(capacity.available(2), true);
  demand = 5;
});

test("closes spare adaptive slots gradually under sustained pressure", () => {
  let demand = 5;
  const capacity = new AdaptiveSlots(() => demand);
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(3), true);
  capacity.record({ at: Date.now(), cpuPercent: 90, memoryPercent: 90 });
  capacity.record({ at: Date.now(), cpuPercent: 90, memoryPercent: 90 });
  capacity.record({ at: Date.now(), cpuPercent: 90, memoryPercent: 90 });
  capacity.record({ at: Date.now(), cpuPercent: 90, memoryPercent: 90 });
  assert.equal(capacity.available(3), false);
  assert.equal(capacity.available(1), true);
  demand = 5;
});

test("forgets unused burst capacity instead of keeping a stale high limit", () => {
  let demand = 5;
  const capacity = new AdaptiveSlots(() => demand);
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(3), true);
  demand = 0;
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(3), false);
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(1), false);
});

test("never closes the final runnable slot", () => {
  const capacity = new AdaptiveSlots(() => 4);
  capacity.record({ at: Date.now(), cpuPercent: 99, memoryPercent: 99 });
  assert.equal(capacity.available(0), true);
  assert.equal(capacity.available(1), false);
  assert.deepEqual(capacity.status(), {
    activeLimit: 1,
    samples: 1,
    windowMs: 600_000,
    p75CpuPercent: 99,
    p75MemoryPercent: 99,
    cpuTargetPercent: 75,
    memoryTargetPercent: 80,
  });
});
