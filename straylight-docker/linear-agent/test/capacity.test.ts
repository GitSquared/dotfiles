import assert from "node:assert/strict";
import { test } from "bun:test";
import { AdaptiveSlots } from "../src/capacity.js";

test("opens adaptive slots gradually while the VM has p75 headroom", () => {
  let demand = 5;
  const capacity = new AdaptiveSlots(3, () => demand);
  assert.equal(capacity.available(2), true);
  assert.equal(capacity.available(3), false);
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(3), true);
  assert.equal(capacity.available(4), false);
  capacity.record({ at: Date.now(), cpuPercent: 25, memoryPercent: 45 });
  assert.equal(capacity.available(4), true);
  demand = 5;
});

test("closes spare adaptive slots gradually under sustained pressure", () => {
  let demand = 5;
  const capacity = new AdaptiveSlots(3, () => demand);
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(4), true);
  capacity.record({ at: Date.now(), cpuPercent: 90, memoryPercent: 90 });
  capacity.record({ at: Date.now(), cpuPercent: 90, memoryPercent: 90 });
  assert.equal(capacity.available(4), false);
  assert.equal(capacity.available(2), true);
  demand = 5;
});

test("forgets unused burst capacity instead of keeping a stale high limit", () => {
  let demand = 5;
  const capacity = new AdaptiveSlots(3, () => demand);
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(4), true);
  demand = 0;
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(4), false);
  capacity.record({ at: Date.now(), cpuPercent: 20, memoryPercent: 40 });
  assert.equal(capacity.available(3), false);
});
