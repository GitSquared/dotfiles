import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkbenchConfig } from "./config.js";
import { DockerEngine, type ContainerEngine, type DockerContainerSpec } from "./docker-engine.js";
import type { PiResult, RunRequest, RunnerEvent } from "./runner-protocol.js";
import { PiRunnerClient } from "./runner-client.js";
import type { RepositoryCandidate } from "./types.js";

const execFileAsync = promisify(execFile);
const TASK_LABEL = "dev.straylight.linear-agent.task=true";

type Sender = (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>;
type ActiveTask = {
  aborted: boolean;
  client: PiRunnerClient;
  containerId: string;
};
type Waiter = { resolve: (acquired: boolean) => void };

function sessionKey(sessionId: string): string {
  return crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
}

function taskName(sessionId: string): string {
  const nonce = crypto.randomBytes(3).toString("hex");
  return `linear-agent-task-${sessionKey(sessionId).slice(0, 12)}-${nonce}`;
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
    Cmd: ["node", "dist/runner-index.js"],
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
  }

  async initialize(): Promise<void> {
    const orphans = await this.engine.listByLabel(TASK_LABEL);
    await Promise.all(orphans.map(async (container) => {
      await this.engine.stop(container.Id).catch(() => undefined);
      await this.engine.remove(container.Id).catch(() => undefined);
    }));
    if (orphans.length) console.warn("removed orphaned Pi task containers", { count: orphans.length });
  }

  async health(): Promise<Record<string, unknown>> {
    const containers = await this.engine.listByLabel(TASK_LABEL);
    return {
      mode: "disposable-session-jails",
      activeTasks: this.active.size,
      queuedTasks: this.waiters.size,
      taskContainers: containers.length,
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
      const containerId = await this.engine.create(name, taskContainerSpec(this.config, sessionId, token));
      const client = new PiRunnerClient(`http://${name}:8788`, token);
      active = { aborted: false, client, containerId };
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
        await this.engine.stop(active.containerId).catch(() => undefined);
        await this.engine.remove(active.containerId).catch(() => undefined);
        await this.syncTaskAuth(sessionId).catch((error: unknown) => {
          console.warn("failed to retain refreshed Pi authentication", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
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
    await this.engine.stop(active.containerId).catch(() => undefined);
    return true;
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
        const { stdout } = await execFileAsync("git", ["-C", repositoryPath, "config", "--get", "remote.origin.url"], { timeout: 5_000 });
        return parseRepositoryRemote(stdout.trim(), `/repositories/${entry.name}`);
      } catch {
        return undefined;
      }
    }));
    return candidates.filter((candidate): candidate is RepositoryCandidate => Boolean(candidate));
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
