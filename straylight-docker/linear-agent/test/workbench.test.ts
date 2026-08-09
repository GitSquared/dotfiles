import assert from "node:assert/strict";
import test from "node:test";
import type { WorkbenchConfig } from "../src/config.js";
import { decodeDockerStream, type ContainerEngine } from "../src/docker-engine.js";
import { parseRepositoryRemote, taskContainerSpec, WorkbenchHarness } from "../src/workbench.js";

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
    workspaceInstructions: "/workbench/AGENTS.md",
    piConfigSource: "/workbench/pi-config",
    toolProfileDirectory: "/tool-profile",
    memoryDirectory: "/memory",
    maxConcurrentTasks: 3,
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
  assert.notDeepEqual(spec.HostConfig.Binds, other.HostConfig.Binds);
  assert.equal(spec.Env.some((value) => value.startsWith("LINEAR_")), false);
  assert.equal(spec.Env.some((value) => value.startsWith("CAPSULE_CONTROL_")), false);
  assert.equal(spec.Env.some((value) => value === "PI_RUNNER_TOKEN=task-token"), true); // yadm-secret-scan: ignore
  assert.equal(spec.Env.some((value) => value === "CAPSULE_URL=http://linear-agent-runner:8788"), true);
  assert.equal(spec.Env.some((value) => value === "WORKBENCH_URL=http://linear-agent-runner:8788"), true);
  assert.equal(spec.Env.some((value) => value === "GH_CONFIG_DIR=/tool-profile/gh"), true);
  assert.equal(spec.HostConfig.Binds.some((value) => value === "/srv/linear-agent/tool-profile:/tool-profile:ro"), true);
  assert.equal(spec.HostConfig.Binds.some((value) => value === "/srv/linear-agent/memory:/memory"), true);
  assert.equal(spec.Env.some((value) => value === "PI_MEMORY_DIR=/memory"), true);
  assert.equal(spec.HostConfig.Binds.some((value) => value.includes("claude")), false);
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
    networkId: "network",
    networkName: "network",
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
    networkId: "network",
    networkName: "network",
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
