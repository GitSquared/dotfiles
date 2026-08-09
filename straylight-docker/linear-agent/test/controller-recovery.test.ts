import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import { AgentController } from "../src/controller.js";
import { ControllerStateStore } from "../src/controller-state.js";
import type { LinearClient } from "../src/linear.js";
import type { AgentRunner } from "../src/runner-client.js";
import type { AgentTaskPayload } from "../src/types.js";

test("recovers an interrupted Agent Session from durable state and Linear activity", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linear-controller-"));
  try {
    const store = new ControllerStateStore(directory);
    await store.save([{
      sessionId: "session-1",
      running: true,
      awaitingInput: false,
      generation: 4,
      startedAt: Date.now() - 5_000,
      active: {
        type: "AgentSessionEvent",
        action: "created",
        appUserId: "agent-1",
        agentSession: { id: "session-1", issueId: "issue-1" },
      },
      issueId: "issue-1",
      teamId: "team-1",
      updatedAt: Date.now(),
    }]);

    const activities: unknown[] = [];
    const linear = {
      async agentSessionSnapshot() {
        return {
          id: "session-1",
          status: "active",
          appUser: { id: "agent-1" },
          issue: { id: "issue-1", identifier: "LIN-1", title: "Recover me", team: { id: "team-1" } },
          activities: {
            nodes: [{ id: "activity-1", createdAt: new Date().toISOString(), ephemeral: false, content: { type: "thought", body: "Working" } }],
          },
        };
      },
      async downloadInputs() { return { inputs: [], skipped: [], totalBytes: 0 }; },
      async createActivity(_sessionId: string, content: unknown) { activities.push(content); },
    } as unknown as LinearClient;
    let recoveredPayload: AgentTaskPayload | undefined;
    let aborts = 0;
    const runner = {
      async abort() { aborts += 1; return true; },
      async repositories() { return []; },
      async run(payload: AgentTaskPayload) {
        recoveredPayload = payload;
        return { ok: true, timedOut: false, awaitingInput: false, summary: "Recovered.", elapsedMs: 1 };
      },
      async health() { return { mode: "test" }; },
    } as unknown as AgentRunner;

    const controller = new AgentController(linear, runner, directory);
    await controller.initialize();
    for (let attempt = 0; attempt < 50 && !recoveredPayload; attempt += 1) await Bun.sleep(2);

    assert.equal(aborts, 1);
    assert.equal(recoveredPayload?.action, "prompted");
    assert.match(recoveredPayload?.agentActivity?.content?.body ?? "", /controller restarted/i);
    assert.equal(activities.some((content) => (content as { type?: string }).type === "response"), true);
    const health = await controller.health() as { controller: { registry: { lastRecovery: { resumed: number } } } };
    assert.equal(health.controller.registry.lastRecovery.resumed, 1);
    for (let attempt = 0; attempt < 100 && (await store.load()).length; attempt += 1) await Bun.sleep(2);
    assert.equal((await store.load()).length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
