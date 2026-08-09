import fs from "node:fs/promises";
import os from "node:os";

const SAMPLE_INTERVAL_MS = 10_000;
const WINDOW_MS = 600_000;
const CPU_TARGET_PERCENT = 75;
const MEMORY_TARGET_PERCENT = 80;

type CpuSnapshot = { busy: number; total: number };
export type ResourceSample = { at: number; cpuPercent: number; memoryPercent: number };

function p75(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(0.75 * sorted.length) - 1];
}

function cpuSnapshot(): CpuSnapshot {
  let busy = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const sum = Object.values(cpu.times).reduce((value, time) => value + time, 0);
    busy += sum - cpu.times.idle;
    total += sum;
  }
  return { busy, total };
}

async function memorySnapshot(): Promise<{ available: number; total: number }> {
  try {
    const values = new Map<string, number>();
    for (const line of (await fs.readFile("/proc/meminfo", "utf8")).split("\n")) {
      const match = line.match(/^([^:]+):\s+(\d+)\s+kB$/);
      if (match?.[1] && match[2]) values.set(match[1], Number(match[2]) * 1024);
    }
    const total = values.get("MemTotal");
    const available = values.get("MemAvailable");
    if (total && available !== undefined) return { available, total };
  } catch {
    // macOS tests and non-Linux development hosts use the portable fallback.
  }
  return { available: os.freemem(), total: os.totalmem() };
}

export class AdaptiveSlots {
  private readonly samples: ResourceSample[] = [];
  private activeLimit = 1;
  private previousCpu: CpuSnapshot | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly demand: () => number,
    private readonly onChange: () => void = () => {},
  ) {}

  async start(): Promise<void> {
    if (this.timer) return;
    await this.sample();
    this.timer = setInterval(() => { void this.sample(); }, SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  available(activeTurns: number): boolean {
    return activeTurns < this.activeLimit;
  }

  record(sample: ResourceSample): void {
    this.samples.push(sample);
    const cutoff = sample.at - WINDOW_MS;
    while (this.samples[0] && this.samples[0].at < cutoff) this.samples.shift();
    const cpu = p75(this.samples.map((entry) => entry.cpuPercent));
    const memory = p75(this.samples.map((entry) => entry.memoryPercent));
    if (cpu === undefined || memory === undefined) return;
    if (cpu <= CPU_TARGET_PERCENT && memory <= MEMORY_TARGET_PERCENT) {
      if (this.demand() > this.activeLimit) this.activeLimit += 1;
      else if (this.demand() < this.activeLimit) this.activeLimit = Math.max(1, this.activeLimit - 1);
    } else {
      this.activeLimit = Math.max(1, this.activeLimit - 1);
    }
    this.onChange();
  }

  status(): Record<string, unknown> {
    return {
      activeLimit: this.activeLimit,
      samples: this.samples.length,
      windowMs: WINDOW_MS,
      p75CpuPercent: p75(this.samples.map((sample) => sample.cpuPercent)),
      p75MemoryPercent: p75(this.samples.map((sample) => sample.memoryPercent)),
      cpuTargetPercent: CPU_TARGET_PERCENT,
      memoryTargetPercent: MEMORY_TARGET_PERCENT,
    };
  }

  private async sample(): Promise<void> {
    const cpu = cpuSnapshot();
    const memory = await memorySnapshot();
    const previous = this.previousCpu;
    this.previousCpu = cpu;
    if (!previous) return;
    const total = cpu.total - previous.total;
    if (total <= 0) return;
    this.record({
      at: Date.now(),
      cpuPercent: Math.max(0, Math.min(100, 100 * (cpu.busy - previous.busy) / total)),
      memoryPercent: Math.max(0, Math.min(100, 100 * (memory.total - memory.available) / memory.total)),
    });
  }
}
