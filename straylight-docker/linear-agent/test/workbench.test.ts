import assert from "node:assert/strict";
import { test } from "bun:test";
import type { WorkbenchConfig } from "../src/config.js";
import { decodeDockerStream, type ContainerEngine } from "../src/docker-engine.js";
import { parseRepositoryRemote, repositoryCloneUrl, taskContainerSpec, WorkbenchHarness } from "../src/workbench.js";

function config(): WorkbenchConfig {
  return {
    runnerBackend: "claude",
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
    piConfigSource: "/workbench/pi-config",
    toolProfileDirectory: "/tool-profile",
    memoryDirectory: "/memory",
    maxWarmSessions: 3,
    warmSessionTtlMs: 600_000,
    taskStartupTimeoutMs: 30_000,
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
  assert.equal(spec.Env.some((value) => value === "PI_THEME=dark"), true);
  assert.equal(spec.Env.some((value) => value === "STRAYLIGHT_RUNNER=claude"), true);
  assert.equal(spec.HostConfig.Binds.some((value) => value.includes("claude")), false);

  const fallback = taskContainerSpec({ ...config(), runnerBackend: "pi" }, "session-c", "fallback-token"); // yadm-secret-scan: ignore
  assert.equal(fallback.HostConfig.Binds.some((value) => value.endsWith(":/home/node/.pi/agent")), true);
  assert.equal(fallback.HostConfig.Binds.some((value) => value.endsWith(":/app/state/pi-sessions")), true);
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
    syncTaskAuth: () => Promise<void>;
  };
  internals.active.set("session", active);
  internals.prepareSession = async () => {};
  internals.syncTaskAuth = async () => {};

  assert.deepEqual(await harness.askClaude(token, "idle request"), { status: "error", message: "Unauthorized." });
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
    async ask() { return { status: "error" as const, message: "unused" }; },
    async runAgent(input: unknown) {
      request = input;
      return { status: "ok" as const, answer: "Done.", sessionId: "claude-1", awaitingInput: false, durationMs: 4, disposition: { status: "completed" as const, reason: "Done." } };
    },
  };
  const harness = new WorkbenchHarness(config(), engine, capsule);
  const active = {
    aborted: false,
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

  const result = await harness.runClaude("task-token", { prompt: "Implement it", resume: "claude-0" }); // yadm-secret-scan: ignore
  assert.equal(result.status, "ok");
  assert.deepEqual(request, {
    prompt: "Implement it",
    taskUrl: "http://linear-agent-task-abc123:8788",
    workbenchUrl: "http://linear-agent-runner:8788",
    taskToken: "task-token", // yadm-secret-scan: ignore
    resume: "claude-0",
  });
  assert.deepEqual(await harness.runClaude("wrong-token", { prompt: "Nope" }), { // yadm-secret-scan: ignore
    status: "error",
    message: "Unauthorized or unavailable task workspace.",
  });
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
    syncTaskAuth: () => Promise<void>;
    lastTaskFailure?: Record<string, unknown>;
  };
  internals.active.set("session", active);
  internals.prepareSession = async () => {};
  internals.syncTaskAuth = async () => {};

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
