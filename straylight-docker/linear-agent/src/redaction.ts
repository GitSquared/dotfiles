const MAX_LINEAR_BODY = 8_000;
const MAX_PROGRESS_BODY = 240;

function sensitiveName(name: string): boolean {
  const normalized = name.replace(/[-_]/g, "").toLowerCase();
  return normalized === "key"
    || normalized.includes("apikey")
    || normalized.includes("password")
    || normalized.includes("secret")
    || normalized.includes("token")
    || normalized.includes("authorization");
}

function cleanUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = ""; // yadm-secret-scan: ignore
    for (const key of url.searchParams.keys()) {
      if (sensitiveName(key)) url.searchParams.set(key, "redacted");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function redact(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (match) => cleanUrl(match))
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [redacted]")
    .replace(/(?:github_pat_|ghp_)[A-Za-z0-9_]{16,}/g, "github_[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]")
    .replace(/(--(?:token|api-key|key|secret|password|auth)(?:\s+|=))\S+/gi, "$1[redacted]")
    .replace(/(\b[A-Z0-9_.-]{0,80}(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_.-]{0,80}\s*[=:]\s*)\S+/gi, "$1[redacted]");
}

export function progressText(value: string): string {
  const clean = redact(value).replace(/\s+/g, " ").trim();
  return clean.length <= MAX_PROGRESS_BODY ? clean : `${clean.slice(0, MAX_PROGRESS_BODY - 1)}…`;
}

export function finalText(value: string): string {
  const clean = redact(value).trim();
  return clean.length <= MAX_LINEAR_BODY ? clean : `${clean.slice(0, MAX_LINEAR_BODY - 21)}\n\n…output truncated…`;
}
