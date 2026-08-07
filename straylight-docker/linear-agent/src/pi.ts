import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  createAgentSession,
  initTheme,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "./config.js";
import { ProgressReporter } from "./progress.js";
import { finalText } from "./redaction.js";
import type { AgentSessionWebhook } from "./types.js";

type ManagedSession = {
  session: AgentSession;
  unsubscribe: () => void;
  reporter: { current: ProgressReporter | undefined };
};

export type PiResult = {
  ok: boolean;
  timedOut: boolean;
  summary: string;
  elapsedMs: number;
};

function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const text = (part as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  }).join("\n");
}

function latestAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && typeof message === "object" && (message as { role?: unknown }).role === "assistant") {
      const text = messageText(message).trim();
      if (text) return text;
    }
  }
  return "";
}

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

export class PiHarness {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(private readonly config: AgentConfig) {
    initTheme(config.piTheme, false);
  }

  async run(payload: AgentSessionWebhook, sendProgress: (body: string) => Promise<void>): Promise<PiResult> {
    const sessionId = payload.agentSession?.id;
    if (!sessionId) throw new Error("agentSession.id is required");
    const startedAt = performance.now();
    const reporter = new ProgressReporter(sendProgress, this.config.progressDebounceMs, this.config.progressHeartbeatMs);
    const managed = await this.session(sessionId);
    managed.reporter.current = reporter;
    let output = "";
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    const capture = managed.session.subscribe((event) => {
      if (event.type === "agent_end") output = latestAssistantText(event.messages) || output;
      if (event.type === "turn_end") output = messageText(event.message).trim() || output;
    });

    try {
      reporter.start();
      const prompt = payload.action === "prompted" ? followUpPrompt(payload) : initialPrompt(payload);
      await Promise.race([
        managed.session.prompt(prompt),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(new Error("Pi run timed out"));
          }, this.config.piTimeoutMs);
          timeout.unref();
        }),
      ]);
      await reporter.flush();
      return {
        ok: true,
        timedOut: false,
        summary: finalText(output || "Pi completed without a textual summary."),
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      await reporter.flush();
      if (timedOut) await managed.session.abort().catch(() => undefined);
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        timedOut,
        summary: finalText([output, reason].filter(Boolean).join("\n\n")),
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      capture();
      reporter.stop();
      managed.reporter.current = undefined;
    }
  }

  async followUp(sessionId: string, prompt: string): Promise<boolean> {
    const managed = this.sessions.get(sessionId);
    if (!managed?.session.isStreaming) return false;
    await managed.session.followUp(prompt);
    return true;
  }

  async abort(sessionId: string): Promise<boolean> {
    const managed = this.sessions.get(sessionId);
    if (!managed?.session.isStreaming) return false;
    await managed.session.abort();
    return true;
  }

  private async session(sessionId: string): Promise<ManagedSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    await fs.mkdir(this.config.piSessionDirectory, { recursive: true, mode: 0o700 });
    const safeName = sessionId.replace(/[^A-Za-z0-9_.-]/g, "_");
    const sessionFile = path.join(this.config.piSessionDirectory, `${safeName}.jsonl`);
    const manager = SessionManager.open(sessionFile, this.config.piSessionDirectory, this.config.piWorkdir);
    const { session } = await createAgentSession({ cwd: this.config.piWorkdir, sessionManager: manager });
    const reporter: ManagedSession["reporter"] = { current: undefined };
    const unsubscribe = session.subscribe((event) => reporter.current?.handle(event));
    await session.bindExtensions({});
    const managed = { session, unsubscribe, reporter };
    this.sessions.set(sessionId, managed);
    return managed;
  }
}
