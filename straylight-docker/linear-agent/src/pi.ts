import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  createAgentSession,
  defineTool,
  initTheme,
  SessionManager,
  type ToolDefinition,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RunnerConfig } from "./config.js";
import { ProgressReporter } from "./progress.js";
import { followUpPrompt, initialPrompt } from "./prompts.js";
import { finalText } from "./redaction.js";
import type { PiResult, RunnerEvent } from "./runner-protocol.js";
import type { AgentTaskPayload } from "./types.js";

type ManagedSession = {
  session: AgentSession;
  unsubscribe: () => void;
  reporter: { current: ProgressReporter | undefined };
  runState: { current: { send: RunnerSender; awaitingInput: boolean } | undefined };
};

type RunnerSender = (event: Exclude<RunnerEvent, { type: "result" }>) => Promise<void>;

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

export class PiHarness {
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(private readonly config: RunnerConfig) {
    initTheme(config.piTheme, false);
  }

  async run(payload: AgentTaskPayload, send: RunnerSender): Promise<PiResult> {
    const sessionId = payload.agentSession?.id;
    if (!sessionId) throw new Error("agentSession.id is required");
    const startedAt = performance.now();
    const reporter = new ProgressReporter(send, this.config.progressDebounceMs, this.config.progressHeartbeatMs);
    const managed = await this.session(sessionId);
    managed.reporter.current = reporter;
    const runState = { send, awaitingInput: false };
    managed.runState.current = runState;
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
        awaitingInput: runState.awaitingInput,
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
        awaitingInput: false,
        summary: finalText([output, reason].filter(Boolean).join("\n\n")),
        elapsedMs: Math.round(performance.now() - startedAt),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      capture();
      reporter.stop();
      managed.reporter.current = undefined;
      managed.runState.current = undefined;
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
    const reporter: ManagedSession["reporter"] = { current: undefined };
    const runState: ManagedSession["runState"] = { current: undefined };
    const { session } = await createAgentSession({
      cwd: this.config.piWorkdir,
      agentDir: this.config.piConfigDirectory,
      sessionManager: manager,
      customTools: this.linearTools(runState, reporter),
    });
    const unsubscribe = session.subscribe((event) => reporter.current?.handle(event));
    await session.bindExtensions({});
    const managed = { session, unsubscribe, reporter, runState };
    this.sessions.set(sessionId, managed);
    return managed;
  }

  private linearTools(
    runState: ManagedSession["runState"],
    reporter: ManagedSession["reporter"],
  ): ToolDefinition[] {
    return [
      defineTool({
        name: "ask_linear",
        label: "Ask in Linear",
        description: "Ask the user a blocking clarification question in the native Linear Agent Session UI.",
        promptSnippet: "Ask the user for required input in Linear",
        promptGuidelines: ["Use ask_linear only when work cannot proceed safely without a user decision, then end the turn."],
        parameters: Type.Object({
          question: Type.String({ minLength: 1, maxLength: 4000 }),
          options: Type.Optional(Type.Array(Type.Object({
            label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
            value: Type.String({ minLength: 1, maxLength: 1000 }),
          }), { minItems: 2, maxItems: 12 })),
        }),
        async execute(_toolCallId, params) {
          const current = runState.current;
          if (!current) throw new Error("No active Linear run");
          await reporter.current?.flush();
          const options = params.options?.map((option) => ({
            ...(option.label ? { label: finalText(option.label).slice(0, 200) } : {}),
            value: finalText(option.value).slice(0, 1000),
          }));
          await current.send({
            type: "activity",
            content: { type: "elicitation", body: finalText(params.question) },
            ...(options ? { signal: "select" as const, signalMetadata: { options } } : {}),
          });
          current.awaitingInput = true;
          reporter.current?.stop();
          return { content: [{ type: "text", text: "Question sent to Linear. End this turn and wait for the user's follow-up." }], details: {} };
        },
      }),
      defineTool({
        name: "update_linear_plan",
        label: "Update Linear plan",
        description: "Replace the native Linear Agent Session checklist with the current execution plan and statuses.",
        promptSnippet: "Publish or update the task checklist in Linear",
        parameters: Type.Object({
          steps: Type.Array(Type.Object({
            content: Type.String({ minLength: 1, maxLength: 500 }),
            status: Type.Union([
              Type.Literal("pending"),
              Type.Literal("inProgress"),
              Type.Literal("completed"),
              Type.Literal("canceled"),
            ]),
          }), { minItems: 1, maxItems: 20 }),
        }),
        async execute(_toolCallId, params) {
          const current = runState.current;
          if (!current) throw new Error("No active Linear run");
          await current.send({
            type: "plan",
            steps: params.steps.map((step) => ({ ...step, content: finalText(step.content).slice(0, 500) })),
          });
          return { content: [{ type: "text", text: "Linear session plan updated." }], details: {} };
        },
      }),
    ];
  }
}
