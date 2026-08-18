export type AttentionKind = "steering" | "qa";
export type AttentionDelivery = "interrupt" | "queue";
export type AttentionPriority = "urgent" | "high" | "medium" | "low" | "none";

export type AttentionOption = {
  label: string;
  value: string;
  tradeoff?: string;
};

export type AttentionEvidence = {
  label: string;
  url: string;
  description?: string;
};

export type AttentionRequest = {
  kind: AttentionKind;
  delivery: AttentionDelivery;
  priority?: AttentionPriority;
  blocking?: boolean;
  title: string;
  action: string;
  originalIntent: string;
  delta: string;
  recommendation: string;
  impact: string;
  timing: string;
  options?: AttentionOption[];
  evidence?: AttentionEvidence[];
};

export type ActiveAttention = {
  kind: AttentionKind;
  delivery: AttentionDelivery;
  priority: AttentionPriority;
  blocking: boolean;
  issueId: string;
  issueIdentifier?: string;
  issueUrl?: string;
  sessionId?: string;
  requestedAt: number;
};

const LINEAR_PRIORITY: Record<AttentionPriority, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

export function attentionPriority(request: AttentionRequest): AttentionPriority {
  return request.priority ?? (request.delivery === "interrupt" ? "urgent" : "medium");
}

export function linearAttentionPriority(request: AttentionRequest): number {
  return LINEAR_PRIORITY[attentionPriority(request)];
}

export function attentionBlocking(request: AttentionRequest): boolean {
  return request.blocking ?? true;
}

function markdownText(value: string): string {
  return value.trim().replace(/\n{3,}/g, "\n\n");
}

function markdownLabel(value: string): string {
  return markdownText(value).replace(/[\[\]]/g, "");
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isAttentionRequest(value: unknown): value is AttentionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<AttentionRequest>;
  const bounded = (item: unknown, maximum: number): item is string => (
    typeof item === "string" && item.trim().length > 0 && item.length <= maximum
  );
  if (!(["steering", "qa"] as unknown[]).includes(request.kind)) return false;
  if (!(["interrupt", "queue"] as unknown[]).includes(request.delivery)) return false;
  if (!bounded(request.title, 160)
    || !bounded(request.action, 1_000)
    || !bounded(request.originalIntent, 2_000)
    || !bounded(request.delta, 2_000)
    || !bounded(request.recommendation, 1_000)
    || !bounded(request.impact, 1_000)
    || !bounded(request.timing, 500)) return false;
  if (request.priority !== undefined && !(["urgent", "high", "medium", "low", "none"] as unknown[]).includes(request.priority)) return false;
  if (request.blocking !== undefined && typeof request.blocking !== "boolean") return false;
  if (request.delivery === "interrupt" && (!attentionBlocking(request as AttentionRequest) || attentionPriority(request as AttentionRequest) !== "urgent")) return false;

  if (request.options !== undefined) {
    if (!Array.isArray(request.options) || request.options.length < 2 || request.options.length > 6) return false;
    const values = new Set<string>();
    for (const option of request.options) {
      if (!option || typeof option !== "object" || Array.isArray(option)) return false;
      if (!bounded(option.label, 200) || !bounded(option.value, 1_000)) return false;
      if (option.tradeoff !== undefined && !bounded(option.tradeoff, 500)) return false;
      if (values.has(option.value)) return false;
      values.add(option.value);
    }
  }

  if (request.evidence !== undefined) {
    if (!Array.isArray(request.evidence) || request.evidence.length < 1 || request.evidence.length > 8) return false;
    for (const evidence of request.evidence) {
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
      if (!bounded(evidence.label, 200) || !bounded(evidence.url, 2_000) || !isHttpsUrl(evidence.url)) return false;
      if (evidence.description !== undefined && !bounded(evidence.description, 500)) return false;
    }
  }

  return request.kind !== "qa" || Boolean(request.evidence?.length);
}

export function renderAttentionRequest(request: AttentionRequest): string {
  const heading = request.kind === "steering" ? "Steering" : "QA review";
  const delivery = request.delivery === "interrupt" ? "interrupt" : "queued";
  const response = attentionBlocking(request) ? "blocking input" : "acknowledgement";
  const sections = [
    `## ${heading} · ${delivery} · ${attentionPriority(request)} · ${response}: ${markdownText(request.title)}`,
    `**Your action**\n${markdownText(request.action)}`,
    `**Recommendation**\n${markdownText(request.recommendation)}`,
    `**Why this deserves attention**\n${markdownText(request.impact)}`,
    `**Timing**\n${markdownText(request.timing)}`,
    `**Original intent**\n${markdownText(request.originalIntent)}`,
    `**What changed**\n${markdownText(request.delta)}`,
  ];
  if (request.options?.length) {
    sections.push([
      "**Options**",
      ...request.options.map((option) => (
        `- **${markdownLabel(option.label)}** — ${markdownText(option.value)}`
        + (option.tradeoff ? `\n  ${markdownText(option.tradeoff)}` : "")
      )),
    ].join("\n"));
  }
  if (request.evidence?.length) {
    sections.push([
      "**Evidence**",
      ...request.evidence.map((evidence) => (
        `- [${markdownLabel(evidence.label)}](${evidence.url})`
        + (evidence.description ? ` — ${markdownText(evidence.description)}` : "")
      )),
    ].join("\n"));
  }
  return sections.join("\n\n");
}
