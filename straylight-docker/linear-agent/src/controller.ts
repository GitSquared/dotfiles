import { performance } from "node:perf_hooks";
import { LinearClient } from "./linear.js";
import { followUpPrompt } from "./prompts.js";
import { finalText } from "./redaction.js";
import type { AgentRunner } from "./runner-client.js";
import type { PiResult } from "./runner-protocol.js";
import type {
  AgentPlanStep,
  AgentSessionWebhook,
  AgentTaskPayload,
  AppUserNotificationWebhook,
  PermissionChangeWebhook,
} from "./types.js";

type SessionState = {
  running: boolean;
  generation: number;
  startedAt: number | undefined;
  pending: AgentSessionWebhook | undefined;
  issueId: string | undefined;
  teamId: string | undefined;
};

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function isStopRequest(payload: AgentSessionWebhook): boolean {
  if (payload.agentActivity?.signal === "stop") return true;
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

  health(): Promise<Record<string, unknown>> {
    return this.runner.health();
  }

  async handle(payload: AgentSessionWebhook): Promise<void> {
    const session = payload.agentSession;
    const sessionId = session?.id;
    if (!sessionId) {
      console.warn("ignored Agent Session event without an id");
      return;
    }
    const state = this.states.get(sessionId) ?? {
      running: false,
      generation: 0,
      startedAt: undefined,
      pending: undefined,
      issueId: undefined,
      teamId: undefined,
    };
    state.issueId = session.issueId ?? session.issue?.id ?? state.issueId;
    state.teamId = session.issue?.teamId ?? session.issue?.team?.id ?? state.teamId;
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

  async handleNotification(payload: AppUserNotificationWebhook): Promise<void> {
    if (payload.action !== "issueUnassignedFromYou" && payload.action !== "issueStatusChanged") {
      console.info("received Linear app notification", { action: payload.action });
      return;
    }
    const issueId = payload.notification?.issueId ?? payload.notification?.issue?.id;
    if (!issueId) return;
    await this.cancelMatching(
      (state) => state.issueId === issueId,
      payload.action === "issueUnassignedFromYou" ? "Agent was unassigned from the issue." : "Issue entered a terminal status.",
    );
  }

  async handlePermissionChange(payload: PermissionChangeWebhook): Promise<void> {
    const removed = new Set(payload.removedTeamIds ?? []);
    if (!removed.size) return;
    await this.cancelMatching((state) => Boolean(state.teamId && removed.has(state.teamId)), "Agent lost access to the Linear team.");
  }

  async handleRevocation(): Promise<void> {
    await this.cancelMatching(() => true, "Linear installation was revoked.");
    await this.linear.revokeInstallation();
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
    if (payload.action === "created" && payload.agentSession?.creatorId && state.issueId && payload.appUserId) {
      await this.linear.beginHumanDelegation(state.issueId, payload.appUserId).catch((error: unknown) => {
        console.warn("failed to move human-delegated issue to started", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    const taskPayload: AgentTaskPayload = structuredClone(payload);
    try {
      const repositories = await this.runner.repositories();
      const suggestions = state.issueId && repositories.length
        ? await this.linear.repositorySuggestions(state.issueId, sessionId, repositories)
        : [];
      taskPayload.workbench = { repositories, repositorySuggestions: suggestions };
    } catch (error) {
      console.warn("repository discovery or Linear suggestions unavailable; Pi will inspect the workbench directly", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const result = await this.runner.run(taskPayload, async (event) => {
      if (state.generation !== generation) return;
      if (event.type === "plan") {
        await this.updatePlan(sessionId, event.steps);
        return;
      }
      if (event.type === "external_url") {
        await this.linear.addExternalUrl(sessionId, { label: event.label, url: event.url });
        return;
      }
      if (event.type === "artifact") {
        const bytes = Buffer.from(event.dataBase64, "base64");
        if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Linear artifact must be between 1 byte and 10 MB");
        const assetUrl = await this.linear.uploadFile(event.filename, event.contentType, bytes);
        const label = event.title || event.filename;
        const link = event.contentType.startsWith("image/")
          ? `![${label.replace(/[\[\]]/g, "")}](${assetUrl})`
          : `[${label}](${assetUrl})`;
        await this.linear.createActivity(sessionId, {
          type: "thought",
          body: [event.body, link].filter(Boolean).join("\n\n"),
        });
        return;
      }
      if (event.type === "linear_publish") {
        if (!state.issueId) throw new Error("Linear documents and rich attachments require an issue-backed Agent Session");
        if (event.publication.kind === "document") {
          const document = event.publication.update
            ? await this.linear.updateDocument(event.publication.id, event.publication.title, event.publication.body)
            : await this.linear.createDocument(state.issueId, event.publication.id, event.publication.title, event.publication.body);
          await this.linear.addExternalUrl(sessionId, { label: document.title, url: document.url });
          await this.linear.createActivity(sessionId, {
            type: "thought",
            body: `[${document.title}](${document.url}) is ready for review.`,
          });
          return;
        }
        const attachment = await this.linear.createIssueAttachment(state.issueId, {
          title: event.publication.title,
          url: event.publication.url,
          ...(event.publication.subtitle ? { subtitle: event.publication.subtitle } : {}),
          ...(event.publication.body ? { commentBody: event.publication.body } : {}),
          agentSessionId: sessionId,
        });
        await this.linear.addExternalUrl(sessionId, { label: attachment.title, url: attachment.url });
        return;
      }
      await this.linear.createActivity(
        sessionId,
        event.content,
        {
          ...(event.ephemeral === undefined ? {} : { ephemeral: event.ephemeral }),
          ...(event.signal === undefined ? {} : { signal: event.signal }),
          ...(event.signalMetadata === undefined ? {} : { signalMetadata: event.signalMetadata }),
        },
      );
    });
    if (state.generation !== generation) return;
    if (!result.awaitingInput) {
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

  private async cancelMatching(predicate: (state: SessionState) => boolean, reason: string): Promise<void> {
    const cancellations: Promise<void>[] = [];
    for (const [sessionId, state] of this.states) {
      if (!predicate(state)) continue;
      state.generation += 1;
      state.running = false;
      state.startedAt = undefined;
      state.pending = undefined;
      const cancellation = this.runner.abort(sessionId)
        .then(() => undefined)
        .catch((error: unknown) => {
          console.warn("failed to abort invalidated Pi task", {
            sessionId,
            reason,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      cancellations.push(cancellation);
    }
    await Promise.all(cancellations);
  }
}

export function githubPullRequestUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)?.[0];
}
