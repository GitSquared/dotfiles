import { ControllerStateStore, type ControllerSessionRecord } from "./controller-state.js";
import { attentionBlocking, attentionPriority, renderAttentionRequest, type ActiveAttention } from "./attention.js";
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
          interrupts: attention.filter((request) => request.delivery === "interrupt").length,
          queued: attention.filter((request) => request.delivery === "queue").length,
          steering: attention.filter((request) => request.kind === "steering").length,
          qa: attention.filter((request) => request.kind === "qa").length,
          blocking: attention.filter((request) => request.blocking).length,
          fyi: attention.filter((request) => !request.blocking).length,
          urgent: attention.filter((request) => request.priority === "urgent").length,
          unclassifiedAwaitingInput: sessions.filter((state) => state.awaitingInput && !state.attention.some((request) => request.blocking)).length,
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
      if (!state.issueId) throw new Error("Attention requests require an issue-backed Agent Session");
      if (attentionBlocking(request.request) && state.attention.some((attention) => attention.blocking)) {
        throw new Error("This Agent Session already has an unresolved blocking attention request");
      }
      const issue = await this.linear.createAttentionIssue(state.issueId, request.request, state.humanAssigneeId);
      const active: ActiveAttention = {
        kind: request.request.kind,
        delivery: request.request.delivery,
        priority: attentionPriority(request.request),
        blocking: attentionBlocking(request.request),
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        issueUrl: issue.url,
        requestedAt: Date.now(),
      };
      state.attention.push(active);
      this.touch(state);
      await this.persist();
      const attentionSession = await this.linear.createAgentSessionOnIssue(issue.id);
      active.sessionId = attentionSession.id;
      const options = request.request.options?.map(({ label, value }) => ({ label, value }));
      await this.linear.createActivity(attentionSession.id, {
        type: "elicitation",
        body: finalText(renderAttentionRequest(request.request)),
      }, options ? { signal: "select", signalMetadata: { options } } : {});
      const parentBody = `[${issue.identifier}: ${issue.title}](${issue.url}) was added to your attention queue.`;
      await this.linear.createActivity(sessionId, {
        type: active.blocking ? "elicitation" : "thought",
        body: active.blocking
          ? `${parentBody}\n\nThe parent run is waiting for your response there.`
          : `${parentBody}\n\nThis is an FYI; the parent run is continuing.`,
      });
      state.awaitingInput = state.attention.some((item) => item.blocking);
      this.touch(state);
      await this.persist();
      return { ok: true, action: request.action, data: active };
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
    const attentionRoute = this.findAttentionRoute(sessionId, session.issueId ?? session.issue?.id);
    if (attentionRoute) {
      await this.handleAttentionSession(payload, attentionRoute.parentSessionId, attentionRoute.state, attentionRoute.attention);
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
    if (payload.action === "prompted" && state.attention.some((attention) => attention.blocking)) {
      const resolved = state.attention.filter((attention) => attention.blocking);
      await Promise.all(resolved.map(async (attention) => {
        if (attention.sessionId) {
          await this.linear.createActivity(attention.sessionId, {
            type: "response",
            body: "The engineer replied directly in the parent Agent Session; the response was routed to the parent run.",
          }).catch(() => undefined);
        }
        await this.linear.completeIssue(attention.issueId).catch(() => undefined);
      }));
      state.attention = state.attention.filter((attention) => !attention.blocking);
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
      await this.dismissAttention(attention, "The parent Straylight run was stopped.");
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

  private findAttentionRoute(
    sessionId: string,
    issueId: string | undefined,
  ): { parentSessionId: string; state: SessionState; attention: ActiveAttention } | undefined {
    for (const [parentSessionId, state] of this.states) {
      const attention = state.attention.find((item) => item.sessionId === sessionId || (issueId && item.issueId === issueId));
      if (attention) return { parentSessionId, state, attention };
    }
    return undefined;
  }

  private async handleAttentionSession(
    payload: AgentSessionWebhook,
    parentSessionId: string,
    parentState: SessionState,
    attention: ActiveAttention,
  ): Promise<void> {
    const childSessionId = payload.agentSession?.id;
    if (!childSessionId) return;
    if (!attention.sessionId) attention.sessionId = childSessionId;
    if (payload.action === "created") {
      this.touch(parentState);
      await this.persist();
      return;
    }
    if (payload.action !== "prompted") return;
    const answer = payload.agentActivity?.content?.body?.trim();
    if (!answer) return;
    await this.linear.createActivity(childSessionId, {
      type: "response",
      body: attention.blocking
        ? "Response accepted and routed back to the parent Straylight run."
        : "Acknowledged. The parent run did not need to pause.",
    });
    await this.linear.completeIssue(attention.issueId);
    parentState.attention = parentState.attention.filter((item) => item !== attention);
    parentState.awaitingInput = false;
    this.touch(parentState);
    await this.persist();
    if (!attention.blocking) return;
    const snapshot = await this.linear.agentSessionSnapshot(parentSessionId);
    const routed = this.recoveryPayload(undefined, snapshot, false);
    if (payload.organizationId) routed.organizationId = payload.organizationId;
    routed.agentActivity = {
      content: {
        type: "prompt",
        body: `Human response from attention issue ${attention.issueIdentifier ?? attention.issueId}:\n\n${answer}`,
      },
    };
    await this.handle(routed);
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
        this.dismissAttention(attention, reason),
      ])
        .then(() => { state.attention = []; this.touch(state); });
      cancellations.push(cancellation);
    }
    await Promise.all(cancellations);
    await this.persist();
  }

  private async dismissAttention(attention: ActiveAttention[], reason: string): Promise<void> {
    await Promise.all(attention.map(async (item) => {
      try {
        if (item.sessionId) {
          await this.linear.createActivity(item.sessionId, {
            type: "response",
            body: reason,
          });
        }
        await this.linear.completeIssue(item.issueId);
      } catch (error) {
        console.warn("failed to close an attention issue", {
          issueId: item.issueId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }));
  }
}

export function githubPullRequestUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)?.[0];
}
