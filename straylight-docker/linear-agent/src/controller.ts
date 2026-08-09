import { ControllerStateStore, type ControllerSessionRecord } from "./controller-state.js";
import { LinearClient, type AgentSessionSnapshot } from "./linear.js";
import type {
  LinearManageRequest,
  LinearManageResult,
  LinearSessionRequest,
  LinearSessionResult,
  LinearUploadRequest,
} from "./linear-actions.js";
import { followUpPrompt } from "./prompts.js";
import { finalText } from "./redaction.js";
import type { AgentRunner } from "./runner-client.js";
import type { PiResult } from "./runner-protocol.js";
import type {
  AgentPlanStep,
  AgentSessionWebhook,
  AgentTaskPayload,
  AppUserNotificationWebhook,
  LinearInputFile,
  PermissionChangeWebhook,
} from "./types.js";

type SessionState = {
  running: boolean;
  awaitingInput: boolean;
  generation: number;
  startedAt: number | undefined;
  pending: AgentSessionWebhook | undefined;
  active: AgentSessionWebhook | undefined;
  issueId: string | undefined;
  teamId: string | undefined;
  updatedAt: number;
};

type NotificationDisposition = "agentSessionOwned" | "contextOnly" | "acknowledgement" | "cancellation" | "lifecycle" | "unknown";

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
  private readonly stateStore: ControllerStateStore | undefined;
  private persistence: Promise<void> = Promise.resolve();
  private recoveredSessions = 0;
  private lastRecovery: { at: string; restored: number; resumed: number; skipped: number; errors: number } | undefined;
  private readonly inputStats = { downloaded: 0, skipped: 0, bytes: 0 };
  private readonly notificationCounts: Record<NotificationDisposition, number> = {
    agentSessionOwned: 0,
    contextOnly: 0,
    acknowledgement: 0,
    cancellation: 0,
    lifecycle: 0,
    unknown: 0,
  };
  private lastNotification: { action: string; disposition: NotificationDisposition; at: string } | undefined;
  private plansEnabled = true;

  constructor(
    private readonly linear: LinearClient,
    private readonly runner: AgentRunner,
    stateDirectory?: string,
  ) {
    this.stateStore = stateDirectory ? new ControllerStateStore(stateDirectory) : undefined;
  }

  async initialize(): Promise<void> {
    if (!this.stateStore) return;
    const records = await this.stateStore.load();
    const resumptions: Array<{ sessionId: string; payload: AgentSessionWebhook; state: SessionState }> = [];
    let skipped = 0;
    let errors = 0;
    for (const record of records) {
      const state: SessionState = {
        running: record.running,
        awaitingInput: record.awaitingInput,
        generation: record.generation,
        startedAt: record.startedAt,
        pending: record.pending,
        active: record.active,
        issueId: record.issueId,
        teamId: record.teamId,
        updatedAt: record.updatedAt,
      };
      this.states.set(record.sessionId, state);
      const wasRunning = state.running;
      state.running = false;
      state.startedAt = undefined;
      try {
        const snapshot = await this.linear.agentSessionSnapshot(record.sessionId);
        state.issueId = snapshot.issue?.id ?? state.issueId;
        state.teamId = snapshot.issue?.team.id ?? state.teamId;
        const latest = [...snapshot.activities.nodes]
          .filter((activity) => !activity.ephemeral)
          .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
          .at(-1);
        const status = snapshot.status.toLowerCase();
        if (["complete", "stale", "error"].includes(status) || ["response", "error"].includes(latest?.content.type ?? "")) {
          state.awaitingInput = false;
          state.pending = undefined;
          state.active = undefined;
          skipped += 1;
        } else if (state.pending || wasRunning) {
          resumptions.push({
            sessionId: record.sessionId,
            payload: this.recoveryPayload(state.pending ?? state.active, snapshot, Boolean(state.pending)),
            state,
          });
          state.pending = undefined;
          state.active = undefined;
        } else if (status === "awaitinginput" || latest?.content.type === "elicitation") {
          state.awaitingInput = true;
          skipped += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        errors += 1;
        console.warn("could not reconcile persisted Linear Agent Session", {
          sessionId: record.sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      this.touch(state);
    }
    this.recoveredSessions = records.length;
    await this.persist();
    let resumed = 0;
    for (const recovery of resumptions) {
      await this.runner.abort(recovery.sessionId).catch(() => false);
      await this.start(recovery.sessionId, recovery.payload, recovery.state);
      resumed += 1;
    }
    this.lastRecovery = {
      at: new Date().toISOString(),
      restored: records.length,
      resumed,
      skipped,
      errors,
    };
    await this.persist();
  }

  private recoveryPayload(
    previous: AgentSessionWebhook | undefined,
    snapshot: AgentSessionSnapshot,
    includePendingPrompt: boolean,
  ): AgentSessionWebhook {
    const pendingBody = includePendingPrompt ? previous?.agentActivity?.content?.body?.trim() : undefined;
    const recovery = [
      "The Straylight controller restarted while this Agent Session still had unfinished work.",
      "Reconstruct the task from persistent Pi history and the current workspace. Inspect current Linear and repository state before repeating any external action.",
      pendingBody ? `The queued Linear follow-up was:\n${pendingBody}` : "Continue the interrupted request.",
    ].join("\n\n");
    return {
      ...(previous ?? {}),
      type: "AgentSessionEvent",
      action: "prompted",
      appUserId: previous?.appUserId ?? snapshot.appUser.id,
      agentActivity: { content: { type: "prompt", body: recovery } },
      agentSession: {
        ...(previous?.agentSession ?? {}),
        id: snapshot.id,
        appUserId: snapshot.appUser.id,
        ...(snapshot.issue?.id ? { issueId: snapshot.issue.id } : {}),
        status: snapshot.status,
        issue: snapshot.issue ? {
          id: snapshot.issue.id,
          ...(snapshot.issue.identifier ? { identifier: snapshot.issue.identifier } : {}),
          ...(snapshot.issue.title ? { title: snapshot.issue.title } : {}),
          ...(snapshot.issue.description === undefined ? {} : { description: snapshot.issue.description }),
          ...(snapshot.issue.url ? { url: snapshot.issue.url } : {}),
          teamId: snapshot.issue.team.id,
          team: snapshot.issue.team,
        } : null,
      },
    };
  }

  private touch(state: SessionState): void {
    state.updatedAt = Date.now();
  }

  private persist(): Promise<void> {
    if (!this.stateStore) return Promise.resolve();
    this.persistence = this.persistence
      .catch(() => undefined)
      .then(() => this.stateStore?.save([...this.states].map(([sessionId, state]): ControllerSessionRecord => ({
        sessionId,
        running: state.running,
        awaitingInput: state.awaitingInput,
        generation: state.generation,
        ...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
        ...(state.pending ? { pending: state.pending } : {}),
        ...(state.active ? { active: state.active } : {}),
        ...(state.issueId ? { issueId: state.issueId } : {}),
        ...(state.teamId ? { teamId: state.teamId } : {}),
        updatedAt: state.updatedAt,
      }))) ?? Promise.resolve());
    return this.persistence;
  }

  async health(): Promise<Record<string, unknown>> {
    const sessions = [...this.states.values()];
    return {
      controller: {
        trackedSessions: sessions.length,
        runningSessions: sessions.filter((state) => state.running).length,
        pendingSessions: sessions.filter((state) => Boolean(state.pending)).length,
        awaitingInputSessions: sessions.filter((state) => state.awaitingInput).length,
        plansEnabled: this.plansEnabled,
        registry: {
          persistent: Boolean(this.stateStore),
          recoveredSessions: this.recoveredSessions,
          ...(this.lastRecovery ? { lastRecovery: this.lastRecovery } : {}),
        },
        linearInputs: { ...this.inputStats },
        notifications: {
          counts: { ...this.notificationCounts },
          ...(this.lastNotification ? { last: this.lastNotification } : {}),
        },
      },
      workbench: await this.runner.health(),
    };
  }

  async manageLinear(sessionId: string, request: LinearManageRequest): Promise<LinearManageResult> {
    const state = this.states.get(sessionId);
    if (!state) throw new Error("Linear operation does not belong to a known Agent Session");
    return this.linear.manage(request, {
      agentSessionId: sessionId,
      ...(state.issueId ? { issueId: state.issueId } : {}),
      ...(state.teamId ? { teamId: state.teamId } : {}),
    });
  }

  async collaborateLinear(sessionId: string, request: LinearSessionRequest): Promise<LinearSessionResult> {
    const state = this.states.get(sessionId);
    if (!state) throw new Error("Linear collaboration does not belong to a known Agent Session");
    if (request.action === "activity") {
      await this.linear.createActivity(sessionId, request.content, {
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.signalMetadata ? { signalMetadata: request.signalMetadata } : {}),
      });
      return { ok: true, action: request.action };
    }
    if (request.action === "external_url") {
      await this.linear.addExternalUrl(sessionId, { label: request.label, url: request.url });
      return { ok: true, action: request.action };
    }
    if (request.action === "plan") {
      const mirrored = await this.updatePlan(sessionId, request.steps);
      return { ok: true, action: request.action, data: { mirrored } };
    }
    if (!state.issueId) throw new Error("Linear publications require an issue-backed Agent Session");
    if (request.publication.kind === "document") {
      const document = request.publication.update
        ? await this.linear.updateDocument(request.publication.id, request.publication.title, request.publication.body)
        : await this.linear.createDocument(state.issueId, request.publication.id, request.publication.title, request.publication.body);
      await this.linear.addExternalUrl(sessionId, { label: document.title, url: document.url });
      await this.linear.createActivity(sessionId, {
        type: "thought",
        body: `[${document.title}](${document.url}) is ready for review.`,
      });
      return { ok: true, action: request.action, data: document };
    }
    const attachment = await this.linear.createIssueAttachment(state.issueId, {
      title: request.publication.title,
      url: request.publication.url,
      ...(request.publication.subtitle ? { subtitle: request.publication.subtitle } : {}),
      ...(request.publication.body ? { commentBody: request.publication.body } : {}),
      agentSessionId: sessionId,
    });
    await this.linear.addExternalUrl(sessionId, { label: attachment.title, url: attachment.url });
    return { ok: true, action: request.action, data: attachment };
  }

  async uploadLinearFile(sessionId: string, request: LinearUploadRequest, signal?: AbortSignal): Promise<string> {
    if (!this.states.has(sessionId)) throw new Error("Linear upload does not belong to a known Agent Session");
    const contents = Buffer.from(request.dataBase64, "base64");
    if (!contents.length || contents.length > 10 * 1024 * 1024) throw new Error("Linear artifacts must be between 1 byte and 10 MB");
    return this.linear.uploadFile(request.filename, request.contentType, contents, signal);
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
      awaitingInput: false,
      generation: 0,
      startedAt: undefined,
      pending: undefined,
      active: undefined,
      issueId: undefined,
      teamId: undefined,
      updatedAt: Date.now(),
    };
    state.issueId = session.issueId ?? session.issue?.id ?? state.issueId;
    state.teamId = session.issue?.teamId ?? session.issue?.team?.id ?? state.teamId;
    this.touch(state);
    this.states.set(sessionId, state);

    if (isStopRequest(payload)) {
      const wasRunning = state.running;
      const runTime = state.startedAt === undefined ? undefined : Date.now() - state.startedAt;
      state.generation += 1;
      state.running = false;
      state.awaitingInput = false;
      state.startedAt = undefined;
      state.pending = undefined;
      state.active = undefined;
      this.touch(state);
      await this.persist();
      const aborted = await this.runner.abort(sessionId);
      const suffix = runTime === undefined ? "" : ` after ${elapsed(runTime)}`;
      await this.linear.createActivity(sessionId, {
        type: "error",
        body: aborted || wasRunning ? `Stopped by user${suffix}.` : "Stop requested; no active Pi run was in progress.",
      });
      return;
    }

    if (payload.action !== "created" && payload.action !== "prompted") {
      await this.persist();
      return;
    }
    if (payload.action === "prompted" && state.running) {
      const inputs = await this.prepareLinearInputs(sessionId, payload);
      if (await this.runner.followUp(sessionId, followUpPrompt(payload), inputs)) {
        state.active = payload;
        this.touch(state);
        await this.persist();
        await this.linear.createActivity(sessionId, { type: "thought", body: "Your follow-up is queued in the active Pi session." });
      } else {
        state.pending = payload;
        this.touch(state);
        await this.persist();
        await this.linear.createActivity(sessionId, { type: "thought", body: "Your follow-up will run after the current Pi turn." });
      }
      return;
    }
    await this.start(sessionId, payload, state);
  }

  async handleNotification(payload: AppUserNotificationWebhook): Promise<void> {
    const action = payload.action ?? "unknown";
    const issueId = payload.notification?.issueId ?? payload.notification?.issue?.id;
    const documentId = payload.notification?.documentId;
    if (["issueMention", "issueCommentMention"].includes(action)) {
      this.recordNotification(action, "agentSessionOwned");
      console.info("Linear mention notification observed; AgentSessionEvent owns the instruction", { action, issueId });
      return;
    }
    if (action === "issueNewComment") {
      this.recordNotification(action, "contextOnly");
      console.info("Linear comment notification retained as context; no prompt was synthesized", { issueId });
      return;
    }
    if (["issueEmojiReaction", "issueCommentReaction"].includes(action)) {
      this.recordNotification(action, "acknowledgement");
      console.info("Linear reaction notification observed as acknowledgement", { action, issueId });
      return;
    }
    if (["documentMention", "documentCommentMention"].includes(action)) {
      this.recordNotification(action, "agentSessionOwned");
      console.info("Linear document mention observed; AgentSessionEvent owns the instruction", { action, documentId });
      return;
    }
    if (["documentEmojiReaction", "documentCommentReaction"].includes(action)) {
      this.recordNotification(action, "acknowledgement");
      console.info("Linear document reaction observed as acknowledgement", { action, documentId });
      return;
    }
    if (action === "documentSubscribed" || action === "documentUnsubscribed") {
      this.recordNotification(action, "lifecycle");
      console.info("Linear document subscription lifecycle observed", { action, documentId });
      return;
    }
    if (action.startsWith("document")) {
      this.recordNotification(action, "contextOnly");
      console.info("Linear document notification retained as context; no prompt was synthesized", { action, documentId });
      return;
    }
    if (action === "issueAssignedToYou") {
      this.recordNotification(action, "lifecycle");
      console.info("Linear assignment notification observed; AgentSessionEvent owns delegated work", { issueId });
      return;
    }
    if (action === "issueUnassignedFromYou") {
      this.recordNotification(action, "cancellation");
      if (issueId) await this.cancelMatching((state) => state.issueId === issueId, "Agent was unassigned from the issue.");
      return;
    }
    if (action === "issueStatusChanged") {
      if (!issueId) {
        this.recordNotification(action, "unknown");
        return;
      }
      let state: { id: string; name: string; type: string };
      try {
        state = await this.linear.issueState(issueId);
      } catch (error) {
        this.recordNotification(action, "unknown");
        console.warn("could not resolve Linear status notification; active work was left running", {
          issueId,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if (["completed", "canceled"].includes(state.type)) {
        this.recordNotification(action, "cancellation");
        await this.cancelMatching((session) => session.issueId === issueId, `Issue entered terminal status ${state.name}.`);
      } else {
        this.recordNotification(action, "lifecycle");
        console.info("Linear issue status changed without ending the Agent Session", { issueId, state: state.type });
      }
      return;
    }
    this.recordNotification(action, "unknown");
    console.info("received unrecognized Linear app notification", { action, issueId });
  }

  private recordNotification(action: string, disposition: NotificationDisposition): void {
    this.notificationCounts[disposition] += 1;
    this.lastNotification = { action, disposition, at: new Date().toISOString() };
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

  private async start(sessionId: string, payload: AgentSessionWebhook, state: SessionState): Promise<void> {
    if (state.running) {
      state.pending = payload;
      this.touch(state);
      await this.persist();
      void this.linear
        .createActivity(sessionId, { type: "thought", body: "A Pi run is already active; this request is queued." })
        .catch((error: unknown) => console.error("failed to report queued run", {
          message: error instanceof Error ? error.message : String(error),
        }));
      return;
    }
    state.running = true;
    state.awaitingInput = false;
    state.startedAt = Date.now();
    state.active = payload;
    this.touch(state);
    const generation = ++state.generation;
    await this.persist();
    void this.execute(sessionId, payload, state, generation).catch(async (error: unknown) => {
      if (state.generation !== generation) return;
      state.running = false;
      state.startedAt = undefined;
      state.active = undefined;
      this.touch(state);
      await this.persist().catch(() => undefined);
      const message = error instanceof Error ? error.message : String(error);
      console.error("Pi run crashed", {
        sessionId,
        message: finalText(message),
        ...(error instanceof Error && error.stack ? { stack: finalText(error.stack) } : {}),
      });
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
    await this.createEphemeralActivity(sessionId, { type: "thought", body: `Setting up the workspace for ${label}…` });
    if (payload.action === "created" && payload.agentSession?.creatorId && state.issueId && payload.appUserId) {
      await this.linear.beginHumanDelegation(state.issueId, payload.appUserId).catch((error: unknown) => {
        console.warn("failed to move human-delegated issue to started", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    const taskPayload: AgentTaskPayload = structuredClone(payload);
    const inputs = await this.prepareLinearInputs(sessionId, payload);
    if (inputs.length) taskPayload.linearInputs = inputs;
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
      await this.createEphemeralActivity(sessionId, event.content);
    });
    if (state.generation !== generation) return;
    if (!result.awaitingInput) {
      await this.finish(sessionId, result);
    }
    state.running = false;
    state.awaitingInput = result.awaitingInput;
    state.startedAt = undefined;
    state.active = undefined;
    const pending = state.pending;
    state.pending = undefined;
    this.touch(state);
    await this.persist();
    if (pending) await this.start(sessionId, pending, state);
  }

  private async createEphemeralActivity(
    sessionId: string,
    content: Parameters<LinearClient["createActivity"]>[1],
  ): Promise<void> {
    await this.linear.createActivity(sessionId, content, { ephemeral: true }).catch((error: unknown) => {
      console.warn("failed to publish ephemeral Linear activity; Pi run continues", {
        sessionId,
        message: finalText(error instanceof Error ? error.message : String(error)),
      });
    });
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

  private async prepareLinearInputs(sessionId: string, payload: AgentSessionWebhook): Promise<LinearInputFile[]> {
    try {
      const download = await this.linear.downloadInputs(payload);
      if (!download.inputs.length && !download.skipped.length) return [];
      this.inputStats.downloaded += download.inputs.length;
      this.inputStats.skipped += download.skipped.length;
      this.inputStats.bytes += download.totalBytes;
      const result = download.skipped.length
        ? download.skipped.map((item) => `- ${item.label}: ${item.reason}`).join("\n").slice(0, 2_000)
        : "Every referenced Linear file passed host, type, signature, and size validation.";
      await this.linear.createActivity(sessionId, {
        type: "action",
        action: "Prepared Linear inputs",
        parameter: `${download.inputs.length} accepted · ${download.skipped.length} skipped`,
        result: finalText(result),
      }).catch((error: unknown) => {
        console.warn("could not report prepared Linear inputs", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return download.inputs;
    } catch (error) {
      this.inputStats.skipped += 1;
      console.warn("could not prepare Linear input files", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async updatePlan(sessionId: string, plan: AgentPlanStep[]): Promise<boolean> {
    if (!this.plansEnabled) return false;
    try {
      await this.linear.updatePlan(sessionId, plan);
      return true;
    } catch (error) {
      this.plansEnabled = false;
      console.warn("Agent Plan API unavailable; continuing without native plans", {
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async cancelMatching(predicate: (state: SessionState) => boolean, reason: string): Promise<void> {
    const cancellations: Promise<void>[] = [];
    for (const [sessionId, state] of this.states) {
      if (!predicate(state)) continue;
      state.generation += 1;
      state.running = false;
      state.awaitingInput = false;
      state.startedAt = undefined;
      state.pending = undefined;
      state.active = undefined;
      this.touch(state);
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
    await this.persist();
  }
}

export function githubPullRequestUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)?.[0];
}
