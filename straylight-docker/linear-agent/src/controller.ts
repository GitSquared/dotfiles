import { performance } from "node:perf_hooks";
import { LinearClient } from "./linear.js";
import { followUpPrompt } from "./prompts.js";
import { finalText } from "./redaction.js";
import type { AgentRunner } from "./runner-client.js";
import type { PiResult } from "./runner-protocol.js";
import type { AgentPlanStep, AgentSessionWebhook } from "./types.js";

type SessionState = {
  running: boolean;
  generation: number;
  startedAt: number | undefined;
  pending: AgentSessionWebhook | undefined;
};

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function isStopRequest(payload: AgentSessionWebhook): boolean {
  const action = payload.action?.toLowerCase();
  if (action && ["cancel", "canceled", "cancelled", "stop", "stopped", "abort", "aborted"].includes(action)) return true;
  const body = payload.agentActivity?.content?.body?.trim().toLowerCase();
  return body === "stop" || body === "cancel" || body === "cancelled" || body === "canceled";
}

export class AgentController {
  private readonly states = new Map<string, SessionState>();
  private plansEnabled = true;

  constructor(
    private readonly linear: LinearClient,
    private readonly runner: AgentRunner,
  ) {}

  async handle(payload: AgentSessionWebhook): Promise<void> {
    const sessionId = payload.agentSession?.id;
    if (!sessionId) {
      console.warn("ignored Agent Session event without an id");
      return;
    }
    const state = this.states.get(sessionId) ?? { running: false, generation: 0, startedAt: undefined, pending: undefined };
    this.states.set(sessionId, state);

    if (isStopRequest(payload)) {
      const wasRunning = state.running;
      const runTime = state.startedAt === undefined ? undefined : performance.now() - state.startedAt;
      state.generation += 1;
      state.running = false;
      state.startedAt = undefined;
      state.pending = undefined;
      const aborted = await this.runner.abort(sessionId);
      const suffix = runTime === undefined ? "" : ` after ${elapsed(runTime)}`;
      await this.linear.createActivity(sessionId, {
        type: "error",
        body: aborted || wasRunning ? `Stopped by user${suffix}.` : "Stop requested; no active Pi run was in progress.",
      });
      return;
    }

    if (payload.action !== "created" && payload.action !== "prompted") return;
    if (payload.action === "prompted" && state.running) {
      if (await this.runner.followUp(sessionId, followUpPrompt(payload))) {
        await this.linear.createActivity(sessionId, { type: "thought", body: "Your follow-up is queued in the active Pi session." });
      } else {
        state.pending = payload;
        await this.linear.createActivity(sessionId, { type: "thought", body: "Your follow-up will run after the current Pi turn." });
      }
      return;
    }
    this.start(sessionId, payload, state);
  }

  private start(sessionId: string, payload: AgentSessionWebhook, state: SessionState): void {
    if (state.running) {
      state.pending = payload;
      void this.linear
        .createActivity(sessionId, { type: "thought", body: "A Pi run is already active; this request is queued." })
        .catch((error: unknown) => console.error("failed to report queued run", {
          message: error instanceof Error ? error.message : String(error),
        }));
      return;
    }
    state.running = true;
    state.startedAt = performance.now();
    const generation = ++state.generation;
    void this.execute(sessionId, payload, state, generation).catch(async (error: unknown) => {
      if (state.generation !== generation) return;
      state.running = false;
      state.startedAt = undefined;
      const message = error instanceof Error ? error.message : String(error);
      await this.linear.createActivity(sessionId, { type: "error", body: finalText(`Pi run crashed: ${message}`) }).catch(() => undefined);
    });
  }

  private async execute(
    sessionId: string,
    payload: AgentSessionWebhook,
    state: SessionState,
    generation: number,
  ): Promise<void> {
    const issue = payload.agentSession?.issue;
    const label = issue?.identifier ? `${issue.identifier}: ${issue.title ?? "Untitled"}` : "this Linear session";
    await this.linear.createActivity(
      sessionId,
      { type: "thought", body: `Pi received ${label} and started working.` },
      { ephemeral: true },
    );
    await this.updatePlan(sessionId, initialPlan());
    let customPlan = false;
    let startedWork = false;
    const result = await this.runner.run(payload, async (event) => {
      if (event.type === "plan") {
        customPlan = true;
        await this.updatePlan(sessionId, event.steps);
        return;
      }
      if (!startedWork && event.content.type === "action") {
        startedWork = true;
        if (!customPlan) await this.updatePlan(sessionId, workingPlan());
      }
      await this.linear.createActivity(
        sessionId,
        event.content,
        event.ephemeral === undefined ? {} : { ephemeral: event.ephemeral },
      );
    });
    if (state.generation !== generation) return;
    if (!result.awaitingInput) {
      if (!customPlan) await this.updatePlan(sessionId, finishedPlan(result.ok));
      await this.finish(sessionId, result);
    }
    state.running = false;
    state.startedAt = undefined;
    const pending = state.pending;
    state.pending = undefined;
    if (pending) this.start(sessionId, pending, state);
  }

  private finish(sessionId: string, result: PiResult): Promise<void> {
    const footer = `\n\n_Run ${result.ok ? "completed" : "failed"} in ${elapsed(result.elapsedMs)}._`;
    const activity = this.linear.createActivity(sessionId, {
      type: result.ok ? "response" : "error",
      body: finalText(`${result.summary}${footer}`),
    });
    const pullRequest = githubPullRequestUrl(result.summary);
    return pullRequest
      ? activity.then(() => this.linear.addExternalUrl(sessionId, { label: "Pull request", url: pullRequest }).catch((error: unknown) => {
        console.warn("failed to attach pull request to Agent Session", {
          message: error instanceof Error ? error.message : String(error),
        });
      }))
      : activity;
  }

  private async updatePlan(sessionId: string, plan: AgentPlanStep[]): Promise<void> {
    if (!this.plansEnabled) return;
    try {
      await this.linear.updatePlan(sessionId, plan);
    } catch (error) {
      this.plansEnabled = false;
      console.warn("Agent Plan API unavailable; continuing without native plans", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function initialPlan(): AgentPlanStep[] {
  return [
    { content: "Understand the request and workspace context", status: "inProgress" },
    { content: "Carry out the requested work and checks", status: "pending" },
    { content: "Report the outcome in Linear", status: "pending" },
  ];
}

function workingPlan(): AgentPlanStep[] {
  return [
    { content: "Understand the request and workspace context", status: "completed" },
    { content: "Carry out the requested work and checks", status: "inProgress" },
    { content: "Report the outcome in Linear", status: "pending" },
  ];
}

function finishedPlan(ok: boolean): AgentPlanStep[] {
  return [
    { content: "Understand the request and workspace context", status: "completed" },
    { content: "Carry out the requested work and checks", status: ok ? "completed" : "canceled" },
    { content: "Report the outcome in Linear", status: "completed" },
  ];
}

export function githubPullRequestUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)?.[0];
}
