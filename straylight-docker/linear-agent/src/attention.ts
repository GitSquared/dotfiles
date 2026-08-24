export type AttentionKind = "signal" | "steering" | "qa";
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
};

export type AttentionAccessRepair = {
  url: string;
  providerName: string;
};

export type AttentionRequest = {
  kind: AttentionKind;
  delivery: AttentionDelivery;
  priority?: AttentionPriority;
  blocking?: boolean;
  title: string;
  action: string;
  recommendation: string;
  options?: AttentionOption[];
  evidence?: AttentionEvidence[];
  accessRepair?: AttentionAccessRepair;
};

export type ActiveAttention = {
  kind: "steering" | "qa";
  priority: AttentionPriority;
  previousStateId: string;
  requestedAt: number;
};

// A non-blocking, independently-trackable question (ROADMAP.md Slice 18's "ask" tier):
// unlike ActiveAttention, it never touches awaitingInput or issue status - several can be
// open at once because the underlying primitive (a comment thread) carries its own
// independent resolved/unresolved state, unlike Linear's single per-session status field.
export type OpenAsk = {
  commentId: string;
  question: string;
  askedAt: number;
};

export type DeferredItemRequest = {
  title: string;
  what: string;
  whyNotNow: string;
  resurface: string;
};

export const QA_APPROVE_VALUE = "Approve and complete the parent work.";
export const QA_REVISE_VALUE = "Not approved; resume the parent work.";

const QA_OPTIONS: AttentionOption[] = [
  { label: "Approve and complete", value: QA_APPROVE_VALUE },
  { label: "Not approved", value: QA_REVISE_VALUE, tradeoff: "Reply with concrete changes instead when possible." },
];

export function attentionPriority(request: AttentionRequest): AttentionPriority {
  return request.priority ?? (request.delivery === "interrupt" ? "urgent" : "medium");
}

export function attentionBlocking(request: AttentionRequest): boolean {
  return request.kind !== "signal";
}

export function attentionOptions(request: AttentionRequest): AttentionOption[] | undefined {
  return request.kind === "qa" ? QA_OPTIONS : request.options;
}

// Matched against an exact, normalized set - never a substring - because QA_REVISE_VALUE
// itself contains the word "approved" ("Not approved; resume the parent work."). The set
// must include the literal word renderAttentionComment's QA instruction tells the human to
// type ("Reply **approve** to complete"), not just the canonical button value: Linear's own
// docs say a select elicitation's free-text reply may be natural language, not necessarily
// the option's exact value.
const QA_APPROVAL_REPLIES = new Set(["approve", "approved", QA_APPROVE_VALUE.toLowerCase()]);

export function isQaApproval(value: string): boolean {
  return QA_APPROVAL_REPLIES.has(value.trim().toLowerCase());
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
  if (!(["signal", "steering", "qa"] as unknown[]).includes(request.kind)) return false;
  if (!(["interrupt", "queue"] as unknown[]).includes(request.delivery)) return false;
  if (!bounded(request.title, 160)
    || !bounded(request.action, 1_000)
    || !bounded(request.recommendation, 1_000)) return false;
  if (request.priority !== undefined && !(["urgent", "high", "medium", "low", "none"] as unknown[]).includes(request.priority)) return false;
  if (request.blocking !== undefined && request.blocking !== attentionBlocking(request as AttentionRequest)) return false;
  if (request.kind === "signal" && request.delivery !== "queue") return false;
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
    }
  }

  if (request.accessRepair !== undefined) {
    if (request.kind !== "steering") return false;
    if (!request.accessRepair || typeof request.accessRepair !== "object" || Array.isArray(request.accessRepair)) return false;
    const repair = request.accessRepair as Partial<AttentionAccessRepair>;
    if (!bounded(repair.providerName, 200) || !bounded(repair.url, 2_000) || !isHttpsUrl(repair.url)) return false;
  }

  if (request.kind === "qa" && request.options !== undefined) return false;
  return request.kind !== "qa" || Boolean(request.evidence?.length);
}

/**
 * The terse, same-issue render: a plain comment body for Signal, or the
 * elicitation Activity body for blocking Steering/QA. renderAttentionRequest
 * was written for a separate child issue with no shared context; on the same
 * issue - as a comment, or as the session's own prominent elicitation card -
 * restating original intent, what changed, and why it matters is pure noise
 * since the human already has the issue open. Keep only the decision itself.
 */
export function renderAttentionComment(request: AttentionRequest): string {
  const heading = request.kind === "qa" ? "QA needed" : request.kind === "steering" ? "Steering needed" : "Update";
  const lines = [
    `**${heading}:** ${markdownText(request.title)}`,
    markdownText(request.action),
  ];
  if (request.kind !== "signal" && request.recommendation) {
    lines.push(`*Recommendation:* ${markdownText(request.recommendation)}`);
  }
  if (request.accessRepair) {
    lines.push(`- [${markdownLabel(request.accessRepair.providerName)}](${request.accessRepair.url})`);
  }
  const options = attentionOptions(request);
  if (request.kind === "steering" && options?.length) {
    lines.push(options.map((option) => `- **${markdownLabel(option.label)}** — ${markdownText(option.value)}`).join("\n"));
  }
  if (request.evidence?.length) {
    lines.push(request.evidence.map((evidence) => `- [${markdownLabel(evidence.label)}](${evidence.url})`).join("\n"));
  }
  if (request.kind === "qa") {
    lines.push("Reply **approve** to complete, or reply with changes needed.");
  } else if (request.kind === "steering") {
    lines.push("Reply here to answer, or ask a follow-up.");
  }
  // Signal gets no footer: there's nothing actionable to instruct, and a hardcoded "no action
  // needed" line was pure filler that duplicated whatever Claude's own action text already said.
  return lines.join("\n\n");
}

export function isDeferredItemRequest(value: unknown): value is DeferredItemRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Partial<DeferredItemRequest>;
  const bounded = (item: unknown, maximum: number): item is string => (
    typeof item === "string" && item.trim().length > 0 && item.length <= maximum
  );
  return bounded(request.title, 160)
    && bounded(request.what, 1_000)
    && bounded(request.whyNotNow, 500)
    && bounded(request.resurface, 500);
}

export function renderDeferredItem(request: DeferredItemRequest): string {
  return [
    `## Deferred follow-up: ${markdownText(request.title)}`,
    `**What**\n${markdownText(request.what)}`,
    `**Why this isn't the current task's job**\n${markdownText(request.whyNotNow)}`,
    `**What re-surfaces it**\n${markdownText(request.resurface)}`,
  ].join("\n\n");
}
