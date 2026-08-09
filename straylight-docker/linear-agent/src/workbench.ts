import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CapsuleClient } from "./capsule-client.js";
import type { WorkbenchConfig } from "./config.js";
import { DockerEngine, type ContainerEngine, type DockerContainerSpec } from "./docker-engine.js";
import type { PiResult, RunRequest, RunnerEvent } from "./runner-protocol.js";
import { PiRunnerClient } from "./runner-client.js";
import { runCommand } from "./runtime.js";
import type { DevelopmentService, ServiceRequest, ServiceResult } from "./service-client.js";
import type { RepositoryCandidate } from "./types.js";

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
  networkId: string;
  networkName: string;
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
      "PI_THEME=light",
      "PI_PROGRESS_DEBOUNCE_MS=3000",
      "PI_PROGRESS_HEARTBEAT_MS=300000",
      "PI_TIMEOUT_MS=1800000",
      "CAPSULE_URL=http://linear-agent-runner:8788",
      `CAPSULE_AUTH_URL=${config.capsuleAuthUrl}`,
      `TOOL_AUTH_URL=${config.toolAuthUrl}`,
      "WORKBENCH_URL=http://linear-agent-runner:8788",
      `PI_MEMORY_DIR=${config.memoryDirectory}`,
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
        `${path.join(hostTaskRoot, "pi-sessions")}:/app/state/pi-sessions`,
        `${path.join(hostTaskRoot, "pi-config")}:/home/node/.pi/agent`,
        `${hostWorkspace}:/workspace`,
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
  private readonly capsule: CapsuleClient;
  private readonly active = new Map<string, ActiveTask>();
  private readonly starting = new Set<string>();
  private readonly cancelled = new Set<string>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly order: string[] = [];
  private runningSlots = 0;

  constructor(
    private readonly config: WorkbenchConfig,
    engine?: ContainerEngine,
  ) {
    this.engine = engine ?? new DockerEngine(config.dockerSocket);
    this.capsule = new CapsuleClient(config.capsuleUrl, config.capsuleControlToken);
  }

  async initialize(): Promise<void> {
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
      console.warn("removed orphaned Pi workbench resources", {
        taskContainers: orphans.length,
        serviceContainers: serviceOrphans.length,
        sessionNetworks: networks.length,
      });
    }
  }

  async health(): Promise<Record<string, unknown>> {
    const [containers, services, networks] = await Promise.all([
      this.engine.listByLabel(TASK_LABEL),
      this.engine.listByLabel(SERVICE_LABEL),
      this.engine.listNetworksByLabel(SESSION_NETWORK_LABEL),
    ]);
    return {
      mode: "disposable-session-jails",
      activeTasks: this.active.size,
      queuedTasks: this.waiters.size,
      taskContainers: containers.length,
      serviceContainers: services.length,
      sessionNetworks: networks.length,
      maxConcurrentTasks: this.config.maxConcurrentTasks,
    };
  }

  async run(payload: RunRequest["payload"], send: Sender): Promise<PiResult> {
    const sessionId = payload.agentSession?.id;
    if (!sessionId) throw new Error("agentSession.id is required");
    if (this.active.has(sessionId) || this.waiters.has(sessionId)) throw new Error("this Agent Session already has an active task jail");
    const startedAt = Date.now();
    if (this.runningSlots >= this.config.maxConcurrentTasks) {
      await send({
        type: "activity",
        content: { type: "thought", body: "This task is queued for the next isolated workbench slot." },
        ephemeral: true,
      });
    }
    if (!(await this.acquire(sessionId))) return stoppedResult(startedAt);
    this.starting.add(sessionId);

    let active: ActiveTask | undefined;
    let networkId: string | undefined;
    try {
      await send({
        type: "activity",
        content: {
          type: "action",
          action: "Preparing isolated workspace",
          parameter: payload.agentSession?.issue?.identifier ?? "Linear Agent Session",
        },
        ephemeral: true,
      });
      await this.prepareSession(sessionId, payload);
      if (this.cancelled.delete(sessionId)) return stoppedResult(startedAt);
      const token = crypto.randomBytes(32).toString("base64url"); // yadm-secret-scan: ignore
      const name = taskName(sessionId);
      const networkName = sessionNetworkName(sessionId);
      networkId = await this.engine.createNetwork(networkName, {
        "dev.straylight.linear-agent.session-network": "true",
        "dev.straylight.linear-agent.session": sessionId,
      });
      const containerId = await this.engine.create(name, taskContainerSpec(this.config, sessionId, token));
      await this.engine.connectNetwork(networkId, containerId, ["task"]);
      const client = new PiRunnerClient(`http://${name}:8788`, token);
      active = {
        aborted: false,
        client,
        containerId,
        networkId,
        networkName,
        sessionId,
        sessionKey: sessionKey(sessionId),
        services: new Map(),
        token,
      };
      this.starting.delete(sessionId);
      this.active.set(sessionId, active);
      if (this.cancelled.delete(sessionId)) {
        active.aborted = true;
        return stoppedResult(startedAt);
      }
      await this.engine.start(containerId);
      await this.waitUntilReady(client, active);
      const result = await client.run(payload, send);
      return active.aborted ? stoppedResult(startedAt) : result;
    } catch (error) {
      if (active?.aborted) return stoppedResult(startedAt);
      throw error;
    } finally {
      this.starting.delete(sessionId);
      this.cancelled.delete(sessionId);
      this.active.delete(sessionId);
      if (active) {
        await this.cleanupServices(active);
        await this.engine.stop(active.containerId).catch(() => undefined);
        await this.engine.remove(active.containerId).catch(() => undefined);
        await this.syncTaskAuth(sessionId).catch((error: unknown) => {
          console.warn("failed to retain refreshed Pi authentication", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
      if (networkId) await this.engine.removeNetwork(networkId).catch(() => undefined);
      this.release();
    }
  }

  async followUp(sessionId: string, prompt: string): Promise<boolean> {
    const active = this.active.get(sessionId);
    return active && !active.aborted ? active.client.followUp(sessionId, prompt) : false;
  }

  async abort(sessionId: string): Promise<boolean> {
    const waiting = this.waiters.get(sessionId);
    if (waiting) {
      this.waiters.delete(sessionId);
      const index = this.order.indexOf(sessionId);
      if (index >= 0) this.order.splice(index, 1);
      waiting.resolve(false);
      return true;
    }
    const active = this.active.get(sessionId);
    if (!active) {
      if (!this.starting.has(sessionId)) return false;
      this.cancelled.add(sessionId);
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
      const supplied = Buffer.from(token);
      const expected = Buffer.from(task.token);
      return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    });
    if (!allowed) return { status: "error" as const, message: "Unauthorized." };
    return this.capsule.ask(request, signal);
  }

  async manageService(token: string, request: ServiceRequest, signal?: AbortSignal): Promise<ServiceResult> { // yadm-secret-scan: ignore
    const active = this.taskForToken(token);
    if (!active || active.aborted) throw new Error("Unauthorized task service request");
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

  async repositories(): Promise<RepositoryCandidate[]> {
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(this.config.repositoryDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const candidates = await Promise.all(entries.filter((entry) => entry.isDirectory()).slice(0, 100).map(async (entry) => {
      const repositoryPath = path.join(this.config.repositoryDirectory, entry.name);
      try {
        const { stdout } = await runCommand("git", ["-C", repositoryPath, "config", "--get", "remote.origin.url"], {
          timeout: 5_000,
          maxBuffer: 1_000_000,
        });
        return parseRepositoryRemote(stdout.trim(), `/repositories/${entry.name}`);
      } catch {
        return undefined;
      }
    }));
    return candidates.filter((candidate): candidate is RepositoryCandidate => Boolean(candidate));
  }

  private taskForToken(token: string): ActiveTask | undefined { // yadm-secret-scan: ignore
    for (const task of this.active.values()) {
      const supplied = Buffer.from(token);
      const expected = Buffer.from(task.token);
      if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) return task;
    }
    return undefined;
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
    if (this.runningSlots < this.config.maxConcurrentTasks) {
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
    while (this.order.length) {
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
    await fs.mkdir(piSessions, { recursive: true, mode: 0o700 });
    await fs.mkdir(piConfig, { recursive: true, mode: 0o700 });
    await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(taskRoot, "session.json"), `${JSON.stringify({
      sessionId,
      issueId: payload.agentSession?.issueId ?? payload.agentSession?.issue?.id,
      issueIdentifier: payload.agentSession?.issue?.identifier,
      issueTitle: payload.agentSession?.issue?.title,
      issueUrl: payload.agentSession?.issue?.url,
      lastStartedAt: new Date().toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });
    await fs.cp(this.config.piConfigSource, piConfig, { recursive: true, force: false, errorOnExist: false });
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
    await fs.copyFile(this.config.workspaceInstructions, path.join(workspace, "AGENTS.md"));
    await fs.chmod(path.join(workspace, "AGENTS.md"), 0o600);
  }

  private async syncTaskAuth(sessionId: string): Promise<void> {
    const piConfig = path.join(this.config.dataDirectory, "tasks", sessionKey(sessionId), "pi-config");
    await this.copyNewerAuth(piConfig, this.config.piConfigSource);
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Pi auth.json is not a JSON object");
    await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, value, { mode: 0o600 });
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
  }

  private async waitUntilReady(client: PiRunnerClient, active: ActiveTask): Promise<void> {
    const deadline = Date.now() + this.config.taskStartupTimeoutMs;
    while (Date.now() < deadline) {
      if (active.aborted) throw new Error("Pi task was aborted during startup");
      try {
        await client.repositories();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error("Pi task jail did not become ready before its startup deadline");
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
