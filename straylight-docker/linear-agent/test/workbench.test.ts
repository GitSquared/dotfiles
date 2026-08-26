import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import type { WorkbenchConfig } from "../src/config.js";
import { decodeDockerStream, type ContainerEngine } from "../src/docker-engine.js";
import {
  formatUsageReceipt,
  parsePullRequestUrl,
  parseRepositoryRemote,
  repositoryCloneUrl,
  summarizePullRequestChecks,
  taskContainerSpec,
  WorkbenchHarness,
} from "../src/workbench.js";

function config(): WorkbenchConfig {
  return {
    host: "0.0.0.0",
    port: 8788,
    authToken: "r".repeat(32), // yadm-secret-scan: ignore
    dockerSocket: "/var/run/docker.sock",
    taskImage: "linear-agent-runner:local",
    taskNetwork: "linear-agent-tasks",
    hostRoot: "/srv/linear-agent",
    dataDirectory: "/workbench/data",
    workspaceRunsDirectory: "/workbench/workspace-runs",
    repositoryDirectory: "/repositories",
    repositoryRefreshTtlMs: 300_000,
    workspaceInstructions: "/workbench/AGENTS.md",
    memoryDirectory: "/memory",
    maxWarmSessions: 3,
    warmSessionTtlMs: 600_000,
    taskStartupTimeoutMs: 30_000,
    dockerRequestTimeoutMs: 30_000,
    taskMemoryBytes: 4 * 1024 * 1024 * 1024,
    taskNanoCpus: 2_000_000_000,
    taskPidsLimit: 512,
    postgresImage: "postgres:17.10-bookworm",
    browserImage: "linear-agent-browser:local",
    browserVersion: "1.62.0",
    serviceMemoryBytes: 2 * 1024 * 1024 * 1024,
    serviceNanoCpus: 1_000_000_000,
    servicePidsLimit: 256,
    capsuleUrl: "http://linear-agent-claude-capsule:8790",
    controllerUrl: "http://linear-agent-controller:8787",
    capsuleAuthUrl: "https://straylight.example.ts.net/linear/capsule/auth",
    toolAuthUrl: "https://straylight.example.ts.net/linear/tools/auth",
    capsuleControlToken: "c".repeat(32), // yadm-secret-scan: ignore
  };
}

test("parses common Git repository remotes", () => {
  assert.deepEqual(parseRepositoryRemote("git@github.com:GitSquared/nemo.git", "/repositories/nemo"), {
    hostname: "github.com",
    repositoryFullName: "GitSquared/nemo",
    path: "/repositories/nemo",
  });
  assert.deepEqual(parseRepositoryRemote("https://github.com/GitSquared/dotfiles.git"), {
    hostname: "github.com",
    repositoryFullName: "GitSquared/dotfiles",
  });
  assert.equal(parseRepositoryRemote("not-a-remote"), undefined);
  assert.equal(repositoryCloneUrl({ hostname: "github.com", repositoryFullName: "GitSquared/nemo" }), "https://github.com/GitSquared/nemo.git");
});

test("builds a secretless, bounded, per-session task jail", () => {
  const spec = taskContainerSpec(config(), "session-a", "task-token"); // yadm-secret-scan: ignore
  const other = taskContainerSpec(config(), "session-b", "other-token"); // yadm-secret-scan: ignore
  assert.equal(spec.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(spec.HostConfig.CapDrop, ["ALL"]);
  assert.deepEqual(spec.HostConfig.SecurityOpt, ["no-new-privileges:true"]);
  assert.equal(spec.HostConfig.NetworkMode, "linear-agent-tasks");
  assert.equal(spec.HostConfig.Memory, 4 * 1024 * 1024 * 1024);
  assert.ok(spec.HostConfig.Binds.some((bind) => bind.endsWith(":/repositories:ro")));
  assert.ok(spec.HostConfig.Binds.some((bind) => bind.endsWith(":/workspace")));
  assert.ok(spec.HostConfig.Binds.some((bind) => bind.endsWith("/.agent/diagrams:/home/node/.agent/diagrams")));
  assert.notDeepEqual(spec.HostConfig.Binds, other.HostConfig.Binds);
  assert.equal(spec.Env.some((value) => value.startsWith("LINEAR_")), false);
  assert.equal(spec.Env.some((value) => value.startsWith("CAPSULE_CONTROL_")), false);
  assert.equal(spec.Env.some((value) => value === "PI_RUNNER_TOKEN=task-token"), true); // yadm-secret-scan: ignore
  assert.equal(spec.Env.some((value) => value === "CAPSULE_URL=http://linear-agent-runner:8788"), true);
  assert.equal(spec.Env.some((value) => value === "WORKBENCH_URL=http://linear-agent-runner:8788"), true);
  assert.equal(spec.Env.some((value) => value === "GH_CONFIG_DIR=/tool-profile/gh"), true);
  assert.equal(spec.HostConfig.Binds.some((value) => value === "/srv/linear-agent/tool-profile:/tool-profile:ro"), true);
  assert.equal(spec.HostConfig.Binds.some((value) => value === "/srv/linear-agent/memory:/memory"), true);
  assert.equal(spec.HostConfig.Binds.some((value) => value.endsWith(":/home/node/.pi/agent")), false);
  assert.equal(spec.HostConfig.Binds.some((value) => value.endsWith(":/app/state/pi-sessions")), false);
  assert.equal(spec.Env.some((value) => value === "PI_MEMORY_DIR=/memory"), true);
  assert.equal(spec.Env.some((value) => value === "XDG_CONFIG_HOME=/memory/.config"), true);
  assert.equal(spec.HostConfig.Binds.some((value) => value.includes("claude")), false);
});

test("reuses an idle warm task and withholds supervisor capabilities between turns", async () => {
  let runs = 0;
  let readinessChecks = 0;
  const stopped: string[] = [];
  const removed: string[] = [];
  const removedNetworks: string[] = [];
  const unused = async () => { throw new Error("unexpected engine call"); };
  const engine: ContainerEngine = {
    pull: unused,
    create: unused,
    start: unused,
    async stop(id) { stopped.push(id); },
    async remove(id) { removed.push(id); },
    listByLabel: unused,
    inspect: unused,
    logs: unused,
    createNetwork: unused,
    connectNetwork: unused,
    async removeNetwork(id) { removedNetworks.push(id); },
    listNetworksByLabel: unused,
  };
  const harness = new WorkbenchHarness(config(), engine);
  const token = "warm-task-token"; // yadm-secret-scan: ignore
  const active = {
    aborted: false,
    client: {
      async repositories() { readinessChecks += 1; return []; },
      async run() {
        runs += 1;
        return { ok: true, timedOut: false, awaitingInput: false, summary: "Done.", elapsedMs: 1 };
      },
    },
    containerId: "warm-task",
    idleTimer: undefined,
    capsuleRequestId: undefined,
    lastUsedAt: Date.now(),
    networkId: "warm-network",
    networkName: "warm-network",
    running: false,
    sessionId: "session",
    sessionKey: "session-key",
    services: new Map(),
    token,
  };
  const internals = harness as unknown as {
    active: Map<string, unknown>;
    prepareSession: () => Promise<void>;
  };
  internals.active.set("session", active);
  internals.prepareSession = async () => {};

  await assert.rejects(harness.manageService(token, { action: "status", service: "browser" }), /Unauthorized/);
  const result = await harness.run({ agentSession: { id: "session" } }, async () => {});
  assert.equal(result.ok, true);
  assert.equal(readinessChecks, 1);
  assert.equal(runs, 1);
  assert.equal(internals.active.get("session"), active);
  assert.equal(active.running, false);
  assert.deepEqual(stopped, []);

  assert.equal(await harness.abort("session"), true);
  assert.deepEqual(stopped, ["warm-task"]);
  assert.deepEqual(removed, ["warm-task"]);
  assert.deepEqual(removedNetworks, ["warm-network"]);
});

test("forwards a running task to the Claude capsule without mounting its identity", async () => {
  let request: unknown;
  const progress: unknown[] = [];
  const unused = async () => { throw new Error("unexpected engine call"); };
  const engine: ContainerEngine = {
    pull: unused,
    create: unused,
    start: unused,
    stop: unused,
    remove: unused,
    listByLabel: unused,
    inspect: unused,
    logs: unused,
    createNetwork: unused,
    connectNetwork: unused,
    removeNetwork: unused,
    listNetworksByLabel: unused,
  };
  const capsule = {
    async runAgent(input: unknown, _signal?: AbortSignal, onProgress?: (event: { type: "thought"; body: string }) => void) {
      request = input;
      onProgress?.({ type: "thought", body: "Reading the repository." });
      return { status: "ok" as const, answer: "Ready for QA.", sessionId: "claude-1", awaitingInput: true, durationMs: 4, disposition: { status: "awaiting_qa" as const, reason: "Checked and ready for approval." } };
    },
    async pushInput() { throw new Error("unused"); },
  };
  const harness = new WorkbenchHarness(config(), engine, capsule);
  const active = {
    aborted: false,
    client: {},
    containerId: "task-id",
    containerName: "linear-agent-task-abc123",
    idleTimer: undefined,
    capsuleRequestId: undefined,
    lastUsedAt: Date.now(),
    networkId: "network-id",
    networkName: "network-name",
    running: true,
    sessionId: "session",
    sessionKey: "session-key",
    services: new Map(),
    token: "task-token",
  };
  const internals = harness as unknown as { active: Map<string, unknown> };
  internals.active.set("session", active);

  const result = await harness.runClaude(
    "task-token",
    { prompt: "Implement it", resume: "claude-0", timeBudgetMs: 3_600_000 },
    undefined,
    (event) => { progress.push(event); },
  ); // yadm-secret-scan: ignore
  assert.equal(result.status, "ok");
  assert.deepEqual(progress, [{ type: "thought", body: "Reading the repository." }]);
  const { requestId, ...requestWithoutId } = request as { requestId?: string };
  assert.equal(typeof requestId, "string");
  assert.ok((requestId as string).length > 0);
  assert.deepEqual(requestWithoutId, {
    prompt: "Implement it",
    taskUrl: "http://linear-agent-task-abc123:8788",
    workbenchUrl: "http://linear-agent-runner:8788",
    taskToken: "task-token", // yadm-secret-scan: ignore
    capsuleAuthUrl: "https://straylight.example.ts.net/linear/capsule/auth",
    toolAuthUrl: "https://straylight.example.ts.net/linear/tools/auth",
    resume: "claude-0",
    timeBudgetMs: 3_600_000,
  });
  assert.equal((internals.active.get("session") as { capsuleRequestId?: string } | undefined)?.capsuleRequestId, undefined);
  assert.deepEqual(await harness.runClaude("wrong-token", { prompt: "Nope" }), { // yadm-secret-scan: ignore
    status: "error",
    message: "Unauthorized or unavailable task workspace.",
  });
});

test("formats a compact one-line cost receipt from SDK-reported usage", () => {
  const receipt = formatUsageReceipt({
    model: "sonnet",
    inputTokens: 12_345,
    outputTokens: 3_210,
    cacheReadInputTokens: 890,
    cacheCreationInputTokens: 0,
    sdkReportedCostUsd: 0.4231,
    modelTurns: 6,
    toolCallCount: 8,
    observed: { inputTokens: 12_345, outputTokens: 3_210, cacheReadInputTokens: 890, cacheCreationInputTokens: 0 },
  }, 252_000);
  assert.equal(receipt, "Turn cost: sonnet - 12,345 in / 3,210 out tokens (+890 cache-read) - ~$0.42 SDK-estimated (subscription-notional, not billed spend) - 4.2m - 8 tool calls.");

  const noCacheNoCost = formatUsageReceipt({
    model: "sonnet",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    sdkReportedCostUsd: undefined,
    modelTurns: 1,
    toolCallCount: 1,
    observed: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  }, 6_000);
  assert.equal(noCacheNoCost, "Turn cost: sonnet - 100 in / 50 out tokens - 0.1m - 1 tool call.");
});

function usageTestSetup(disposition: { status: "awaiting_qa" | "blocked_external"; reason: string; nextAction?: string }, awaitingInput: boolean) {
  const unused = async () => { throw new Error("unexpected engine call"); };
  const engine: ContainerEngine = {
    pull: unused, create: unused, start: unused, stop: unused, remove: unused,
    listByLabel: unused, inspect: unused, logs: unused, createNetwork: unused,
    connectNetwork: unused, removeNetwork: unused, listNetworksByLabel: unused,
  };
  const usage = {
    model: "sonnet",
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    sdkReportedCostUsd: 0.12,
    modelTurns: 2,
    toolCallCount: 3,
    observed: { inputTokens: 1_000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  };
  const capsule = {
    async runAgent() {
      return { status: "ok" as const, answer: "Done.", sessionId: "claude-1", awaitingInput, durationMs: 4, disposition, usage };
    },
    async pushInput() { throw new Error("unused"); },
  };
  const active = {
    aborted: false,
    client: {},
    containerId: "task-id",
    containerName: "linear-agent-task-abc123",
    idleTimer: undefined,
    capsuleRequestId: undefined,
    lastUsedAt: Date.now(),
    networkId: "network-id",
    networkName: "network-name",
    running: true,
    sessionId: "session",
    sessionKey: "session-key",
    services: new Map(),
    token: "task-token",
  };
  return { engine, capsule, active, usage };
}

test("skips the Linear cost receipt when the turn left a blocking Steering/QA attention open, to avoid burying its buttons", async () => {
  const { engine, capsule, active, usage } = usageTestSetup({ status: "awaiting_qa", reason: "Ready for approval." }, true);
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-usage-test-"));
  const harness = new WorkbenchHarness({ ...config(), dataDirectory }, engine, capsule);
  const internals = harness as unknown as { active: Map<string, unknown> };
  internals.active.set("session", active);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("must not be called while a blocking attention is open"); }) as unknown as typeof fetch;

  try {
    const result = await harness.runClaude("task-token", { prompt: "Implement it" }); // yadm-secret-scan: ignore
    assert.equal(result.status, "ok");

    const logged = (await fs.readFile(path.join(dataDirectory, "usage.jsonl"), "utf8")).trim();
    const row = JSON.parse(logged);
    assert.equal(row.sessionId, "session");
    assert.deepEqual(row.observed, usage.observed);

    assert.equal(fetchCalls, 0, "an open elicitation's buttons must not be buried by a later activity post");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

test("posts the Linear cost receipt once the turn ends without leaving a blocking attention open", async () => {
  const { engine, capsule, active } = usageTestSetup(
    { status: "blocked_external", reason: "Waiting on a third-party webhook.", nextAction: "Retry once the webhook fires." },
    false,
  );
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "straylight-usage-test-"));
  const harness = new WorkbenchHarness({ ...config(), dataDirectory }, engine, capsule);
  const internals = harness as unknown as { active: Map<string, unknown> };
  internals.active.set("session", active);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse((init?.body as string) ?? "{}") });
    return new Response(JSON.stringify({ ok: true, action: "activity" }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const result = await harness.runClaude("task-token", { prompt: "Implement it" }); // yadm-secret-scan: ignore
    assert.equal(result.status, "ok");

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://linear-agent-controller:8787/internal/linear-session");
    const body = calls[0]?.body as { sessionId: string; request: { action: string; content: { type: string; body: string } } };
    assert.equal(body.sessionId, "session");
    assert.equal(body.request.action, "activity");
    assert.equal(body.request.content.type, "thought");
    assert.match(body.request.content.body, /Turn cost: sonnet/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dataDirectory, { recursive: true, force: true });
  }
});

test("pushes a live signal into whichever capsule request is currently in flight for that task", async () => {
  const unused = async () => { throw new Error("unexpected engine call"); };
  const engine: ContainerEngine = {
    pull: unused, create: unused, start: unused, stop: unused, remove: unused,
    listByLabel: unused, inspect: unused, logs: unused, createNetwork: unused,
    connectNetwork: unused, removeNetwork: unused, listNetworksByLabel: unused,
  };
  const pushed: Array<{ requestId: string; content: string; shouldQuery?: boolean }> = [];
  const capsule = {
    async runAgent(): Promise<never> { throw new Error("unused"); },
    async pushInput(requestId: string, content: string, shouldQuery?: boolean) {
      pushed.push({ requestId, content, ...(shouldQuery !== undefined ? { shouldQuery } : {}) });
      return { accepted: true };
    },
  };
  const harness = new WorkbenchHarness(config(), engine, capsule);
  const active = {
    aborted: false,
    capsuleRequestId: "live-request-1",
    client: {},
    containerId: "task-id",
    containerName: "linear-agent-task-abc123",
    idleTimer: undefined,
    lastUsedAt: Date.now(),
    networkId: "network-id",
    networkName: "network-name",
    running: true,
    sessionId: "session",
    sessionKey: "session-key",
    services: new Map(),
    token: "task-token",
  };
  const internals = harness as unknown as { active: Map<string, unknown> };
  internals.active.set("session", active);

  assert.deepEqual(
    await harness.pushAgentInput("task-token", { content: "keep it silent" }), // yadm-secret-scan: ignore
    { accepted: true },
  );
  assert.deepEqual(pushed, [{ requestId: "live-request-1", content: "keep it silent" }]);

  assert.deepEqual(
    await harness.pushAgentInput("wrong-token", { content: "ignored" }), // yadm-secret-scan: ignore
    { accepted: false, reason: "not_running" },
  );

  active.capsuleRequestId = undefined as unknown as string;
  assert.deepEqual(
    await harness.pushAgentInput("task-token", { content: "no run in flight" }), // yadm-secret-scan: ignore
    { accepted: false, reason: "not_running" },
  );
  assert.equal(pushed.length, 1);
});

test("captures task exit diagnostics before removing a failed jail", async () => {
  const order: string[] = [];
  const unused = async () => { throw new Error("unexpected engine call"); };
  const engine: ContainerEngine = {
    pull: unused,
    create: unused,
    start: unused,
    async stop() { order.push("stop"); },
    async remove() { order.push("remove"); },
    listByLabel: unused,
    async inspect() {
      order.push("inspect");
      return { Id: "failed-task", State: { Status: "exited", ExitCode: 137, Error: "out of memory" } };
    },
    async logs() { order.push("logs"); return "runner was killed\n"; },
    createNetwork: unused,
    connectNetwork: unused,
    async removeNetwork() { order.push("remove-network"); },
    listNetworksByLabel: unused,
  };
  const harness = new WorkbenchHarness(config(), engine);
  const active = {
    aborted: false,
    client: {
      async repositories() { return []; },
      async run() { throw new Error("runner stream disconnected"); },
    },
    containerId: "failed-task",
    idleTimer: undefined,
    capsuleRequestId: undefined,
    lastUsedAt: Date.now(),
    networkId: "failed-network",
    networkName: "failed-network",
    running: false,
    sessionId: "session",
    sessionKey: "session-key",
    services: new Map(),
    token: "failed-task-token", // yadm-secret-scan: ignore
  };
  const internals = harness as unknown as {
    active: Map<string, unknown>;
    prepareSession: () => Promise<void>;
    lastTaskFailure?: Record<string, unknown>;
  };
  internals.active.set("session", active);
  internals.prepareSession = async () => {};

  await assert.rejects(harness.run({ agentSession: { id: "session" } }, async () => {}), /runner stream disconnected/);
  assert.ok(order.indexOf("inspect") < order.indexOf("remove"));
  assert.ok(order.indexOf("logs") < order.indexOf("remove"));
  assert.deepEqual(internals.lastTaskFailure, {
    at: internals.lastTaskFailure?.at,
    sessionId: "session",
    message: "runner stream disconnected",
    containerStatus: "exited",
    exitCode: 137,
    containerError: "out of memory",
  });
});

test("decodes multiplexed Docker logs without exposing frame headers", () => {
  const line = Buffer.from("postgres ready\n");
  const frame = Buffer.alloc(8 + line.length);
  frame[0] = 1;
  frame.writeUInt32BE(line.length, 4);
  line.copy(frame, 8);
  assert.equal(decodeDockerStream(frame), "postgres ready\n");
  assert.equal(decodeDockerStream(Buffer.from("plain log\n")), "plain log\n");
});

test("does not create a late service after its task request is cancelled", async () => {
  let pullStarted!: () => void;
  let finishPull!: () => void;
  const started = new Promise<void>((resolve) => { pullStarted = resolve; });
  const held = new Promise<void>((resolve) => { finishPull = resolve; });
  let creates = 0;
  const unused = async () => { throw new Error("unexpected engine call"); };
  const engine: ContainerEngine = {
    async pull() { pullStarted(); await held; },
    async create() { creates += 1; return "container"; },
    start: unused,
    stop: unused,
    remove: unused,
    listByLabel: unused,
    inspect: unused,
    logs: unused,
    createNetwork: unused,
    connectNetwork: unused,
    removeNetwork: unused,
    listNetworksByLabel: unused,
  };
  const harness = new WorkbenchHarness(config(), engine);
  const token = "one-time-task-token"; // yadm-secret-scan: ignore
  const active = {
    aborted: false,
    client: {},
    containerId: "task",
    lastUsedAt: Date.now(),
    networkId: "network",
    networkName: "network",
    running: true,
    sessionId: "session",
    sessionKey: "session-key",
    services: new Map(),
    token,
  };
  (harness as unknown as { active: Map<string, unknown> }).active.set("session", active);
  const controller = new AbortController();
  const request = harness.manageService(token, { action: "start", service: "postgres" }, controller.signal);
  await started;
  controller.abort();
  finishPull();
  await assert.rejects(request, /cancelled/);
  assert.equal(creates, 0);
});

test("starts the prebuilt browser image without a registry pull or runtime npx install", async () => {
  let pulls = 0;
  let created: Parameters<ContainerEngine["create"]>[1] | undefined;
  const unused = async () => { throw new Error("unexpected engine call"); };
  const engine: ContainerEngine = {
    async pull() { pulls += 1; },
    async create(_name, spec) { created = spec; return "browser-container"; },
    async start() {},
    stop: unused,
    remove: unused,
    listByLabel: unused,
    inspect: unused,
    logs: unused,
    createNetwork: unused,
    connectNetwork: unused,
    removeNetwork: unused,
    listNetworksByLabel: unused,
  };
  const harness = new WorkbenchHarness(config(), engine);
  const token = "one-time-browser-token"; // yadm-secret-scan: ignore
  (harness as unknown as { active: Map<string, unknown> }).active.set("session", {
    aborted: false,
    client: {},
    containerId: "task",
    lastUsedAt: Date.now(),
    networkId: "network",
    networkName: "network",
    running: true,
    sessionId: "session",
    sessionKey: "session-key",
    services: new Map(),
    token,
  });
  await harness.manageService(token, { action: "start", service: "browser" });
  assert.equal(pulls, 0);
  assert.equal(created?.Image, "linear-agent-browser:local");
  assert.deepEqual(created?.Cmd.slice(0, 2), ["node", "/opt/straylight-playwright/node_modules/playwright/cli.js"]);
  assert.equal(created?.Cmd.includes("npx"), false);
  assert.equal(Object.keys(created?.HostConfig.Tmpfs ?? {}).includes("/run/playwright"), false);
});

test("parses a GitHub pull request URL into owner/repo/number", () => {
  assert.deepEqual(parsePullRequestUrl("https://github.com/GitSquared/nemo/pull/42"), {
    owner: "GitSquared",
    repo: "nemo",
    number: 42,
  });
  assert.equal(parsePullRequestUrl("https://github.com/GitSquared/nemo/issues/42"), undefined);
  assert.equal(parsePullRequestUrl("not a url"), undefined);
});

test("summarizes gh pr checks --json output, distinguishing pass from fail", () => {
  const passing = JSON.stringify([
    { bucket: "pass", name: "build", workflow: "CI" },
    { bucket: "pass", name: "lint", workflow: "CI" },
  ]);
  assert.deepEqual(summarizePullRequestChecks(passing, 0), { conclusion: "success", body: "CI checks: 2 pass." });

  const failing = JSON.stringify([
    { bucket: "pass", name: "build", workflow: "CI" },
    { bucket: "fail", name: "typecheck", workflow: "CI" },
  ]);
  assert.deepEqual(summarizePullRequestChecks(failing, 1), {
    conclusion: "failure",
    body: "CI checks: 1 pass, 1 fail. Failed: typecheck.",
  });

  assert.deepEqual(summarizePullRequestChecks("", 0), { conclusion: "success", body: "All CI checks passed." });
  assert.deepEqual(summarizePullRequestChecks("not json", 1), {
    conclusion: "error",
    body: "Could not read this pull request's CI check results (gh exited 1).",
  });
});

test("watches a pull request's checks and reports the result back to the controller", async () => {
  const ghCalls: string[][] = [];
  const ghCommand = async (args: string[]) => {
    ghCalls.push(args);
    return { exitCode: 1, stdout: JSON.stringify([{ bucket: "fail", name: "typecheck", workflow: "CI" }]), stderr: "" };
  };
  const harness = new WorkbenchHarness(config(), undefined, undefined, ghCommand);
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse((init?.body as string) ?? "{}") });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const accepted = await harness.watchPullRequestChecks("session-1", "https://github.com/GitSquared/nemo/pull/42");
    assert.equal(accepted.accepted, true);
    // watchPullRequestChecks returns once the child is launched, not once it finishes -
    // wait for the fake gh command (and the fetch it triggers) to actually settle.
    for (let attempt = 0; attempt < 50 && calls.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(ghCalls, [["pr", "checks", "https://github.com/GitSquared/nemo/pull/42", "--watch", "--fail-fast", "--json", "bucket,name,link,workflow,state"]]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://linear-agent-controller:8787/internal/pull-request-checks");
    const body = calls[0]?.body as { sessionId: string; prUrl: string; conclusion: string; body: string };
    assert.equal(body.sessionId, "session-1");
    assert.equal(body.prUrl, "https://github.com/GitSquared/nemo/pull/42");
    assert.equal(body.conclusion, "failure");
    assert.match(body.body, /Failed: typecheck/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an aborted pull request watch never reports a stale result", async () => {
  let released: (() => void) | undefined;
  const ghCommand = async (_args: string[], options: { signal?: AbortSignal }) => {
    // Simulate a long-running watch: only resolve once the harness aborts it, exactly the
    // way a real gh child would be killed by the same AbortSignal.
    await new Promise<void>((resolve) => {
      released = resolve;
      options.signal?.addEventListener("abort", () => resolve());
    });
    throw new Error("aborted");
  };
  const harness = new WorkbenchHarness(config(), undefined, undefined, ghCommand);
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as unknown as typeof fetch;

  try {
    await harness.watchPullRequestChecks("session-1", "https://github.com/GitSquared/nemo/pull/42");
    await harness.abortPullRequestWatch("session-1");
    released?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(fetchCalls, 0, "an intentionally aborted watch must not report anything back");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetches and normalizes a pull request's reviews", async () => {
  const ghCommand = async (args: string[]) => {
    assert.deepEqual(args, ["api", "repos/GitSquared/nemo/pulls/42/reviews"]);
    return {
      exitCode: 0,
      stdout: JSON.stringify([
        { id: 1, user: { login: "gaby" }, state: "APPROVED", submitted_at: "2026-08-26T10:00:00Z", body: "Looks good." },
        { id: 2, state: "COMMENTED" }, // missing submitted_at - must be dropped, not crash
      ]),
      stderr: "",
    };
  };
  const harness = new WorkbenchHarness(config(), undefined, undefined, ghCommand);

  const { reviews } = await harness.checkPullRequestReviews("https://github.com/GitSquared/nemo/pull/42");

  assert.deepEqual(reviews, [
    { id: 1, author: "gaby", state: "APPROVED", submittedAt: "2026-08-26T10:00:00Z", body: "Looks good." },
  ]);
});
