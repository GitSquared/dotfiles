export type AgentConfig = {
  linearClientId: string;
  linearClientSecret: string; // yadm-secret-scan: ignore
  linearWebhookSecret: string; // yadm-secret-scan: ignore
  installSecret: string; // yadm-secret-scan: ignore
  linearRedirectUri: string;
  baseUrl: string;
  host: string;
  port: number;
  stateDirectory: string;
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

function url(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error(`${name} must use https`);
  return parsed.toString().replace(/\/$/, "");
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv): AgentConfig {
  const installSecret = required(env, "LINEAR_AGENT_INSTALL_SECRET"); // yadm-secret-scan: ignore
  if (installSecret.length < 32) throw new Error("LINEAR_AGENT_INSTALL_SECRET must contain at least 32 characters");

  return {
    linearClientId: required(env, "LINEAR_CLIENT_ID"),
    linearClientSecret: required(env, "LINEAR_CLIENT_SECRET"), // yadm-secret-scan: ignore
    linearWebhookSecret: required(env, "LINEAR_WEBHOOK_SECRET"), // yadm-secret-scan: ignore
    installSecret,
    linearRedirectUri: url(env, "LINEAR_REDIRECT_URI"),
    baseUrl: url(env, "LINEAR_AGENT_PUBLIC_URL"),
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env, "PORT", 8787),
    stateDirectory: env.LINEAR_AGENT_STATE_DIR?.trim() || "/app/state",
    piWorkdir: env.PI_WORKDIR?.trim() || "/workspace",
    piSessionDirectory: env.PI_SESSION_DIR?.trim() || "/app/state/pi-sessions",
    piConfigDirectory: env.PI_CODING_AGENT_DIR?.trim() || "/home/node/.pi/agent",
    piTheme: env.PI_THEME?.trim() || "light",
    piTimeoutMs: positiveInteger(env, "PI_TIMEOUT_MS", 1_800_000),
    progressDebounceMs: positiveInteger(env, "PI_PROGRESS_DEBOUNCE_MS", 3_000),
    progressHeartbeatMs: positiveInteger(env, "PI_PROGRESS_HEARTBEAT_MS", 300_000),
  };
}

export function publicConfig(config: AgentConfig) {
  return {
    baseUrl: config.baseUrl,
    redirectUri: config.linearRedirectUri,
    host: config.host,
    port: config.port,
    stateDirectory: config.stateDirectory,
    piWorkdir: config.piWorkdir,
    piSessionDirectory: config.piSessionDirectory,
    piConfigDirectory: config.piConfigDirectory,
    piTheme: config.piTheme,
    piTimeoutMs: config.piTimeoutMs,
    progressDebounceMs: config.progressDebounceMs,
    progressHeartbeatMs: config.progressHeartbeatMs,
  };
}
