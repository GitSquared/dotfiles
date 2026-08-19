import fs from "node:fs";
import path from "node:path";

export type ControllerConfig = {
  linearClientId: string;
  linearClientSecret: string; // yadm-secret-scan: ignore
  linearWebhookSecret: string; // yadm-secret-scan: ignore
  installSecret: string; // yadm-secret-scan: ignore
  linearRedirectUri: string;
  baseUrl: string;
  host: string;
  port: number;
  stateDirectory: string;
  runnerUrl: string;
  runnerToken: string; // yadm-secret-scan: ignore
  attentionStateName: string;
};

export type RunnerConfig = {
  runnerBackend: "claude" | "pi";
  host: string;
  port: number;
  piWorkdir: string;
  piSessionDirectory: string;
  piConfigDirectory: string;
  memoryDirectory: string;
  piTheme: string;
  piTimeoutMs: number;
  progressDebounceMs: number;
  progressHeartbeatMs: number;
  authToken: string; // yadm-secret-scan: ignore
  capsuleUrl: string;
  workbenchUrl: string;
  capsuleAuthUrl: string;
  toolAuthUrl: string;
};

export type WorkbenchConfig = {
  runnerBackend: "claude" | "pi";
  host: string;
  port: number;
  authToken: string; // yadm-secret-scan: ignore
  dockerSocket: string;
  taskImage: string;
  taskNetwork: string;
  hostRoot: string;
  dataDirectory: string;
  workspaceRunsDirectory: string;
  repositoryDirectory: string;
  repositoryRefreshTtlMs: number;
  workspaceInstructions: string;
  piConfigSource: string;
  toolProfileDirectory: string;
  memoryDirectory: string;
  maxWarmSessions: number;
  warmSessionTtlMs: number;
  taskStartupTimeoutMs: number;
  taskMemoryBytes: number;
  taskNanoCpus: number;
  taskPidsLimit: number;
  postgresImage: string;
  browserImage: string;
  browserVersion: string;
  serviceMemoryBytes: number;
  serviceNanoCpus: number;
  servicePidsLimit: number;
  capsuleUrl: string;
  controllerUrl: string;
  capsuleAuthUrl: string;
  toolAuthUrl: string;
  capsuleControlToken: string; // yadm-secret-scan: ignore
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Required environment variable is missing: ${name}`);
  return value;
}

function secretFile(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const filename = absolutePath(env, name, fallback);
  const value = fs.readFileSync(filename, "utf8").trim();
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}

function httpsUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error(`${name} must use https`);
  return parsed.toString().replace(/\/$/, "");
}

function serviceUrl(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const parsed = new URL(env[name]?.trim() || fallback);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name); // yadm-secret-scan: ignore
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  return value;
}

function absolutePath(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name]?.trim() || fallback;
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return path.normalize(value);
}

function runnerBackend(env: NodeJS.ProcessEnv): "claude" | "pi" {
  const value = env.STRAYLIGHT_RUNNER?.trim().toLowerCase() || "claude";
  if (value !== "claude" && value !== "pi") throw new Error("STRAYLIGHT_RUNNER must be claude or pi");
  return value;
}

export function loadControllerConfig(env: NodeJS.ProcessEnv): ControllerConfig {
  const installSecret = secret(env, "LINEAR_AGENT_INSTALL_SECRET"); // yadm-secret-scan: ignore

  return {
    linearClientId: required(env, "LINEAR_CLIENT_ID"),
    linearClientSecret: required(env, "LINEAR_CLIENT_SECRET"), // yadm-secret-scan: ignore
    linearWebhookSecret: required(env, "LINEAR_WEBHOOK_SECRET"), // yadm-secret-scan: ignore
    installSecret,
    linearRedirectUri: httpsUrl(env, "LINEAR_REDIRECT_URI"),
    baseUrl: httpsUrl(env, "LINEAR_AGENT_PUBLIC_URL"),
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env, "PORT", 8787),
    stateDirectory: env.LINEAR_AGENT_STATE_DIR?.trim() || "/app/state",
    runnerUrl: serviceUrl(env, "PI_RUNNER_URL", "http://linear-agent-runner:8788"),
    runnerToken: secret(env, "PI_RUNNER_TOKEN"), // yadm-secret-scan: ignore
    attentionStateName: env.LINEAR_ATTENTION_STATE_NAME?.trim() || "In Review",
  };
}

export function loadRunnerConfig(env: NodeJS.ProcessEnv): RunnerConfig {
  return {
    runnerBackend: runnerBackend(env),
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env, "PORT", 8788),
    piWorkdir: env.PI_WORKDIR?.trim() || "/workspace",
    piSessionDirectory: env.PI_SESSION_DIR?.trim() || "/app/state/pi-sessions",
    piConfigDirectory: env.PI_CODING_AGENT_DIR?.trim() || "/home/node/.pi/agent",
    memoryDirectory: absolutePath(env, "PI_MEMORY_DIR", "/memory"),
    piTheme: env.PI_THEME?.trim() || "dark",
    piTimeoutMs: positiveInteger(env, "PI_TIMEOUT_MS", 3_600_000),
    progressDebounceMs: positiveInteger(env, "PI_PROGRESS_DEBOUNCE_MS", 3_000),
    progressHeartbeatMs: positiveInteger(env, "PI_PROGRESS_HEARTBEAT_MS", 60_000),
    authToken: secret(env, "PI_RUNNER_TOKEN"), // yadm-secret-scan: ignore
    capsuleUrl: serviceUrl(env, "CAPSULE_URL", "http://linear-agent-claude-capsule:8790"),
    workbenchUrl: serviceUrl(env, "WORKBENCH_URL", "http://linear-agent-runner:8788"),
    capsuleAuthUrl: httpsUrl(env, "CAPSULE_AUTH_URL"),
    toolAuthUrl: httpsUrl(env, "TOOL_AUTH_URL"),
  };
}

export function loadWorkbenchConfig(env: NodeJS.ProcessEnv): WorkbenchConfig {
  return {
    runnerBackend: runnerBackend(env),
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env, "PORT", 8788),
    authToken: secret(env, "PI_RUNNER_TOKEN"), // yadm-secret-scan: ignore
    dockerSocket: absolutePath(env, "PI_DOCKER_SOCKET", "/var/run/docker.sock"),
    taskImage: env.PI_TASK_IMAGE?.trim() || "linear-agent-runner:local",
    taskNetwork: env.PI_TASK_NETWORK?.trim() || "linear-agent-tasks",
    hostRoot: absolutePath(env, "PI_HOST_ROOT", "/home/gaby/straylight-docker/linear-agent"),
    dataDirectory: absolutePath(env, "PI_WORKBENCH_DATA_DIR", "/workbench/data"),
    workspaceRunsDirectory: absolutePath(env, "PI_WORKSPACE_RUNS_DIR", "/workbench/workspace-runs"),
    repositoryDirectory: absolutePath(env, "PI_REPOSITORY_DIR", "/repositories"),
    repositoryRefreshTtlMs: positiveInteger(env, "PI_REPOSITORY_REFRESH_TTL_MS", 300_000),
    workspaceInstructions: absolutePath(env, "PI_WORKSPACE_INSTRUCTIONS", "/workbench/AGENTS.md"),
    piConfigSource: absolutePath(env, "PI_CONFIG_SOURCE", "/workbench/pi-config"),
    toolProfileDirectory: absolutePath(env, "PI_TOOL_PROFILE_DIR", "/tool-profile"),
    memoryDirectory: absolutePath(env, "PI_MEMORY_DIR", "/memory"),
    maxWarmSessions: positiveInteger(env, "PI_MAX_WARM_SESSIONS", 3),
    warmSessionTtlMs: positiveInteger(env, "PI_WARM_SESSION_TTL_MS", 600_000),
    taskStartupTimeoutMs: positiveInteger(env, "PI_TASK_STARTUP_TIMEOUT_MS", 30_000),
    taskMemoryBytes: positiveInteger(env, "PI_TASK_MEMORY_BYTES", 4 * 1024 * 1024 * 1024),
    taskNanoCpus: positiveInteger(env, "PI_TASK_NANO_CPUS", 2_000_000_000),
    taskPidsLimit: positiveInteger(env, "PI_TASK_PIDS_LIMIT", 512),
    postgresImage: env.PI_POSTGRES_IMAGE?.trim() || "postgres:17.10-bookworm",
    browserImage: env.PI_BROWSER_IMAGE?.trim() || "linear-agent-browser:local",
    browserVersion: env.PI_BROWSER_VERSION?.trim() || "1.62.0",
    serviceMemoryBytes: positiveInteger(env, "PI_SERVICE_MEMORY_BYTES", 2 * 1024 * 1024 * 1024),
    serviceNanoCpus: positiveInteger(env, "PI_SERVICE_NANO_CPUS", 1_000_000_000),
    servicePidsLimit: positiveInteger(env, "PI_SERVICE_PIDS_LIMIT", 256),
    capsuleUrl: serviceUrl(env, "CAPSULE_URL", "http://linear-agent-claude-capsule:8790"),
    controllerUrl: serviceUrl(env, "LINEAR_CONTROLLER_URL", "http://linear-agent-controller:8787"),
    capsuleAuthUrl: httpsUrl(env, "CAPSULE_AUTH_URL"),
    toolAuthUrl: httpsUrl(env, "TOOL_AUTH_URL"),
    capsuleControlToken: secretFile(env, "CAPSULE_CONTROL_TOKEN_FILE", "/run/secrets/capsule-control-token"), // yadm-secret-scan: ignore
  };
}

export function publicControllerConfig(config: ControllerConfig) {
  return {
    baseUrl: config.baseUrl,
    redirectUri: config.linearRedirectUri,
    host: config.host,
    port: config.port,
    stateDirectory: config.stateDirectory,
    runnerUrl: config.runnerUrl,
    attentionStateName: config.attentionStateName,
  };
}

export function publicRunnerConfig(config: RunnerConfig) {
  const { authToken: _authToken, ...safe } = config; // yadm-secret-scan: ignore
  return safe;
}

export function publicWorkbenchConfig(config: WorkbenchConfig) {
  const { authToken: _authToken, capsuleControlToken: _capsuleControlToken, ...safe } = config; // yadm-secret-scan: ignore
  return safe;
}
