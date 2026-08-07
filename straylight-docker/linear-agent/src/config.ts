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
};

export type RunnerConfig = {
  host: string;
  port: number;
  piWorkdir: string;
  piSessionDirectory: string;
  piConfigDirectory: string;
  piTheme: string;
  piTimeoutMs: number;
  progressDebounceMs: number;
  progressHeartbeatMs: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Required environment variable is missing: ${name}`);
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

export function loadControllerConfig(env: NodeJS.ProcessEnv): ControllerConfig {
  const installSecret = required(env, "LINEAR_AGENT_INSTALL_SECRET"); // yadm-secret-scan: ignore
  if (installSecret.length < 32) throw new Error("LINEAR_AGENT_INSTALL_SECRET must contain at least 32 characters");

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
  };
}

export function loadRunnerConfig(env: NodeJS.ProcessEnv): RunnerConfig {
  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env, "PORT", 8788),
    piWorkdir: env.PI_WORKDIR?.trim() || "/workspace",
    piSessionDirectory: env.PI_SESSION_DIR?.trim() || "/app/state/pi-sessions",
    piConfigDirectory: env.PI_CODING_AGENT_DIR?.trim() || "/home/node/.pi/agent",
    piTheme: env.PI_THEME?.trim() || "light",
    piTimeoutMs: positiveInteger(env, "PI_TIMEOUT_MS", 1_800_000),
    progressDebounceMs: positiveInteger(env, "PI_PROGRESS_DEBOUNCE_MS", 3_000),
    progressHeartbeatMs: positiveInteger(env, "PI_PROGRESS_HEARTBEAT_MS", 300_000),
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
  };
}

export function publicRunnerConfig(config: RunnerConfig) {
  return { ...config };
}
