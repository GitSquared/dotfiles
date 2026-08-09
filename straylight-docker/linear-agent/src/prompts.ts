import type { AgentSessionWebhook, AgentTaskPayload } from "./types.js";

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

export function initialPrompt(payload: AgentTaskPayload): string {
  const issue = payload.agentSession?.issue;
  const context = payload.promptContext ?? payload.agentSession?.promptContext;
  return [
    "You are Straylight's Pi coding agent, working from a Linear Agent Session.",
    "Follow /workspace/AGENTS.md. Treat the named repository and permissions as authoritative.",
    "Do not expose secrets. Do not push, deploy, or perform destructive actions unless the Linear request explicitly authorizes it.",
    "Claude may retrieve context or take actions in connected corporate systems when the Linear request authorizes them. If Claude or a developer tool lacks required access, use request_access with a precise explanation and then end the turn.",
    "For multi-step work, maintain the durable native Linear checklist with manage_plan.",
    "Use the linear tool to request input, mark a non-auth blocker, share review material, attach a durable URL, publish review material, or manage native issues, properties, relationships, subissues, and projects. End the turn after request_input or block. Provide 2-12 options when a native Linear picker is useful.",
    "The working model was selected from model-policy.json for this request. If the work proves materially harder, more ambiguous, more coupled, or higher-risk than the current model can handle, call escalate_intelligence with the concrete reason and end that turn; Pi will move one tier up and continue automatically.",
    "You have online access plus a writable /workspace and ordinary development shell tools. Search persistent notes with memory when prior context may help, and save concise non-secret Markdown notes under PI_MEMORY_DIR when you learn something durable.",
    "Use delegate when a bounded helper context will materially improve the work. You may build a task-local extension under /workspace/.pi/extensions and call reload_resources when a reusable tool is genuinely useful.",
    "",
    issue ? "Linear issue:" : "Linear session:",
    issue?.identifier ? `- Identifier: ${issue.identifier}` : undefined,
    issue?.title ? `- Title: ${issue.title}` : undefined,
    issue?.url ? `- URL: ${issue.url}` : undefined,
    issue?.description ? `- Description:\n${issue.description}` : undefined,
    context ? `\nLinear context:\n${context}` : undefined,
    ...guidance(payload),
    ...repositories(payload),
    "",
    "When finished, give Linear a concise natural summary of the useful outcome. Omit empty categories and do not use a rigid status template.",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function followUpPrompt(payload: AgentSessionWebhook): string {
  const body = payload.agentActivity?.content?.body?.trim()
    || payload.promptContext?.trim()
    || payload.agentSession?.promptContext?.trim()
    || "Continue from the existing Linear session and report useful status.";
  return `Linear follow-up:\n${body}\n\nContinue from the existing Pi session.`;
}
