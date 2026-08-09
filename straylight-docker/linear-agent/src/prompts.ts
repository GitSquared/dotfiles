import type { AgentSessionWebhook, AgentTaskPayload } from "./types.js";

type PromptPayload = AgentSessionWebhook | AgentTaskPayload;

export function currentLinearRequest(payload: PromptPayload): string | undefined {
  const activity = payload.agentActivity?.content?.body?.trim();
  if (payload.action === "prompted" && activity) return activity;
  const documentMention = "linearDocumentReview" in payload
    ? payload.linearDocumentReview?.comment.body.trim()
    : undefined;
  const sourceComment = "linearSourceComment" in payload
    ? payload.linearSourceComment?.body.trim()
    : undefined;
  return sourceComment
    || documentMention
    || payload.agentSession?.comment?.body?.trim()
    || activity
    || payload.promptContext?.trim()
    || payload.agentSession?.promptContext?.trim()
    || payload.agentSession?.issue?.description?.trim()
    || payload.agentSession?.issue?.title?.trim();
}

export function modelSelectionPrompt(payload: PromptPayload): string {
  const issue = payload.agentSession?.issue;
  const request = currentLinearRequest(payload);
  const context = payload.promptContext?.trim() || payload.agentSession?.promptContext?.trim();
  return [
    request ? `Current request (authoritative):\n${request}` : undefined,
    issue?.identifier ? `Issue: ${issue.identifier}` : undefined,
    !request && issue?.title ? `Title: ${issue.title}` : undefined,
    !request && issue?.description ? `Issue description:\n${issue.description}` : undefined,
    !request && context ? `Session context:\n${context}` : undefined,
  ].filter((value): value is string => Boolean(value)).join("\n\n");
}

function guidance(payload: AgentSessionWebhook): string[] {
  const bodies = payload.guidance?.flatMap((item) => item.body?.trim() ? [item.body.trim()] : []) ?? [];
  return bodies.length ? ["", "Linear guidance:", ...bodies.map((body) => `- ${body}`)] : [];
}

function repositories(payload: AgentTaskPayload): string[] {
  const candidates = payload.workbench?.repositories ?? [];
  const suggestions = payload.workbench?.repositorySuggestions ?? [];
  if (!candidates.length) return [];
  const confidence = new Map(suggestions.map((suggestion) => [
    `${suggestion.hostname}/${suggestion.repositoryFullName}`,
    suggestion.confidence,
  ]));
  return [
    "",
    "Available read-only repository sources (clone the chosen repository into /workspace before editing):",
    ...candidates.map((candidate) => {
      const score = confidence.get(`${candidate.hostname}/${candidate.repositoryFullName}`);
      return `- ${candidate.hostname}/${candidate.repositoryFullName}: ${candidate.path ?? "/repositories"}${score === undefined ? "" : ` (Linear confidence ${score})`}`;
    }),
  ];
}

function documentReview(payload: AgentTaskPayload): string[] {
  const review = payload.linearDocumentReview;
  if (!review) return [];
  const thread = review.thread.map((comment) => [
    `- Comment ${comment.id}${comment.user?.name ? ` by ${comment.user.name}` : ""}${comment.resolvedAt ? " [resolved]" : " [open]"}:`,
    comment.quotedText ? `  Quoted text: ${comment.quotedText}` : undefined,
    `  ${comment.body}`,
  ].filter(Boolean).join("\n"));
  return [
    "",
    "Document review context:",
    `- Document: ${review.document.title} (${review.document.id})`,
    `- URL: ${review.document.url}`,
    review.comment.quotedText ? `- Selected text for the current request: ${review.comment.quotedText}` : undefined,
    "- Current review thread:",
    ...thread,
    "",
    "Current Document Markdown:",
    review.document.content,
  ].filter((line): line is string => Boolean(line));
}

export function initialPrompt(payload: AgentTaskPayload): string {
  const issue = payload.agentSession?.issue;
  const request = currentLinearRequest(payload);
  const context = payload.promptContext?.trim() || payload.agentSession?.promptContext?.trim();
  return [
    "You are Straylight's Pi coding agent, working from a Linear Agent Session.",
    "Follow /workspace/AGENTS.md. Treat the named repository and permissions as authoritative.",
    "Do not expose secrets. Do not push, deploy, or perform destructive actions unless the Linear request explicitly authorizes it.",
    "Claude may retrieve context or take actions in connected corporate systems when the Linear request authorizes them. If Claude or a developer tool lacks required access, use request_access with a precise explanation and then end the turn.",
    "For multi-step work, maintain the durable native Linear checklist with manage_plan. Before closing a nonempty plan, reconcile every item with an explicit done, blocked, deferred, or abandoned disposition.",
    "Use the linear tool to request input, mark a non-auth blocker, share review material, attach a durable URL, publish review material, or manage native issues, properties, Documents, review comments, relationships, subissues, and projects. End the turn after request_input or block. Provide 2-12 options when a native Linear picker is useful.",
    "The working model was selected from model-policy.json for this request. If the work proves materially harder, more ambiguous, more coupled, or higher-risk than the current model can handle, call escalate_intelligence with the concrete reason and end that turn; Pi will move one tier up and continue automatically.",
    "You have online access plus a writable /workspace and ordinary development shell tools. Search persistent notes with memory when prior context may help, and save concise non-secret Markdown notes under PI_MEMORY_DIR when you learn something durable.",
    "Use delegate when a bounded helper context will materially improve the work. You may build a task-local extension under /workspace/.pi/extensions and call reload_resources when a reusable tool is genuinely useful.",
    "",
    request ? `Current Linear request (authoritative):\n${request}` : undefined,
    request ? "Treat the issue and session material below as supporting context. Do not let an older issue description override the current request." : undefined,
    "",
    issue ? "Linear issue:" : "Linear session:",
    issue?.identifier ? `- Identifier: ${issue.identifier}` : undefined,
    issue?.title ? `- Title: ${issue.title}` : undefined,
    issue?.url ? `- URL: ${issue.url}` : undefined,
    issue?.description ? `- Description:\n${issue.description}` : undefined,
    context && context !== request ? `\nSupporting Linear context:\n${context}` : undefined,
    ...documentReview(payload),
    ...guidance(payload),
    ...repositories(payload),
    "",
    "When finished, give Linear a concise natural summary of the useful outcome. Omit empty categories and do not use a rigid status template.",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function followUpPrompt(payload: AgentTaskPayload): string {
  const body = currentLinearRequest(payload)
    || "Continue from the existing Linear session and report useful status.";
  return [
    `Linear follow-up (authoritative):\n${body}`,
    ...documentReview(payload),
    "",
    "Continue from the existing Pi session.",
  ].join("\n");
}
