import { ControllerStateStore, type ControllerSessionRecord } from "./controller-state.js";
import {
  attentionOptions,
  attentionPriority,
  isQaApproval,
  renderAttentionRequest,
  renderDeferredItem,
  type ActiveAttention,
} from "./attention.js";
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
import { PermanentWebhookDeliveryError } from "./webhook-inbox.js";

type SessionState = {
  running: boolean;
  awaitingInput: boolean;
  generation: number;
  startedAt: number | undefined;
  pending: AgentSessionWebhook | undefined;
  active: AgentSessionWebhook | undefined;
  issueId: string | undefined;
  teamId: string | undefined;
  humanAssigneeId: string | undefined;
  attention: ActiveAttention[];
  updatedAt: number;
};

type NotificationDisposition = "agentSessionOwned" | "contextOnly" | "acknowledgement" | "cancellation" | "lifecycle" | "unknown";

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function requiredIssueId(issueId: string | undefined, action: string): string {
  if (!issueId) throw new Error(`${action} requires an issue-backed Agent Session`);
  return issueId;
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
  private readonly notificationSources = new Map<string, string>();
  private readonly notificationThreadSources = new Map<string, string>();
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
    private readonly attentionStateName: string = "Blocked",
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
        humanAssigneeId: record.humanAssigneeId,
        attention: record.attention ?? [],
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
        state.humanAssigneeId = snapshot.creator?.id ?? state.humanAssigneeId;
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
        } else if (status === "awaitinginput" || latest?.content.type === "elicitation") {
          state.awaitingInput = true;
          skipped += 1;
        } else if (state.pending || wasRunning) {
          resumptions.push({
            sessionId: record.sessionId,
            payload: this.recoveryPayload(state.pending ?? state.active, snapshot, Boolean(state.pending)),
            state,
          });
          state.pending = undefined;
          state.active = undefined;
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
      "Reconstruct the task from persistent agent history and the current workspace. Inspect current Linear and repository state before repeating any external action.",
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
        ...(snapshot.creator?.id ? { creatorId: snapshot.creator.id } : {}),
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
        ...(state.humanAssigneeId ? { humanAssigneeId: state.humanAssigneeId } : {}),
        ...(state.attention.length ? { attention: state.attention } : {}),
        updatedAt: state.updatedAt,
      }))) ?? Promise.resolve());
    return this.persistence;
  }

  async health(): Promise<Record<string, unknown>> {
    const sessions = [...this.states.values()];
    const attention = sessions.flatMap((state) => state.attention);
    const now = Date.now();
    return {
      controller: {
        trackedSessions: sessions.length,
        runningSessions: sessions.filter((state) => state.running).length,
        pendingSessions: sessions.filter((state) => Boolean(state.pending)).length,
        awaitingInputSessions: sessions.filter((state) => state.awaitingInput).length,
        attentionQueue: {
          total: attention.length,
          steering: attention.filter((request) => request.kind === "steering").length,
          qa: attention.filter((request) => request.kind === "qa").length,
          urgent: attention.filter((request) => request.priority === "urgent").length,
          oldestWaitMs: attention.length ? Math.max(...attention.map((request) => now - request.requestedAt)) : 0,
        },
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
    if (request.action === "attention") {
      if (!state.issueId || !state.teamId) throw new Error("Attention requests require an issue-backed Agent Session");
      const req = request.request;
      if (req.kind === "signal") {
        await this.linear.createIssueComment(state.issueId, finalText(renderAttentionRequest(req)));
        return { ok: true, action: request.action };
      }
      if (state.attention.length) {
        throw new Error("This Agent Session already has an unresolved blocking attention request");
      }
      const previousState = await this.linear.issueState(state.issueId);
      const attentionStateId = await this.linear.resolveAttentionStateId(state.teamId, this.attentionStateName);
      await this.linear.setIssueState(state.issueId, attentionStateId);
      await this.linear.createIssueComment(state.issueId, finalText(renderAttentionRequest(req)));
      const options = attentionOptions(req)?.map(({ label, value }) => ({ label, value }));
      await this.linear.createActivity(sessionId, {
        type: "elicitation",
        body: finalText(renderAttentionRequest(req)),
      }, options ? { signal: "select", signalMetadata: { options } } : {});
      const active: ActiveAttention = {
        kind: req.kind,
        priority: attentionPriority(req),
        previousStateId: previousState.id,
        requestedAt: Date.now(),
      };
      state.attention = [active];
      state.awaitingInput = true;
      this.touch(state);
      await this.persist();
      return { ok: true, action: request.action, data: active };
    }
    if (request.action === "defer") {
      if (!state.issueId) throw new Error("Deferred follow-ups require an issue-backed Agent Session");
      const result = await this.linear.manage(
        {
          resource: "subissue",
          operation: "create",
          parentId: state.issueId,
          fields: {
            title: request.request.title,
            description: finalText(renderDeferredItem(request.request)),
          },
        },
        { agentSessionId: sessionId, issueId: state.issueId, ...(state.teamId ? { teamId: state.teamId } : {}) },
      );
      return { ok: true, action: request.action, data: result.data };
    }
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
    if (request.publication.kind === "document") {
      const document = request.publication.update
        ? await this.linear.updateDocument(request.publication.id, request.publication.title, request.publication.body)
        : await this.linear.createDocument(
          requiredIssueId(state.issueId, "Creating a Linear Document"),
          request.publication.id,
          request.publication.title,
          request.publication.body,
        );
      await this.linear.addExternalUrl(sessionId, { label: document.title, url: document.url });
      await this.linear.createActivity(sessionId, {
        type: "thought",
        body: `[${document.title}](${document.url}) is ready for review.`,
      });
      return { ok: true, action: request.action, data: document };
    }
    if (!state.issueId) throw new Error("Linear issue attachments require an issue-backed Agent Session");
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
    const notificationRoot = session.comment?.id;
    const notificationSource = this.notificationSources.get(sessionId)
      ?? (notificationRoot ? this.notificationThreadSources.get(notificationRoot) : undefined);
    if (notificationSource && !session.sourceCommentId) session.sourceCommentId = notificationSource;
    if (notificationSource) this.notificationSources.delete(sessionId);
    if (notificationRoot) this.notificationThreadSources.delete(notificationRoot);
    const state = this.states.get(sessionId) ?? {
      running: false,
      awaitingInput: false,
      generation: 0,
      startedAt: undefined,
      pending: undefined,
      active: undefined,
      issueId: undefined,
      teamId: undefined,
      humanAssigneeId: undefined,
      attention: [],
      updatedAt: Date.now(),
    };
    state.issueId = session.issueId ?? session.issue?.id ?? state.issueId;
    state.teamId = session.issue?.teamId ?? session.issue?.team?.id ?? state.teamId;
    const appUserId = payload.appUserId ?? session.appUserId;
    if (session.creatorId && session.creatorId !== appUserId) state.humanAssigneeId = session.creatorId;
    if (payload.action === "prompted" && state.attention.length) {
      const attention = state.attention[0]!;
      const answer = payload.agentActivity?.content?.body?.trim() ?? "";
      state.attention = [];
      if (attention.kind === "qa" && isQaApproval(answer) && state.issueId) {
        await this.linear.createActivity(sessionId, {
          type: "response",
          body: "QA approved. The delegated work is complete.",
        }).catch(() => undefined);
        await this.linear.completeIssue(state.issueId).catch((error: unknown) => {
          console.warn("failed to complete approved QA issue", {
            sessionId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
        state.awaitingInput = false;
        this.touch(state);
        this.states.set(sessionId, state);
        await this.persist();
        return;
      }
      if (state.issueId) {
        await this.linear.setIssueState(state.issueId, attention.previousStateId).catch((error: unknown) => {
          console.warn("failed to restore issue status after resolving attention", {
            sessionId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
    this.touch(state);
    this.states.set(sessionId, state);

    if (isStopRequest(payload)) {
      const wasRunning = state.running;
      const runTime = state.startedAt === undefined ? undefined : Date.now() - state.startedAt;
      const attention = [...state.attention];
      state.generation += 1;
      state.running = false;
      state.awaitingInput = false;
      state.startedAt = undefined;
      state.pending = undefined;
      state.active = undefined;
      this.touch(state);
      await this.persist();
      const aborted = await this.runner.abort(sessionId).catch((error: unknown) => {
        console.warn("failed to abort stopped agent task", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      });
      await this.dismissAttention(sessionId, state.issueId, attention, "The parent Straylight run was stopped.");
      state.attention = [];
      this.touch(state);
      await this.persist();
      const suffix = runTime === undefined ? "" : ` after ${elapsed(runTime)}`;
      await this.linear.createActivity(sessionId, {
        type: "error",
        body: aborted || wasRunning ? `Stopped by user${suffix}.` : "Stop requested; no active agent run was in progress.",
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
        await this.linear.createActivity(sessionId, { type: "thought", body: "Your follow-up is queued in the active agent session." });
      } else {
        state.pending = payload;
        this.touch(state);
        await this.persist();
        await this.linear.createActivity(sessionId, { type: "thought", body: "Your follow-up will run after the current agent turn." });
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
    if (action === "documentCommentMention") {
      const commentId = payload.notification?.commentId ?? payload.notification?.comment?.id;
      const rootCommentId = payload.notification?.parentCommentId
        ?? payload.notification?.parentComment?.id
        ?? commentId;
      if (!commentId || !rootCommentId) {
        this.recordNotification(action, "unknown");
        console.warn("Linear Document comment mention did not include a comment id", { documentId });
        return;
      }
      this.notificationThreadSources.set(rootCommentId, commentId);
      let session: { id: string };
      try {
        session = await this.linear.createAgentSessionOnComment(rootCommentId);
      } catch (error) {
        this.notificationThreadSources.delete(rootCommentId);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("comment must be on an issue") || message.includes("comment threads on issues")) {
          throw new PermanentWebhookDeliveryError(
            "Linear currently rejects Agent Sessions on Document comment threads. The mention was quarantined without its private comment body; use an issue-backed Agent Session that links the Document until Linear supports this anchor.",
          );
        }
        throw error;
      }
      if (this.notificationThreadSources.has(rootCommentId)) this.notificationSources.set(session.id, commentId);
      this.recordNotification(action, "agentSessionOwned");
      console.info("Linear Document comment mention promoted to an Agent Session", {
        documentId,
        commentId,
        rootCommentId,
        agentSessionId: session.id,
      });
      return;
    }
    if (action === "documentMention") {
      this.recordNotification(action, "contextOnly");
      console.info("Linear Document-body mention has no comment thread to anchor an Agent Session", { documentId });
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
        .createActivity(sessionId, { type: "thought", body: "An agent run is already active; this request is queued." })
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
      console.error("agent run crashed", {
        sessionId,
        message: finalText(message),
        ...(error instanceof Error && error.stack ? { stack: finalText(error.stack) } : {}),
      });
      await this.linear.createActivity(sessionId, { type: "error", body: finalText(`Agent run crashed: ${message}`) }).catch(() => undefined);
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
    const commentId = payload.agentSession?.sourceCommentId ?? payload.agentSession?.comment?.id;
    if (commentId) {
      try {
        const context = await this.linear.commentContext(commentId);
        taskPayload.linearSourceComment = context.comment;
        if (context.documentReview) taskPayload.linearDocumentReview = context.documentReview;
      } catch (error) {
        console.warn("Source comment context unavailable; the agent will continue with the webhook payload", {
          commentId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    try {
      const repositories = await this.runner.repositories();
      const suggestions = state.issueId && repositories.length
        ? await this.linear.repositorySuggestions(state.issueId, sessionId, repositories)
        : [];
      taskPayload.workbench = { repositories, repositorySuggestions: suggestions };
    } catch (error) {
      console.warn("repository discovery or Linear suggestions unavailable; the agent will inspect the workbench directly", {
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
      console.warn("failed to publish ephemeral Linear activity; agent run continues", {
        sessionId,
        message: finalText(error instanceof Error ? error.message : String(error)),
      });
    });
  }

  private finish(sessionId: string, result: PiResult): Promise<void> {
    const outcome = result.disposition?.status === "blocked_external"
      ? "blocked externally"
      : result.disposition?.status === "deferred"
        ? "deferred"
        : result.ok ? "completed" : "failed";
    const footer = `\n\n_Run ${outcome} in ${elapsed(result.elapsedMs)}._`;
    const activity = this.linear.createActivity(sessionId, {
      type: result.ok || result.disposition?.status === "deferred" ? "response" : "error",
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
      const attention = [...state.attention];
      state.generation += 1;
      state.running = false;
      state.awaitingInput = false;
      state.startedAt = undefined;
      state.pending = undefined;
      state.active = undefined;
      this.touch(state);
      const cancellation = Promise.all([
        this.runner.abort(sessionId).then(() => undefined).catch((error: unknown) => {
          console.warn("failed to abort invalidated agent task", {
            sessionId,
            reason,
            message: error instanceof Error ? error.message : String(error),
          });
        }),
        this.dismissAttention(sessionId, state.issueId, attention, reason),
      ])
        .then(() => { state.attention = []; this.touch(state); });
      cancellations.push(cancellation);
    }
    await Promise.all(cancellations);
    await this.persist();
  }

  private async dismissAttention(
    sessionId: string,
    issueId: string | undefined,
    attention: ActiveAttention[],
    reason: string,
  ): Promise<void> {
    if (!attention.length) return;
    const item = attention[0]!;
    try {
      if (issueId) await this.linear.setIssueState(issueId, item.previousStateId);
      await this.linear.createActivity(sessionId, { type: "response", body: reason });
    } catch (error) {
      console.warn("failed to restore issue state while dismissing attention", {
        issueId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function githubPullRequestUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)?.[0];
}
