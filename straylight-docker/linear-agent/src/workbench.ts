import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CapsuleClient } from "./capsule-client.js";
import type { CapsuleAgentResult } from "./capsule-client.js";
import { AdaptiveSlots } from "./capacity.js";
import type { WorkbenchConfig } from "./config.js";
import { DockerEngine, type ContainerEngine, type DockerContainerSpec } from "./docker-engine.js";
import {
  isLinearManageRequest,
  isLinearSessionRequest,
  isLinearUploadRequest,
  type LinearManageRequest,
  type LinearManageResult,
  type LinearSessionRequest,
  type LinearSessionResult,
  type LinearUploadRequest,
} from "./linear-actions.js";
import { loadModelPolicy, publicModelPolicy } from "./model-policy.js";
import type { PiResult, RunRequest, RunnerEvent } from "./runner-protocol.js";
import { PiRunnerClient } from "./runner-client.js";
import { runCommand } from "./runtime.js";
import { redact } from "./redaction.js";
import type { DevelopmentService, ServiceRequest, ServiceResult } from "./service-client.js";
import type { LinearInputFile, RepositoryCandidate } from "./types.js";

const TASK_LABEL = "dev.straylight.linear-agent.task=true";
const SERVICE_LABEL = "dev.straylight.linear-agent.service=true";
const SESSION_NETWORK_LABEL = "dev.straylight.linear-agent.session-network=true";
const WEB_SEARCH_CONFIG: Record<string, unknown> = {
  provider: "exa",
  workflow: "none",
  autoOpenBrowser: false,
  webSearch: { enabled: true },
};

type Sender = (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>;
type ActiveTask = {
  aborted: boolean;
  client: PiRunnerClient;
  containerId: string;
  containerName?: string;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  lastUsedAt: number;
  networkId: string;
  networkName: string;
  running: boolean;
  sessionId: string;
  sessionKey: string;
  services: Map<DevelopmentService, ActiveService>;
  token: string; // yadm-secret-scan: ignore
};
type ActiveService = {
  connection: Record<string, string | number>;
  containerId: string;
  persistent: boolean;
};
type Waiter = { resolve: (acquired: boolean) => void };
type RepositorySource = {
  candidate: RepositoryCandidate;
  repositoryPath: string;
};

function sessionKey(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
}

function taskName(sessionId: string): string {
  const nonce = crypto.randomBytes(3).toString("hex");
  return `linear-agent-task-${sessionKey(sessionId).slice(0, 12)}-${nonce}`;
}

function sessionNetworkName(sessionId: string): string {
  return `linear-agent-session-${sessionKey(sessionId).slice(0, 12)}-${crypto.randomBytes(3).toString("hex")}`;
}

function serviceName(sessionId: string, service: DevelopmentService): string {
  return `linear-agent-${service}-${sessionKey(sessionId).slice(0, 12)}-${crypto.randomBytes(3).toString("hex")}`;
}

function stoppedResult(startedAt: number): PiResult {
  return {
    ok: false,
    timedOut: false,
    awaitingInput: false,
    summary: "Stopped by user.",
    elapsedMs: Date.now() - startedAt,
  };
}

export function taskContainerSpec(
  config: WorkbenchConfig,
  sessionId: string,
  token: string, // yadm-secret-scan: ignore
): DockerContainerSpec {
  const key = sessionKey(sessionId);
  const hostTaskRoot = path.join(config.hostRoot, "data", "tasks", key);
  const hostWorkspace = path.join(config.hostRoot, "workspace", "runs", key);
  const hostRepositories = path.join(config.hostRoot, "workspace", "repos");
  return {
    Image: config.taskImage,
    Cmd: ["bun", "/app/dist/runner-index.js"],
    Env: [
      "HOST=0.0.0.0",
      "PORT=8788",
      `PI_RUNNER_TOKEN=${token}`, // yadm-secret-scan: ignore
      "PI_WORKDIR=/workspace",
      "PI_SESSION_DIR=/app/state/pi-sessions",
      "PI_CODING_AGENT_DIR=/home/node/.pi/agent",
      "PI_THEME=dark",
      "PI_PROGRESS_DEBOUNCE_MS=3000",
      "PI_PROGRESS_HEARTBEAT_MS=300000",
      "PI_TIMEOUT_MS=1800000",
      `STRAYLIGHT_RUNNER=${config.runnerBackend}`,
      "CAPSULE_URL=http://linear-agent-runner:8788",
      `CAPSULE_AUTH_URL=${config.capsuleAuthUrl}`,
      `TOOL_AUTH_URL=${config.toolAuthUrl}`,
      "WORKBENCH_URL=http://linear-agent-runner:8788",
      `PI_MEMORY_DIR=${config.memoryDirectory}`,
      `XDG_CONFIG_HOME=${path.join(config.memoryDirectory, ".config")}`,
      "GH_CONFIG_DIR=/tool-profile/gh",
      "GIT_CONFIG_GLOBAL=/tool-profile/gitconfig",
      "GIT_TERMINAL_PROMPT=0",
    ],
    User: "node",
    WorkingDir: "/workspace",
    Labels: {
      "dev.straylight.linear-agent.task": "true",
      "dev.straylight.linear-agent.session": sessionId,
    },
    ExposedPorts: { "8788/tcp": {} },
    HostConfig: {
      AutoRemove: false,
      Binds: [
        ...(config.runnerBackend === "pi" ? [
          `${path.join(hostTaskRoot, "pi-sessions")}:/app/state/pi-sessions`,
          `${path.join(hostTaskRoot, "pi-config")}:/home/node/.pi/agent`,
        ] : []),
        `${hostWorkspace}:/workspace`,
        `${path.join(hostWorkspace, ".agent", "diagrams")}:/home/node/.agent/diagrams`,
        `${hostRepositories}:/repositories:ro`,
        `${path.join(config.hostRoot, "tool-profile")}:/tool-profile:ro`,
        `${path.join(config.hostRoot, "memory")}:${config.memoryDirectory}`,
      ],
      CapDrop: ["ALL"],
      Init: true,
      Memory: config.taskMemoryBytes,
      NanoCpus: config.taskNanoCpus,
      NetworkMode: config.taskNetwork,
      PidsLimit: config.taskPidsLimit,
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges:true"],
      Tmpfs: { "/tmp": "rw,nosuid,nodev,size=2147483648,mode=1777" },
    },
  };
}

export class WorkbenchHarness {
  private readonly engine: ContainerEngine;
  private readonly capsule: Pick<CapsuleClient, "ask" | "runAgent">;
  private readonly capacity: AdaptiveSlots;
  private readonly active = new Map<string, ActiveTask>();
  private readonly starting = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly repositoryRefreshes = new Map<string, Promise<void>>();
  private readonly order: string[] = [];
  private lastTaskFailure: Record<string, unknown> | undefined;
  private repositoryRefreshCount = 0;
  private repositoryRefreshFailureCount = 0;
  private lastRepositoryRefresh: Record<string, unknown> | undefined;
  private runningSlots = 0;

  constructor(
    private readonly config: WorkbenchConfig,
    engine?: ContainerEngine,
    capsule?: Pick<CapsuleClient, "ask" | "runAgent">,
  ) {
    this.engine = engine ?? new DockerEngine(config.dockerSocket);
    this.capsule = capsule ?? new CapsuleClient(config.capsuleUrl, config.capsuleControlToken);
    this.capacity = new AdaptiveSlots(
      () => this.runningSlots + this.waiters.size,
      () => this.drainQueue(),
    );
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.join(this.config.memoryDirectory, ".config"), { recursive: true, mode: 0o700 });
    const [orphans, serviceOrphans] = await Promise.all([
      this.engine.listByLabel(TASK_LABEL),
      this.engine.listByLabel(SERVICE_LABEL),
    ]);
    await Promise.all([...orphans, ...serviceOrphans].map(async (container) => {
      await this.engine.stop(container.Id).catch(() => undefined);
      await this.engine.remove(container.Id).catch(() => undefined);
    }));
    const networks = await this.engine.listNetworksByLabel(SESSION_NETWORK_LABEL);
    await Promise.all(networks.map((network) => this.engine.removeNetwork(network.Id).catch(() => undefined)));
    if (orphans.length || serviceOrphans.length || networks.length) {
      console.warn("removed orphaned agent workbench resources", {
        taskContainers: orphans.length,
        serviceContainers: serviceOrphans.length,
        sessionNetworks: networks.length,
      });
    }
    await this.capacity.start();
  }

  async health(): Promise<Record<string, unknown>> {
    const [containers, services, networks, modelPolicy] = await Promise.all([
      this.engine.listByLabel(TASK_LABEL),
      this.engine.listByLabel(SERVICE_LABEL),
      this.engine.listNetworksByLabel(SESSION_NETWORK_LABEL),
      this.config.runnerBackend === "pi" ? loadModelPolicy(this.config.piConfigSource) : Promise.resolve(undefined),
    ]);
    return {
      mode: "warm-session-jails",
      activeTasks: [...this.active.values()].filter((task) => task.running).length,
      warmTasks: [...this.active.values()].filter((task) => !task.running).length,
      queuedTasks: this.waiters.size,
      taskContainers: containers.length,
      serviceContainers: services.length,
      sessionNetworks: networks.length,
      runnerBackend: this.config.runnerBackend,
      adaptiveConcurrency: this.capacity.status(),
      ...(this.lastTaskFailure ? { lastTaskFailure: this.lastTaskFailure } : {}),
      repositoryCache: {
        refreshTtlMs: this.config.repositoryRefreshTtlMs,
        refreshes: this.repositoryRefreshCount,
        failures: this.repositoryRefreshFailureCount,
        ...(this.lastRepositoryRefresh ? { last: this.lastRepositoryRefresh } : {}),
      },
      ...(modelPolicy ? { modelPolicy: publicModelPolicy(modelPolicy) } : {}),
      rtkVersion: process.env.RTK_VERSION ?? "unknown",
      maxWarmSessions: this.config.maxWarmSessions,
      warmSessionTtlMs: this.config.warmSessionTtlMs,
    };
  }

  async run(payload: RunRequest["payload"], send: Sender): Promise<PiResult> {
    const sessionId = payload.agentSession?.id;
    if (!sessionId) throw new Error("agentSession.id is required");
    const warm = this.active.get(sessionId);
    if (warm?.running || this.waiters.has(sessionId) || this.starting.has(sessionId)) {
      throw new Error("this Agent Session already has an active task jail");
    }
    if (warm?.idleTimer) {
      clearTimeout(warm.idleTimer);
      warm.idleTimer = undefined;
    }
    const startedAt = Date.now();
    if (!this.capacity.available(this.runningSlots)) {
      await send({
        type: "activity",
        content: { type: "thought", body: "This task is queued for the next isolated workbench slot." },
        ephemeral: true,
      });
    }
    if (!(await this.acquire(sessionId))) {
      if (warm) await this.retainWarmTask(warm);
      return stoppedResult(startedAt);
    }

    let active = warm;
    let completed = false;
    try {
      if (active) {
        await send({
          type: "activity",
          content: {
            type: "action",
            action: "Resuming warm workspace",
            parameter: payload.agentSession?.issue?.identifier ?? "Linear Agent Session",
          },
          ephemeral: true,
        });
        try {
          await active.client.repositories();
        } catch {
          await this.disposeTask(active);
          active = undefined;
        }
      }
      if (!active) {
        this.starting.add(sessionId);
        await send({
          type: "activity",
          content: {
            type: "action",
            action: "Setting up workspace",
            parameter: payload.agentSession?.issue?.identifier ?? "Linear Agent Session",
          },
          ephemeral: true,
        });
        await this.prepareSession(sessionId, payload);
        if (this.cancelled.delete(sessionId)) return stoppedResult(startedAt);
        const token = crypto.randomBytes(32).toString("base64url"); // yadm-secret-scan: ignore
        const name = taskName(sessionId);
        const networkName = sessionNetworkName(sessionId);
        const networkId = await this.engine.createNetwork(networkName, {
          "dev.straylight.linear-agent.session-network": "true",
          "dev.straylight.linear-agent.session": sessionId,
        });
        let createdContainerId: string | undefined;
        try {
          const containerId = await this.engine.create(name, taskContainerSpec(this.config, sessionId, token));
          createdContainerId = containerId;
          await this.engine.connectNetwork(networkId, containerId, ["task"]);
          const client = new PiRunnerClient(`http://${name}:8788`, token);
          active = {
            aborted: false,
            client,
            containerId,
            containerName: name,
            idleTimer: undefined,
            lastUsedAt: Date.now(),
            networkId,
            networkName,
            running: false,
            sessionId,
            sessionKey: sessionKey(sessionId),
            services: new Map(),
            token,
          };
          this.active.set(sessionId, active);
          await this.engine.start(containerId);
          await this.waitUntilReady(client, active);
        } catch (error) {
          if (active) await this.disposeTask(active);
          else {
            if (createdContainerId) await this.engine.remove(createdContainerId).catch(() => undefined);
            await this.engine.removeNetwork(networkId).catch(() => undefined);
          }
          throw error;
        } finally {
          this.starting.delete(sessionId);
        }
      } else {
        await this.prepareSession(sessionId, payload);
      }
      active.aborted = false;
      active.running = true;
      if (this.cancelled.delete(sessionId)) {
        active.aborted = true;
        return stoppedResult(startedAt);
      }
      const result = await active.client.run(payload, send);
      completed = !active.aborted;
      return active.aborted ? stoppedResult(startedAt) : result;
    } catch (error) {
      if (active?.aborted) return stoppedResult(startedAt);
      if (active) await this.captureTaskFailure(active, error);
      throw error;
    } finally {
      this.starting.delete(sessionId);
      this.cancelled.delete(sessionId);
      if (active) {
        active.running = false;
        if (completed) await this.retainWarmTask(active);
        else await this.disposeTask(active);
      }
      this.release();
    }
  }

  async followUp(sessionId: string, prompt: string, inputs?: LinearInputFile[]): Promise<boolean> {
    const active = this.active.get(sessionId);
    return active?.running && !active.aborted ? active.client.followUp(sessionId, prompt, inputs) : false;
  }

  async abort(sessionId: string): Promise<boolean> {
    const waiting = this.waiters.get(sessionId);
    if (waiting) {
      this.waiters.delete(sessionId);
      const index = this.order.indexOf(sessionId);
      if (index >= 0) this.order.splice(index, 1);
      waiting.resolve(false);
      const warm = this.active.get(sessionId);
      if (warm && !warm.running) {
        warm.aborted = true;
        await this.disposeTask(warm);
      }
      return true;
    }
    const active = this.active.get(sessionId);
    if (!active) {
      if (!this.starting.has(sessionId)) return false;
      this.cancelled.add(sessionId);
      return true;
    }
    if (!active.running) {
      active.aborted = true;
      await this.disposeTask(active);
      return true;
    }
    active.aborted = true;
    await active.client.abort(sessionId).catch(() => false);
    await this.cleanupServices(active);
    await this.engine.stop(active.containerId).catch(() => undefined);
    return true;
  }

  async askClaude(token: string, request: string, signal?: AbortSignal) { // yadm-secret-scan: ignore
    const allowed = [...this.active.values()].some((task) => {
      if (!task.running || task.aborted) return false;
      const supplied = Buffer.from(token);
      const expected = Buffer.from(task.token);
      return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    });
    if (!allowed) return { status: "error" as const, message: "Unauthorized." };
    return this.capsule.ask(request, signal);
  }

  async runClaude(
    token: string, // yadm-secret-scan: ignore
    request: { prompt: string; resume?: string; model?: string },
    signal?: AbortSignal,
  ): Promise<CapsuleAgentResult> {
    const active = this.taskForToken(token);
    if (!active?.running || active.aborted || !active.containerName) {
      return { status: "error", message: "Unauthorized or unavailable task workspace." };
    }
    return this.capsule.runAgent({
      prompt: request.prompt,
      taskUrl: `http://${active.containerName}:8788`,
      workbenchUrl: "http://linear-agent-runner:8788",
      taskToken: token,
      ...(request.resume ? { resume: request.resume } : {}),
      ...(request.model ? { model: request.model } : {}),
    }, signal);
  }

  async manageService(token: string, request: ServiceRequest, signal?: AbortSignal): Promise<ServiceResult> { // yadm-secret-scan: ignore
    const active = this.taskForToken(token);
    if (!active?.running || active.aborted) throw new Error("Unauthorized task service request");
    if (signal?.aborted) throw new Error("Development service request was cancelled");
    if (!(["postgres", "browser"] as string[]).includes(request.service)) throw new Error("Unknown development service");
    if (!(["start", "status", "logs", "stop"] as string[]).includes(request.action)) throw new Error("Unknown development service action");
    if (request.action === "start") return this.startService(active, request.service, request.persistent === true, signal);
    if (request.action === "stop") return this.stopService(active, request.service);
    const service = active.services.get(request.service);
    if (!service) return { ok: true, service: request.service, status: "missing", message: "Service has not been started in this run." };
    if (request.action === "logs") {
      const logs = await this.engine.logs(service.containerId, request.tail);
      const status = await this.serviceStatus(service.containerId);
      return { ok: true, service: request.service, status, connection: service.connection, logs };
    }
    return {
      ok: true,
      service: request.service,
      status: await this.serviceStatus(service.containerId),
      connection: service.connection,
    };
  }

  async manageLinear(token: string, request: LinearManageRequest, signal?: AbortSignal): Promise<LinearManageResult> { // yadm-secret-scan: ignore
    const active = this.taskForToken(token);
    if (!active?.running || active.aborted) throw new Error("Unauthorized task Linear request");
    if (!isLinearManageRequest(request)) throw new Error("Invalid Linear operation");
    if (signal?.aborted) throw new Error("Linear operation was cancelled");
    const response = await fetch(`${this.config.controllerUrl}/internal/linear`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.authToken}`, "content-type": "application/json" },
      body: JSON.stringify({ sessionId: active.sessionId, request }),
      ...(signal ? { signal } : {}),
    });
    const payload = await response.json() as LinearManageResult | { ok?: false; message?: string };
    if (!response.ok || payload.ok !== true) {
      throw new Error("message" in payload && payload.message
        ? payload.message
        : `Linear controller rejected the request (HTTP ${response.status})`);
    }
    return payload;
  }

  async collaborateLinear(token: string, request: LinearSessionRequest, signal?: AbortSignal): Promise<LinearSessionResult> { // yadm-secret-scan: ignore
    const active = this.taskForToken(token);
    if (!active?.running || active.aborted) throw new Error("Unauthorized task Linear collaboration request");
    if (!isLinearSessionRequest(request)) throw new Error("Invalid Linear collaboration request");
    if (signal?.aborted) throw new Error("Linear collaboration was cancelled");
    const response = await fetch(`${this.config.controllerUrl}/internal/linear-session`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.authToken}`, "content-type": "application/json" },
      body: JSON.stringify({ sessionId: active.sessionId, request }),
      ...(signal ? { signal } : {}),
    });
    const payload = await response.json() as LinearSessionResult | { ok?: false; message?: string };
    if (!response.ok || payload.ok !== true) {
      throw new Error("message" in payload && payload.message
        ? payload.message
        : `Linear controller rejected the collaboration request (HTTP ${response.status})`);
    }
    return payload;
  }

  async uploadLinearFile(token: string, request: LinearUploadRequest, signal?: AbortSignal): Promise<string> { // yadm-secret-scan: ignore
    const active = this.taskForToken(token);
    if (!active?.running || active.aborted) throw new Error("Unauthorized task Linear upload request");
    if (!isLinearUploadRequest(request)) throw new Error("Invalid Linear upload request");
    if (signal?.aborted) throw new Error("Linear upload was cancelled");
    const response = await fetch(`${this.config.controllerUrl}/internal/linear-upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.authToken}`, "content-type": "application/json" },
      body: JSON.stringify({ sessionId: active.sessionId, request }),
      ...(signal ? { signal } : {}),
    });
    const payload = await response.json() as { ok?: boolean; assetUrl?: string; message?: string };
    if (!response.ok || payload.ok !== true || !payload.assetUrl) {
      throw new Error(payload.message || `Linear controller rejected the upload (HTTP ${response.status})`);
    }
    return payload.assetUrl;
  }

  async repositories(): Promise<RepositoryCandidate[]> {
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(this.config.repositoryDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const sources = await Promise.all(entries.filter((entry) => entry.isDirectory()).slice(0, 100).map(async (entry) => {
      const repositoryPath = path.join(this.config.repositoryDirectory, entry.name);
      try {
        const { stdout } = await runCommand("git", ["-C", repositoryPath, "config", "--get", "remote.origin.url"], {
          timeout: 5_000,
          maxBuffer: 1_000_000,
        });
        const candidate = parseRepositoryRemote(stdout.trim(), `/repositories/${entry.name}`);
        return candidate ? { candidate, repositoryPath } : undefined;
      } catch {
        return undefined;
      }
    }));
    const repositories = sources.filter((source): source is RepositorySource => Boolean(source));
    await Promise.all(repositories.map((source) => this.refreshRepository(source)));
    return repositories.map((source) => source.candidate);
  }

  private refreshRepository(source: RepositorySource): Promise<void> {
    const active = this.repositoryRefreshes.get(source.repositoryPath);
    if (active) return active;
    const refresh = this.refreshRepositoryNow(source).finally(() => {
      if (this.repositoryRefreshes.get(source.repositoryPath) === refresh) {
        this.repositoryRefreshes.delete(source.repositoryPath);
      }
    });
    this.repositoryRefreshes.set(source.repositoryPath, refresh);
    return refresh;
  }

  private async refreshRepositoryNow(source: RepositorySource): Promise<void> {
    const { stdout: fetchHeadOutput } = await runCommand("git", [
      "-C", source.repositoryPath,
      "rev-parse", "--path-format=absolute", "--git-path", "FETCH_HEAD",
    ], { timeout: 5_000, maxBuffer: 1_000_000 });
    const fetchHead = fetchHeadOutput.trim();
    const lastFetch = await fs.stat(fetchHead).catch(() => undefined);
    if (lastFetch && Date.now() - lastFetch.mtimeMs < this.config.repositoryRefreshTtlMs) return;
    const cloneUrl = repositoryCloneUrl(source.candidate);
    try {
      await runCommand("git", [
        "-C", source.repositoryPath,
        "fetch", "--prune", "--tags", "--quiet",
        cloneUrl,
        "+refs/heads/*:refs/remotes/origin/*",
      ], { timeout: 120_000, maxBuffer: 1_000_000 });
      this.repositoryRefreshCount += 1;
      this.lastRepositoryRefresh = {
        at: new Date().toISOString(),
        repository: `${source.candidate.hostname}/${source.candidate.repositoryFullName}`,
        ok: true,
      };
    } catch (error) {
      this.repositoryRefreshFailureCount += 1;
      const message = redact(error instanceof Error ? error.message : String(error)).slice(0, 1_000);
      this.lastRepositoryRefresh = {
        at: new Date().toISOString(),
        repository: `${source.candidate.hostname}/${source.candidate.repositoryFullName}`,
        ok: false,
        message,
      };
      console.warn("repository cache refresh failed; the last local snapshot remains available", {
        repository: `${source.candidate.hostname}/${source.candidate.repositoryFullName}`,
        message,
      });
    }
  }

  private taskForToken(token: string): ActiveTask | undefined { // yadm-secret-scan: ignore
    for (const task of this.active.values()) {
      const supplied = Buffer.from(token);
      const expected = Buffer.from(task.token);
      if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) return task;
    }
    return undefined;
  }

  private async retainWarmTask(active: ActiveTask): Promise<void> {
    if (this.active.get(active.sessionId) !== active || active.aborted) return;
    active.running = false;
    active.lastUsedAt = Date.now();
    await this.syncTaskAuth(active.sessionId).catch((error: unknown) => {
      console.warn("failed to retain refreshed Pi authentication", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    active.idleTimer = setTimeout(() => {
      if (this.active.get(active.sessionId) === active && !active.running && !this.waiters.has(active.sessionId)) {
        void this.disposeTask(active);
      }
    }, this.config.warmSessionTtlMs);
    active.idleTimer.unref?.();

    const idle = [...this.active.values()]
      .filter((task) => !task.running && !this.waiters.has(task.sessionId))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    const excess = idle.slice(0, Math.max(0, idle.length - this.config.maxWarmSessions));
    await Promise.all(excess.map((task) => this.disposeTask(task)));
  }

  private async disposeTask(active: ActiveTask): Promise<void> {
    if (active.idleTimer) clearTimeout(active.idleTimer);
    active.idleTimer = undefined;
    if (this.active.get(active.sessionId) === active) this.active.delete(active.sessionId);
    await this.cleanupServices(active);
    await this.engine.stop(active.containerId).catch(() => undefined);
    await this.engine.remove(active.containerId).catch(() => undefined);
    await this.engine.removeNetwork(active.networkId).catch(() => undefined);
    await this.syncTaskAuth(active.sessionId).catch((error: unknown) => {
      console.warn("failed to retain refreshed Pi authentication", {
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private async captureTaskFailure(active: ActiveTask, error: unknown): Promise<void> {
    const message = redact(error instanceof Error ? error.message : String(error));
    const [inspection, logs] = await Promise.all([
      this.engine.inspect(active.containerId).catch(() => undefined),
      this.engine.logs(active.containerId, 200).catch(() => ""),
    ]);
    const state = inspection?.State;
    this.lastTaskFailure = {
      at: new Date().toISOString(),
      sessionId: active.sessionId,
      message,
      ...(state?.Status ? { containerStatus: state.Status } : {}),
      ...(state?.ExitCode !== undefined ? { exitCode: state.ExitCode } : {}),
      ...(state?.Error ? { containerError: redact(state.Error) } : {}),
    };
    console.error("agent task failed before cleanup", {
      ...this.lastTaskFailure,
      ...(logs ? { taskLogs: redact(logs).slice(-8_000) } : {}),
    });
  }

  async shutdown(): Promise<void> {
    this.capacity.stop();
    for (const [sessionId, waiter] of this.waiters) {
      waiter.resolve(false);
      this.waiters.delete(sessionId);
    }
    this.order.length = 0;
    const tasks = [...this.active.values()];
    await Promise.all(tasks.map(async (task) => {
      task.aborted = true;
      if (task.running) await task.client.abort(task.sessionId).catch(() => false);
      await this.disposeTask(task);
    }));
  }

  private async startService(
    active: ActiveTask,
    service: DevelopmentService,
    persistent: boolean,
    signal?: AbortSignal,
  ): Promise<ServiceResult> {
    const assertActive = () => {
      if (signal?.aborted || active.aborted || this.active.get(active.sessionId) !== active) {
        throw new Error("Development service request was cancelled");
      }
    };
    assertActive();
    const existing = active.services.get(service);
    if (existing) {
      return {
        ok: true,
        service,
        status: await this.serviceStatus(existing.containerId),
        connection: existing.connection,
        message: "Service is already present in this run.",
      };
    }
    if (service === "browser" && persistent) throw new Error("The browser service is always disposable");
    const image = service === "postgres" ? this.config.postgresImage : this.config.browserImage;
    if (service === "postgres" || image !== "linear-agent-browser:local") await this.engine.pull(image);
    assertActive();
    const created = service === "postgres"
      ? await this.createPostgresService(active, persistent)
      : await this.createBrowserService(active);
    active.services.set(service, created);
    try {
      assertActive();
      await this.engine.start(created.containerId);
      assertActive();
    } catch (error) {
      active.services.delete(service);
      await this.engine.stop(created.containerId).catch(() => undefined);
      await this.engine.remove(created.containerId).catch(() => undefined);
      throw error;
    }
    return {
      ok: true,
      service,
      status: "starting",
      connection: created.connection,
      message: service === "postgres"
        ? "PostgreSQL is starting. Use status or logs until it reports healthy before running migrations."
        : "The Playwright server is starting. Match the project Playwright client to the server version.",
    };
  }

  private async createPostgresService(active: ActiveTask, persistent: boolean): Promise<ActiveService> {
    const credentials = await this.postgresCredentials(active, persistent);
    const binds: string[] = [];
    const tmpfs: Record<string, string> = {
      "/tmp": "rw,nosuid,nodev,size=268435456,mode=1777",
      "/var/run/postgresql": "rw,nosuid,nodev,size=16777216,uid=999,gid=999,mode=0770",
    };
    if (persistent) {
      const visibleData = path.join(this.config.workspaceRunsDirectory, active.sessionKey, ".services", "postgres", "data");
      await fs.mkdir(visibleData, { recursive: true, mode: 0o777 });
      await fs.chmod(visibleData, 0o777);
      const hostData = path.join(this.config.hostRoot, "workspace", "runs", active.sessionKey, ".services", "postgres", "data");
      binds.push(`${hostData}:/var/lib/postgresql/data`);
    } else {
      tmpfs["/var/lib/postgresql/data"] = "rw,nosuid,nodev,size=1073741824,uid=999,gid=999,mode=0700";
    }
    const name = serviceName(active.sessionId, "postgres");
    const containerId = await this.engine.create(name, {
      Image: this.config.postgresImage,
      Cmd: ["postgres"],
      Env: [
        "POSTGRES_DB=app",
        "POSTGRES_USER=agent",
        `POSTGRES_PASSWORD=${credentials.password}`,
        "PGDATA=/var/lib/postgresql/data",
      ],
      User: "postgres",
      Labels: {
        "dev.straylight.linear-agent.service": "true",
        "dev.straylight.linear-agent.service-kind": "postgres",
        "dev.straylight.linear-agent.session": active.sessionId,
      },
      ExposedPorts: { "5432/tcp": {} },
      Healthcheck: {
        Test: ["CMD-SHELL", "pg_isready -U agent -d app"],
        Interval: 2_000_000_000,
        Timeout: 2_000_000_000,
        Retries: 20,
        StartPeriod: 2_000_000_000,
      },
      HostConfig: {
        AutoRemove: false,
        Binds: binds,
        CapDrop: ["ALL"],
        Init: true,
        Memory: this.config.serviceMemoryBytes,
        NanoCpus: this.config.serviceNanoCpus,
        NetworkMode: active.networkName,
        PidsLimit: this.config.servicePidsLimit,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        Tmpfs: tmpfs,
      },
    });
    return {
      containerId,
      persistent,
      connection: {
        url: `postgresql://agent:${encodeURIComponent(credentials.password)}@${name}:5432/app`,
        host: name,
        port: 5432,
        database: "app",
        user: "agent",
        password: credentials.password,
      },
    };
  }

  private async createBrowserService(active: ActiveTask): Promise<ActiveService> {
    const name = serviceName(active.sessionId, "browser");
    const containerId = await this.engine.create(name, {
      Image: this.config.browserImage,
      Cmd: [
        "node",
        "/opt/straylight-playwright/node_modules/playwright/cli.js",
        "run-server",
        "--port",
        "3000",
        "--host",
        "0.0.0.0",
      ],
      Env: [
        "HOME=/home/pwuser",
        "PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
      ],
      User: "pwuser",
      WorkingDir: "/tmp",
      Labels: {
        "dev.straylight.linear-agent.service": "true",
        "dev.straylight.linear-agent.service-kind": "browser",
        "dev.straylight.linear-agent.session": active.sessionId,
      },
      ExposedPorts: { "3000/tcp": {} },
      HostConfig: {
        AutoRemove: false,
        Binds: [],
        CapDrop: ["ALL"],
        Init: true,
        Memory: this.config.serviceMemoryBytes,
        NanoCpus: this.config.serviceNanoCpus,
        NetworkMode: active.networkName,
        PidsLimit: this.config.servicePidsLimit,
        ReadonlyRootfs: true,
        SecurityOpt: ["no-new-privileges:true"],
        ShmSize: 1_073_741_824,
        Tmpfs: {
          "/tmp": "rw,nosuid,nodev,size=1073741824,mode=1777",
          "/home/pwuser/.cache": "rw,nosuid,nodev,size=536870912,uid=1001,gid=1001,mode=0700",
        },
      },
    });
    return {
      containerId,
      persistent: false,
      connection: {
        wsEndpoint: `ws://${name}:3000/`,
        version: this.config.browserVersion,
        taskHost: "task",
      },
    };
  }

  private async postgresCredentials(active: ActiveTask, persistent: boolean): Promise<{ password: string }> { // yadm-secret-scan: ignore
    if (!persistent) return { password: crypto.randomBytes(24).toString("base64url") }; // yadm-secret-scan: ignore
    const directory = path.join(this.config.workspaceRunsDirectory, active.sessionKey, ".services", "postgres");
    const filename = path.join(directory, "connection.json");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fs.readFile(filename, "utf8")) as { password?: unknown }; // yadm-secret-scan: ignore
      if (typeof parsed.password === "string" && parsed.password.length >= 24) return { password: parsed.password }; // yadm-secret-scan: ignore
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const value = { password: crypto.randomBytes(24).toString("base64url") }; // yadm-secret-scan: ignore
    await fs.writeFile(filename, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return value;
  }

  private async serviceStatus(containerId: string): Promise<ServiceResult["status"]> {
    const inspection = await this.engine.inspect(containerId);
    const health = inspection.State?.Health?.Status;
    if (health === "healthy") return "running";
    if (health === "unhealthy") return "failed";
    if (inspection.State?.Running) return health === "starting" ? "starting" : "running";
    return inspection.State?.ExitCode === 0 ? "stopped" : "failed";
  }

  private async stopService(active: ActiveTask, service: DevelopmentService): Promise<ServiceResult> {
    const current = active.services.get(service);
    if (!current) return { ok: true, service, status: "missing", message: "Service has not been started in this run." };
    active.services.delete(service);
    await this.engine.stop(current.containerId).catch(() => undefined);
    await this.engine.remove(current.containerId).catch(() => undefined);
    return { ok: true, service, status: "stopped", connection: current.connection };
  }

  private async cleanupServices(active: ActiveTask): Promise<void> {
    const services = [...active.services.values()];
    active.services.clear();
    await Promise.all(services.map(async (service) => {
      await this.engine.stop(service.containerId).catch(() => undefined);
      await this.engine.remove(service.containerId).catch(() => undefined);
    }));
  }

  private acquire(sessionId: string): Promise<boolean> {
    if (this.capacity.available(this.runningSlots)) {
      this.runningSlots += 1;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      this.waiters.set(sessionId, { resolve });
      this.order.push(sessionId);
    });
  }

  private release(): void {
    this.runningSlots = Math.max(0, this.runningSlots - 1);
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.order.length) {
      if (!this.capacity.available(this.runningSlots)) return;
      const sessionId = this.order.shift();
      if (!sessionId) return;
      const waiter = this.waiters.get(sessionId);
      if (!waiter) continue;
      this.waiters.delete(sessionId);
      this.runningSlots += 1;
      waiter.resolve(true);
      return;
    }
  }

  private async prepareSession(sessionId: string, payload: RunRequest["payload"]): Promise<void> {
    const key = sessionKey(sessionId);
    const taskRoot = path.join(this.config.dataDirectory, "tasks", key);
    const piConfig = path.join(taskRoot, "pi-config");
    const piSessions = path.join(taskRoot, "pi-sessions");
    const workspace = path.join(this.config.workspaceRunsDirectory, key);
    await fs.mkdir(taskRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.join(workspace, ".agent", "diagrams"), { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(taskRoot, "session.json"), `${JSON.stringify({
      sessionId,
      issueId: payload.agentSession?.issueId ?? payload.agentSession?.issue?.id,
      issueIdentifier: payload.agentSession?.issue?.identifier,
      issueTitle: payload.agentSession?.issue?.title,
      issueUrl: payload.agentSession?.issue?.url,
      lastStartedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    if (this.config.runnerBackend === "pi") {
      await fs.mkdir(piSessions, { recursive: true, mode: 0o700 });
      await fs.mkdir(piConfig, { recursive: true, mode: 0o700 });
      await fs.cp(this.config.piConfigSource, piConfig, { recursive: true, force: false, errorOnExist: false });
      await this.syncManagedPiConfig(piConfig);
      await this.copyNewerAuth(this.config.piConfigSource, piConfig);
      await this.prepareWebSearchConfig(piConfig);
      const legacyName = `${sessionId.replace(/[^A-Za-z0-9_.-]/g, "_")}.jsonl`;
      await fs.copyFile(
        path.join(this.config.dataDirectory, "pi-sessions", legacyName),
        path.join(piSessions, legacyName),
        fs.constants.COPYFILE_EXCL,
      ).catch((error: unknown) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "EEXIST") throw error;
      });
    }
    await fs.copyFile(this.config.workspaceInstructions, path.join(workspace, "AGENTS.md"));
    await fs.chmod(path.join(workspace, "AGENTS.md"), 0o600);
  }

  private async syncTaskAuth(sessionId: string): Promise<void> {
    if (this.config.runnerBackend !== "pi") return;
    const piConfig = path.join(this.config.dataDirectory, "tasks", sessionKey(sessionId), "pi-config");
    await this.copyNewerAuth(piConfig, this.config.piConfigSource);
  }

  private async syncManagedPiConfig(destination: string): Promise<void> {
    await fs.copyFile(
      path.join(this.config.piConfigSource, "model-policy.json"),
      path.join(destination, "model-policy.json"),
    );
    const extensions = path.join(destination, "extensions");
    await fs.mkdir(extensions, { recursive: true, mode: 0o700 });
    await fs.copyFile(
      path.join(this.config.piConfigSource, "extensions", "rtk.ts"),
      path.join(extensions, "rtk.ts"),
    );
  }

  private async prepareWebSearchConfig(piConfig: string): Promise<void> {
    const shared = path.join(this.config.toolProfileDirectory, "web-search.json");
    const destination = path.join(piConfig, "web-search.json");
    const config: Record<string, unknown> = structuredClone(WEB_SEARCH_CONFIG);
    try {
      const parsed = JSON.parse(await fs.readFile(shared, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Persistent web-search.json must contain a JSON object");
      const values = parsed as Record<string, unknown>;
      if (Object.keys(values).some((key) => key !== "exaApiKey")) {
        throw new Error("Persistent web-search.json supports only exaApiKey");
      }
      const exaApiKey = values.exaApiKey; // yadm-secret-scan: ignore
      if (typeof exaApiKey !== "string" || !exaApiKey.trim() || exaApiKey.length > 4_096) {
        throw new Error("Persistent web-search.json may contain one non-empty exaApiKey string");
      }
      config.exaApiKey = exaApiKey; // yadm-secret-scan: ignore
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.writeFile(destination, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(destination, 0o600);
  }

  private async copyNewerAuth(sourceDirectory: string, destinationDirectory: string): Promise<void> {
    const source = path.join(sourceDirectory, "auth.json");
    const destination = path.join(destinationDirectory, "auth.json");
    const sourceStat = await fs.stat(source);
    const destinationStat = await fs.stat(destination).catch(() => undefined);
    if (destinationStat && destinationStat.mtimeMs >= sourceStat.mtimeMs) return;
    const value = await fs.readFile(source, "utf8");
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Pi fallback auth.json is not a JSON object");
    await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, value, { mode: 0o600 });
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
  }

  private async waitUntilReady(client: PiRunnerClient, active: ActiveTask): Promise<void> {
    const deadline = Date.now() + this.config.taskStartupTimeoutMs;
    while (Date.now() < deadline) {
      if (active.aborted) throw new Error("Agent task was aborted during startup");
      try {
        await client.repositories();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error("Agent task jail did not become ready before its startup deadline");
  }
}

export function parseRepositoryRemote(remote: string, repositoryPath?: string): RepositoryCandidate | undefined {
  const scp = remote.match(/^[^@\s]+@([^:\s]+):(.+)$/);
  if (scp) {
    const hostname = scp[1];
    const remotePath = scp[2];
    if (!hostname || !remotePath) return undefined;
    const fullName = remotePath.replace(/^\/+|\.git$/g, "");
    return fullName.includes("/") ? { hostname, repositoryFullName: fullName, ...(repositoryPath ? { path: repositoryPath } : {}) } : undefined;
  }
  try {
    const url = new URL(remote);
    const fullName = url.pathname.replace(/^\/+|\.git$/g, "");
    return url.hostname && fullName.includes("/")
      ? { hostname: url.hostname, repositoryFullName: fullName, ...(repositoryPath ? { path: repositoryPath } : {}) }
      : undefined;
  } catch {
    return undefined;
  }
}

export function repositoryCloneUrl(repository: RepositoryCandidate): string {
  const hostname = repository.hostname.toLowerCase();
  const fullName = repository.repositoryFullName.replace(/^\/+|\.git$/g, "");
  if (!hostname || !fullName.includes("/")) throw new Error("Repository candidate is incomplete");
  return `https://${hostname}/${fullName}.git`;
}
