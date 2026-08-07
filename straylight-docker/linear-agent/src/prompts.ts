import type { AgentSessionWebhook } from "./types.js";

function guidance(payload: AgentSessionWebhook): string[] {
  const bodies = payload.guidance?.flatMap((item) => item.body?.trim() ? [item.body.trim()] : []) ?? [];
  return bodies.length ? ["", "Linear guidance:", ...bodies.map((body) => `- ${body}`)] : [];
}

export function initialPrompt(payload: AgentSessionWebhook): string {
  const issue = payload.agentSession?.issue;
  const context = payload.promptContext ?? payload.agentSession?.promptContext;
  return [
    "You are Straylight's Pi coding agent, working from a Linear Agent Session.",
    "Follow /workspace/AGENTS.md. Treat the named repository and permissions as authoritative.",
    "Do not expose secrets. Do not push, deploy, or perform destructive actions unless the Linear request explicitly authorizes it.",
    "For multi-step work, maintain the native Linear checklist with update_linear_plan.",
    "If a missing user decision blocks safe progress, call ask_linear and then end the turn without adding a final response.",
    "",
    issue ? "Linear issue:" : "Linear session:",
    issue?.identifier ? `- Identifier: ${issue.identifier}` : undefined,
    issue?.title ? `- Title: ${issue.title}` : undefined,
    issue?.url ? `- URL: ${issue.url}` : undefined,
    issue?.description ? `- Description:\n${issue.description}` : undefined,
    context ? `\nLinear context:\n${context}` : undefined,
    ...guidance(payload),
    "",
    "When finished, summarize changes, checks, worktree/branch, and remaining decisions for Linear.",
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function followUpPrompt(payload: AgentSessionWebhook): string {
  const body = payload.agentActivity?.content?.body?.trim()
    || payload.promptContext?.trim()
    || payload.agentSession?.promptContext?.trim()
    || "Continue from the existing Linear session and report useful status.";
  return `Linear follow-up:\n${body}\n\nContinue from the existing Pi session.`;
}
