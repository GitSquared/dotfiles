import { ControllerStateStore, type ControllerSessionRecord } from "./controller-state.js";
import {
  attentionOptions,
  attentionPriority,
  isQaApproval,
  renderAttentionComment,
  renderDeferredItem,
  renderElicitationSummary,
  type ActiveAttention,
  type OpenAsk,
} from "./attention.js";
import { LinearClient, type AgentSessionSnapshot } from "./linear.js";
import type {
  LinearManageRequest,
  LinearManageResult,
  LinearSessionRequest,
  LinearSessionResult,
  LinearUploadRequest,
} from "./linear-actions.js";
import { claudeFollowUpPrompt } from "./prompts.js";
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
  openAsks: OpenAsk[];
  claudeConversationId: string | undefined;
  updatedAt: number;
};

type NotificationDisposition = "agentSessionOwned" | "contextOnly" | "acknowledgement" | "cancellation" | "lifecycle" | "unknown";

// A durable activity is the permanent record of a completed tool action, so a transient
// failure (Linear 5xx, a network blip, the 15s GRAPHQL_TIMEOUT_MS in src/linear.ts firing
// once) must not silently erase it the way an ephemeral status update can be. Same
// attempt count and backoff shape as putPreparedLinearUpload's asset retry in src/linear.ts.
const DURABLE_ACTIVITY_MAX_ATTEMPTS = 3;
const DURABLE_ACTIVITY_RETRY_BASE_MS = 250;

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

// A QA elicitation is the checkpoint ROADMAP.md Slice 18 calls for: still-open, non-blocking
// asks must surface here explicitly, not depend on Claude remembering to mention them in prose.
function renderOpenAsksSection(openAsks: OpenAsk[]): string | undefined {
  if (!openAsks.length) return undefined;
  return ["Still waiting on:", openAsks.map((ask) => `- ${ask.question}`).join("\n")].join("\n");
}

// Linear's own terminal states for an Agent Session (linear.app/developers/agent-best-practices):
// a session goes "stale" if the agent doesn't send a follow-up activity within 30 minutes of its
// first response, and that's recoverable simply by sending another activity - it isn't dead the
// way "complete"/"error" are. All three still mean the same thing to us here: nothing we're
// locally waiting on (an open Steering/QA reply) is still owed, because Linear itself has moved on.
function isTerminalSessionStatus(status: string): boolean {
  return ["complete", "stale", "error"].includes(status.toLowerCase());
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
  private readonly activityQueues = new Map<string, Promise<void>>();
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
  private durableActivityFailures = 0;
  private lastDurableActivityFailure: { sessionId: string; at: string; attempts: number; message: string } | undefined;

  constructor(
    private readonly linear: LinearClient,
    private readonly runner: AgentRunner,
    stateDirectory?: string,
    private readonly attentionStateName: string = "In Review",
    // Overridable so tests can skip the real delay - same shape as putPreparedLinearUpload's
    // injectable sleep in src/linear.ts.
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => Bun.sleep(milliseconds),
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
        openAsks: record.openAsks ?? [],
        claudeConversationId: record.claudeConversationId,
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
        if (isTerminalSessionStatus(status) || ["response", "error"].includes(latest?.content.type ?? "")) {
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
        const message = error instanceof Error ? error.message : String(error);
        console.warn("could not reconcile persisted Linear Agent Session", {
          sessionId: record.sessionId,
          message,
        });
        // We don't know this session's true state (Linear may just be unreachable), so stop
        // treating it as resumable - a stuck-forever "resume this" marker would keep it
        // occupying a slot in the 500-session cap on every restart (touch() below bumps it to
        // the front) while nobody is ever told it's stuck. Leave awaitingInput/attention alone:
        // those describe a real open Steering/QA wait we can't disprove from here, and are
        // still what lets a later human reply route back to this session correctly.
        state.pending = undefined;
        state.active = undefined;
        await this.enqueueActivity(record.sessionId, () => this.linear.createActivity(record.sessionId, {
          type: "error",
          body: finalText(`This session could not be recovered after a controller restart: ${message}`),
        }).catch((activityError: unknown) => {
          console.warn("failed to report an unrecoverable Agent Session", {
            sessionId: record.sessionId,
            message: activityError instanceof Error ? activityError.message : String(activityError),
          });
        }));
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
        ...(state.openAsks.length ? { openAsks: state.openAsks } : {}),
        ...(state.claudeConversationId ? { claudeConversationId: state.claudeConversationId } : {}),
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
        // A durable activity is the permanent record of what Claude did; publishActivity()
        // retries it with backoff before giving up (see there), but if every attempt fails
        // (Linear down, not just slow) the entry really is dropped and there is nothing else
        // that surfaces it - this counter and last-failure record are the only trace, and
        // only visible to whoever reads /healthz.
        durableActivities: {
          failures: this.durableActivityFailures,
          ...(this.lastDurableActivityFailure ? { lastFailure: this.lastDurableActivityFailure } : {}),
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
        const comment = renderAttentionComment(req);
        // Never blocks or touches issue status; urgent priority only adds a real Linear @mention (an Inbox notification) to the same comment.
        const mention = attentionPriority(req) === "urgent"
          ? await this.linear.issueAssigneeUrl(state.issueId).catch(() => null)
          : null;
        await this.linear.createIssueComment(state.issueId, finalText(mention ? `${mention}\n\n${comment}` : comment));
        return { ok: true, action: request.action };
      }
      if (state.attention.length) {
        throw new Error("This Agent Session already has an unresolved blocking attention request");
      }
      const previousState = await this.linear.issueState(state.issueId);
      const attentionStateId = await this.linear.resolveAttentionStateId(state.teamId, this.attentionStateName);
      await this.linear.setIssueState(state.issueId, attentionStateId);
      const options = attentionOptions(req)?.map(({ label, value }) => ({ label, value }));
      const signalPayload = req.accessRepair
        ? { signal: "auth" as const, signalMetadata: { url: req.accessRepair.url, providerName: req.accessRepair.providerName } }
        : options ? { signal: "select" as const, signalMetadata: { options } } : {};
      const openAsksSection = req.kind === "qa" ? renderOpenAsksSection(state.openAsks) : undefined;
      // Two different bodies, not one duplicated: the elicitation (the Agent Session's own
      // card, where the real select/auth buttons ride) stays a scannable one-liner; the full
      // title/action/recommendation/evidence/open-asks content lives only in the tracked issue
      // comment, which is also the surface for a human to dig further with follow-up questions.
      const commentBody = openAsksSection ? `${renderAttentionComment(req)}\n\n${openAsksSection}` : renderAttentionComment(req);
      await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, {
        type: "elicitation",
        body: finalText(renderElicitationSummary(req)),
      }, signalPayload));
      // A reply here now genuinely resolves the attention (unlike the pre-2026-08-19 version
      // of this, removed because replying to it silently did nothing), via the same
      // tracked-comment-reply-routing the ask tier already proved live.
      const comment = await this.linear.createIssueComment(state.issueId, finalText(commentBody)).catch((error: unknown) => {
        console.warn("failed to post the tracked attention comment; the native elicitation reply path still works", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      });
      const active: ActiveAttention = {
        kind: req.kind,
        priority: attentionPriority(req),
        previousStateId: previousState.id,
        requestedAt: Date.now(),
        ...(comment ? { commentId: comment.id } : {}),
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
      await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, request.content, {
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.signalMetadata ? { signalMetadata: request.signalMetadata } : {}),
      }));
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
    if (request.action === "react") {
      await this.linear.reactToComment(request.commentId, request.emoji).catch(() => undefined);
      return { ok: true, action: request.action };
    }
    if (request.action === "ask") {
      // Non-blocking, independently-trackable (ROADMAP.md Slice 18's "ask" tier): unlike
      // "attention", this never touches awaitingInput or issue status, so any number can be
      // open at once - a reply lands on this specific comment's own thread, which carries its
      // own resolved/unresolved state independent of every other open ask or the session's
      // single native status field.
      const issueId = requiredIssueId(state.issueId, "Asking a non-blocking question");
      const comment = await this.linear.createIssueComment(issueId, finalText(request.question));
      state.openAsks = [...state.openAsks, { commentId: comment.id, question: request.question, askedAt: Date.now() }];
      this.touch(state);
      await this.persist();
      return { ok: true, action: request.action, data: { commentId: comment.id } };
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
      await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, {
        type: "thought",
        body: `[${document.title}](${document.url}) is ready for review.`,
      }));
      return { ok: true, action: request.action, data: document };
    }
    if (!state.issueId) throw new Error("Linear issue attachments require an issue-backed Agent Session");
    const attachment = await this.linkAttachment(sessionId, state.issueId, request.publication);
    await this.linear.addExternalUrl(sessionId, { label: attachment.title, url: attachment.url });
    return { ok: true, action: request.action, data: attachment };
  }

  /**
   * Links a "publish" attachment, preferring Linear's integration-aware rich mutations
   * (live PR/CI status, etc) over the generic createIssueAttachment - anti-fragile by
   * design: any failure in a richer attempt falls through to the next, ending at the
   * generic call, which is the only one that supports subtitle/commentBody (so an
   * attachment carrying either skips straight to it, unattempted). The caller always gets
   * an attachment back or a thrown error from the final, always-supported fallback; nothing
   * about a rich attempt failing is hidden - `richness` and `fallbackReason` report exactly
   * what happened so Claude never claims live status sync it didn't actually get.
   */
  private async linkAttachment(
    sessionId: string,
    issueId: string,
    publication: { title: string; url: string; subtitle?: string; body?: string },
  ): Promise<{ id: string; title: string; url: string; richness: "github_pr" | "url" | "basic"; fallbackReason?: string }> {
    const eligibleForRichLink = !publication.subtitle && !publication.body;
    const isPullRequest = eligibleForRichLink && Boolean(githubPullRequestUrl(publication.url));
    let attemptedRichLink = false;
    if (isPullRequest) {
      attemptedRichLink = true;
      try {
        const attachment = await this.linear.linkGitHubPullRequestAttachment(issueId, publication.url, publication.title);
        return { ...attachment, richness: "github_pr" };
      } catch (error) {
        console.warn("rich GitHub pull request attachment failed; falling back", {
          sessionId,
          issueId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (eligibleForRichLink) {
      attemptedRichLink = true;
      try {
        const attachment = await this.linear.linkUrlAttachment(issueId, publication.url, publication.title);
        return { ...attachment, richness: "url" };
      } catch (error) {
        console.warn("rich URL attachment failed; falling back to a basic attachment", {
          sessionId,
          issueId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const attachment = await this.linear.createIssueAttachment(issueId, {
      title: publication.title,
      url: publication.url,
      ...(publication.subtitle ? { subtitle: publication.subtitle } : {}),
      ...(publication.body ? { commentBody: publication.body } : {}),
      agentSessionId: sessionId,
    });
    return {
      ...attachment,
      richness: "basic",
      ...(attemptedRichLink ? { fallbackReason: "a richer Linear attachment link failed; used a basic attachment instead" } : {}),
    };
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
      openAsks: [],
      claudeConversationId: undefined,
      updatedAt: Date.now(),
    };
    state.issueId = session.issueId ?? session.issue?.id ?? state.issueId;
    state.teamId = session.issue?.teamId ?? session.issue?.team?.id ?? state.teamId;
    const appUserId = payload.appUserId ?? session.appUserId;
    if (session.creatorId && session.creatorId !== appUserId) state.humanAssigneeId = session.creatorId;
    if (!isStopRequest(payload) && state.attention.length) {
      // We only ever check a session's live status once, at controller startup (initialize()
      // above). Between restarts - the normal long-running case - an open Steering/QA wait we
      // think is still pending could have gone stale or complete on Linear's own side (see the
      // note on isTerminalSessionStatus above) with nothing telling us. Rather than add a new
      // polling loop, piggyback on whatever webhook this session next receives - mention, reply,
      // anything - to opportunistically recheck before deciding how to handle it. Deliberately
      // status-only (unlike initialize()'s startup check, which also looks at the latest activity
      // type): a healthy, still-open elicitation is legitimately the latest non-ephemeral activity
      // on this session (finish() is skipped while awaitingInput is true), so reusing that heuristic
      // here would risk clearing a perfectly live wait. And deliberately bookkeeping-only - no
      // issue-state restore, no activity post - since we can't tell a stale wait from an issue a
      // human already resolved by other means, and posting an activity to a stale session would
      // itself un-stale it per Linear's docs, which isn't what "reconcile" should mean here.
      try {
        const snapshot = await this.linear.agentSessionSnapshot(sessionId);
        if (isTerminalSessionStatus(snapshot.status)) {
          console.info("Linear reports this Agent Session as no longer live; clearing a local Steering/QA wait it can never resolve", {
            sessionId,
            status: snapshot.status,
          });
          state.attention = [];
          state.awaitingInput = false;
          state.pending = undefined;
          state.active = undefined;
          this.touch(state);
        }
      } catch (error) {
        console.warn("could not opportunistically recheck a paused Agent Session's live status; leaving the local wait as-is", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (payload.action === "prompted" && state.attention.length) {
      const attention = state.attention[0]!;
      if (session.comment?.parentId) {
        // A reply landed on some other pre-existing comment thread (e.g. a
        // side question on an earlier Signal), not on this session's own
        // elicitation. Don't treat it as the answer - the run stays paused
        // waiting for a real reply through the session itself.
        this.touch(state);
        this.states.set(sessionId, state);
        await this.persist();
        return;
      }
      const answer = payload.agentActivity?.content?.body?.trim() ?? "";
      const replyCommentId = session.comment?.id;
      state.attention = [];
      if (attention.kind === "qa" && isQaApproval(answer) && state.issueId) {
        await this.approveQa(sessionId, state, state.issueId, replyCommentId);
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
      if (replyCommentId) await this.linear.reactToComment(replyCommentId, "white_check_mark").catch(() => undefined);
      await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, {
        type: "thought",
        body: "Reply received; resuming the run.",
      }).catch(() => undefined));
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
      await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, {
        type: "error",
        body: aborted || wasRunning ? `Stopped by user${suffix}.` : "Stop requested; no active agent run was in progress.",
      }));
      return;
    }

    if (payload.action !== "created" && payload.action !== "prompted") {
      await this.persist();
      return;
    }
    if (payload.action === "prompted" && state.running) {
      const inputs = await this.prepareLinearInputs(sessionId, payload);
      if (await this.runner.followUp(sessionId, claudeFollowUpPrompt(payload), inputs)) {
        state.active = payload;
        this.touch(state);
        await this.persist();
        await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, { type: "thought", body: "Your follow-up is queued in the active agent session." }).catch(() => undefined));
      } else {
        state.pending = payload;
        this.touch(state);
        await this.persist();
        await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, { type: "thought", body: "Your follow-up will run after the current agent turn." }).catch(() => undefined));
      }
      return;
    }
    if (payload.action === "created" && state.issueId) {
      const sibling = this.findActiveSiblingSession(sessionId, state.issueId);
      if (sibling) {
        payload.guidance = [
          ...(payload.guidance ?? []),
          {
            body: `This issue already has another Straylight Agent Session that is ${sibling}. This new mention may be about that same ongoing work rather than a separate task - check before assuming it's unrelated, and avoid duplicating effort already in progress there.`,
          },
        ];
      }
    }
    await this.start(sessionId, payload, state);
  }

  private findActiveSiblingSession(sessionId: string, issueId: string): string | undefined {
    for (const [otherId, other] of this.states) {
      if (otherId === sessionId || other.issueId !== issueId) continue;
      if (other.attention.length) return "paused, awaiting a Steering/QA reply";
      if (other.running) return "actively running";
      if (other.awaitingInput) return "awaiting input";
    }
    return undefined;
  }

  /**
   * A fresh mention on an issue that already has a dormant conversation
   * elsewhere gets routed into the same Claude Code session instead of
   * starting blind - resuming is only safe while no sibling on this issue
   * is mid-turn, since two runs cannot safely share one SDK conversation.
   */
  private findResumableConversation(sessionId: string, issueId: string): string | undefined {
    let best: SessionState | undefined;
    for (const [otherId, other] of this.states) {
      if (otherId === sessionId || other.issueId !== issueId) continue;
      if (!other.claudeConversationId) continue;
      if (other.running) return undefined;
      if (!best || other.updatedAt > best.updatedAt) best = other;
    }
    return best?.claudeConversationId;
  }

  /**
   * Routes a plain issue-comment reply back to the agent if - and only if - it landed on a
   * comment thread this session itself opened via the non-blocking "ask" tier (ROADMAP.md
   * Slice 18). Every other reply stays context-only, unchanged: this is deliberately narrow,
   * not a general re-opening of "any reply wakes the agent," which would reintroduce the
   * noise the ask tier exists to avoid.
   */
  /**
   * Routes a plain issue-comment reply back to the agent if - and only if - it landed on a
   * comment thread this session itself is tracking: either the real comment posted alongside
   * a blocking Steering/QA elicitation, or a non-blocking "ask" (ROADMAP.md Slice 18). Every
   * other reply stays context-only, unchanged: this is deliberately narrow, not a general
   * re-opening of "any reply wakes the agent."
   */
  private async routeTrackedCommentReply(payload: AppUserNotificationWebhook, issueId: string | undefined): Promise<boolean> {
    const replyCommentId = payload.notification?.commentId ?? payload.notification?.comment?.id;
    const parentId = payload.notification?.comment?.parentId ?? payload.notification?.parentCommentId;
    const body = payload.notification?.comment?.body?.trim();
    const actorId = payload.notification?.actorId;
    if (!issueId || !replyCommentId || !parentId || !body) return false;
    if (payload.appUserId && actorId === payload.appUserId) return false; // ignore the app's own comments, if it ever posts one that would match
    for (const [sessionId, state] of this.states) {
      if (state.issueId !== issueId) continue;
      if (state.attention[0]?.commentId === parentId) {
        // A reply to the tracked attention comment resolves exactly like a reply to the
        // elicitation's own native surface - reuse handle()'s existing prompted/attention
        // logic (isQaApproval, restoring issue status, the checkmark reaction, etc.) rather
        // than re-implementing it, by constructing the same shape that path already expects.
        try {
          await this.handle({
            action: "prompted",
            agentSession: { id: sessionId, issueId, comment: { id: replyCommentId, body } },
            agentActivity: { content: { body } },
          });
        } catch (error) {
          console.error("failed to resolve a blocking attention from its tracked comment's reply", {
            sessionId,
            issueId,
            commentId: parentId,
            message: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
        this.recordNotification("issueNewComment", "agentSessionOwned");
        console.info("Linear comment reply matched the tracked attention comment; resolving", { sessionId, issueId, commentId: parentId });
        return true;
      }
      const ask = state.openAsks.find((item) => item.commentId === parentId);
      if (!ask) continue;
      if (state.attention.length) {
        // A blocking Steering/QA is already open on this same session - don't fight that
        // resume path by injecting an unrelated follow-up. The ask stays open and will still
        // surface as an unanswered tracked question at checkpoint.
        return false;
      }
      state.openAsks = state.openAsks.filter((item) => item.commentId !== parentId);
      this.touch(state);
      this.states.set(sessionId, state);
      await this.persist();
      await this.linear.reactToComment(replyCommentId, "white_check_mark").catch(() => undefined);
      try {
        await this.handle({
          action: "prompted",
          agentSession: { id: sessionId, issueId, comment: { id: replyCommentId, body } },
          agentActivity: { content: { body: `Reply to your open question "${ask.question}":\n\n${body}` } },
        });
      } catch (error) {
        // Restore the tracked ask rather than let a human's answer vanish silently - losing
        // track of it is worse than the small chance of a duplicate resume on a later retry.
        state.openAsks = [...state.openAsks, ask];
        this.touch(state);
        await this.persist().catch(() => undefined);
        console.error("failed to resume the agent with a tracked ask's reply", {
          sessionId,
          issueId,
          commentId: parentId,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
      this.recordNotification("issueNewComment", "agentSessionOwned");
      console.info("Linear comment reply matched a tracked open question; resuming", { sessionId, issueId, commentId: parentId });
      return true;
    }
    return false;
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
      if (await this.routeTrackedCommentReply(payload, issueId)) return;
      this.recordNotification(action, "contextOnly");
      console.info("Linear comment notification retained as context; no prompt was synthesized", { issueId });
      return;
    }
    if (["issueEmojiReaction", "issueCommentReaction"].includes(action)) {
      this.recordNotification(action, "acknowledgement");
      console.info("Linear reaction notification observed as acknowledgement", { action, issueId });
      // Only an issue-level reaction can stand in for "react to the QA elicitation": Linear has
      // no way to react to an Agent Activity directly (see RESEARCH.md), so issueCommentReaction
      // is left as a pure acknowledgement - scoping it to "any comment on the issue" would be a
      // misleading half-measure, since no comment actually represents the elicitation itself.
      if (action === "issueEmojiReaction" && issueId) {
        await this.handleQaReactionApproval(issueId, payload.notification?.reactionEmoji, payload.notification?.actorId, payload.appUserId);
      }
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
          const linkedIssueId = payload.notification?.issueId ?? payload.notification?.issue?.id;
          if (linkedIssueId) {
            const question = payload.notification?.comment?.body?.trim();
            await this.linear.createIssueComment(
              linkedIssueId,
              finalText([
                "A mention on this issue's linked Document didn't reach me - Linear doesn't yet support Agent Sessions on Document comment threads.",
                question ? `The question there was:\n> ${question}` : undefined,
                "Ask here on the issue instead and I'll see it.",
              ].filter((line): line is string => Boolean(line)).join("\n\n")),
            ).catch((commentError: unknown) => {
              console.warn("failed to post the Document-mention fallback comment", {
                documentId,
                linkedIssueId,
                message: commentError instanceof Error ? commentError.message : String(commentError),
              });
            });
          }
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
    if (["pullRequestMention", "pullRequestCommentMention"].includes(action)) {
      // Linear's native GitHub/GitLab PR-sync integration (distinct from this app's own
      // githubPullRequestUrl regex-scrape and linear_activity publish path) has no way to
      // route a mention on a PR thread to an Agent Session - only issue-backed threads support
      // that. The payload still carries the linked issue, so post the same kind of courtesy
      // fallback documentCommentMention posts when Linear can't route it either.
      if (!issueId) {
        this.recordNotification(action, "unknown");
        console.warn("Linear PR mention notification did not include a linked issue id", { action });
        return;
      }
      this.recordNotification(action, "contextOnly");
      const question = payload.notification?.comment?.body?.trim();
      await this.linear.createIssueComment(
        issueId,
        finalText([
          "A mention on a linked pull request didn't reach me - Linear doesn't yet route pull request comment threads to an Agent Session.",
          question ? `The comment there was:\n> ${question}` : undefined,
          "Mention me here on the issue instead and I'll see it.",
        ].filter((line): line is string => Boolean(line)).join("\n\n")),
      ).catch((commentError: unknown) => {
        console.warn("failed to post the PR-mention fallback comment", {
          action,
          issueId,
          message: commentError instanceof Error ? commentError.message : String(commentError),
        });
      });
      console.info("Linear PR mention notification received a fallback comment on the linked issue", { action, issueId });
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
    // issueStatusChangedAll is the same underlying event as issueStatusChanged - the "all
    // activity" notification-preference variant Linear's schema lists alongside the
    // specific one (the same specific-vs-all pairing pattern seen elsewhere in Linear's
    // notification types), not a different occurrence. Treat them identically so the
    // safety net that stops a session when its issue closes fires however Linear delivers it.
    if (action === "issueStatusChanged" || action === "issueStatusChangedAll") {
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
    // Mirrors the document-prefix catch-all above: every other issue-adjacent "Other"
    // notification type (issueReopened, issueBlocking, issueDue, issueSlaBreached, etc.)
    // carries useful context but synthesizes no prompt, so record it as such instead of
    // leaving it indistinguishable from genuinely unrecognized noise in the unknown bucket.
    if (action.startsWith("issue")) {
      this.recordNotification(action, "contextOnly");
      console.info("Linear issue notification retained as context; no prompt was synthesized", { action, issueId });
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
      await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, { type: "error", body: finalText(`Agent run crashed: ${message}`) }).catch(() => undefined));
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
    if (payload.action === "created" && state.issueId) {
      const resumable = this.findResumableConversation(sessionId, state.issueId);
      if (resumable) taskPayload.resumeConversationId = resumable;
    }
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
      await this.publishActivity(sessionId, event.content, event.ephemeral);
    });
    if (state.generation !== generation) return;
    if (!result.awaitingInput) {
      await this.finish(sessionId, result);
    }
    state.running = false;
    state.awaitingInput = result.awaitingInput;
    state.startedAt = undefined;
    state.active = undefined;
    if (result.conversationId) state.claudeConversationId = result.conversationId;
    const pending = state.pending;
    if (pending && state.attention.length) {
      // A queued follow-up (e.g. a non-blocking ask's reply, arriving while this run was
      // still going) must not auto-start a new turn the instant this one ends in a fresh
      // blocking Steering/QA - that turn would have nothing left to do but discover the
      // "already open" collision (request_attention rejects a second concurrent one) and
      // fail to conclude cleanly. Confirmed live (GAB-15): this is exactly how "Claude ended
      // without a structured work disposition" happened right after a QA request. Leave it
      // queued; it starts normally once the attention resolves and the session is genuinely
      // idle again.
      this.touch(state);
      await this.persist();
      return;
    }
    state.pending = undefined;
    this.touch(state);
    await this.persist();
    if (pending) await this.start(sessionId, pending, state);
  }

  private async createEphemeralActivity(
    sessionId: string,
    content: Parameters<LinearClient["createActivity"]>[1],
  ): Promise<void> {
    await this.publishActivity(sessionId, content, true);
  }

  /**
   * Linear derives an Agent Session's displayed status from whichever Activity landed last,
   * not whichever was requested last (its own docs: "session lifecycle... based on the last
   * emitted activity"). Two independent paths post Activities for the same session - narration
   * (via publishActivity below, which retries a durable post for up to ~46s) and direct calls
   * like the attention elicitation (no retry) - with no ordering guarantee between them
   * otherwise. A slow retry that started before the elicitation can finish after it, silently
   * superseding the elicitation (and whatever button UI a signal like "select" put on it) the
   * moment it lands. Chaining every poster onto its own session's tail guarantees Linear only
   * ever observes activities in true submission order, at the cost of a later post genuinely
   * waiting for an earlier one still retrying - which is correct: arriving late with the right
   * status beats arriving on time with one that then silently reverts.
   */
  private enqueueActivity(sessionId: string, post: () => Promise<void>): Promise<void> {
    const previous = this.activityQueues.get(sessionId) ?? Promise.resolve();
    const settled = previous.then(post, post);
    this.activityQueues.set(sessionId, settled.catch(() => undefined));
    return settled;
  }

  private publishActivity(
    sessionId: string,
    content: Parameters<LinearClient["createActivity"]>[1],
    ephemeral: boolean,
  ): Promise<void> {
    return this.enqueueActivity(sessionId, () => this.deliverActivity(sessionId, content, ephemeral));
  }

  private async deliverActivity(
    sessionId: string,
    content: Parameters<LinearClient["createActivity"]>[1],
    ephemeral: boolean,
  ): Promise<void> {
    if (ephemeral) {
      // Unchanged best-effort, no-retry behavior: an ephemeral status update is about to be
      // replaced by the next one anyway, so retrying a dropped one would be pointless.
      await this.linear.createActivity(sessionId, content, { ephemeral: true }).catch((error: unknown) => {
        console.warn("failed to publish ephemeral Linear activity; agent run continues", {
          sessionId,
          message: finalText(error instanceof Error ? error.message : String(error)),
        });
      });
      return;
    }
    // Retried inline and awaited (not handed to a background queue) so the durable log this
    // produces stays chronological: a later activity for the same session must never be
    // observed by Linear before an earlier one still being retried. This does mean a run
    // that keeps hitting failures can block here for a while - worst case is
    // DURABLE_ACTIVITY_MAX_ATTEMPTS attempts, each up to GRAPHQL_TIMEOUT_MS (15s), plus the
    // backoff sleeps between them (~46s total) - which is judged an acceptable, bounded cost
    // for not silently losing part of the permanent record.
    let lastMessage = "unknown failure";
    for (let attempt = 1; attempt <= DURABLE_ACTIVITY_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.linear.createActivity(sessionId, content, { ephemeral: false });
        return;
      } catch (error) {
        lastMessage = finalText(error instanceof Error ? error.message : String(error));
        if (attempt >= DURABLE_ACTIVITY_MAX_ATTEMPTS) break;
        console.warn("failed to publish durable Linear activity; retrying", {
          sessionId,
          attempt,
          maxAttempts: DURABLE_ACTIVITY_MAX_ATTEMPTS,
          message: lastMessage,
        });
        await this.sleep(DURABLE_ACTIVITY_RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
    this.durableActivityFailures += 1;
    this.lastDurableActivityFailure = {
      sessionId,
      at: new Date().toISOString(),
      attempts: DURABLE_ACTIVITY_MAX_ATTEMPTS,
      message: lastMessage,
    };
    console.error("durable Linear activity permanently dropped after exhausting retries; agent run continues", {
      sessionId,
      attempts: DURABLE_ACTIVITY_MAX_ATTEMPTS,
      message: lastMessage,
    });
  }

  private finish(sessionId: string, result: PiResult): Promise<void> {
    const outcome = result.disposition?.status === "blocked_external"
      ? "blocked externally"
      : result.disposition?.status === "deferred"
        ? "deferred"
        : result.ok ? "completed" : "failed";
    const footer = `\n\n_Run ${outcome} in ${elapsed(result.elapsedMs)}._`;
    const activity = this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, {
      type: result.ok || result.disposition?.status === "deferred" ? "response" : "error",
      body: finalText(`${result.summary}${footer}`),
    }));
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
      await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, {
        type: "action",
        action: "Prepared Linear inputs",
        parameter: `${download.inputs.length} accepted · ${download.skipped.length} skipped`,
        result: finalText(result),
      }).catch((error: unknown) => {
        console.warn("could not report prepared Linear inputs", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      }));
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
    if (issueId) {
      try {
        await this.linear.setIssueState(issueId, item.previousStateId);
      } catch (error) {
        console.warn("failed to restore issue state while dismissing attention", {
          issueId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    try {
      await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, { type: "response", body: reason }));
    } catch (error) {
      console.warn("failed to post attention dismissal activity", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Completes the parent work for an approved QA attention. Shared by the two ways a human
   * can approve: replying with the exact QA_APPROVE_VALUE text (handled inline in `handle()`),
   * and reacting with a checkmark emoji (handled by `handleQaReactionApproval` below). Callers
   * are responsible for having already cleared `state.attention` and for confirming the
   * attention being resolved was actually a QA (not a Steering) request.
   */
  private async approveQa(sessionId: string, state: SessionState, issueId: string, ackCommentId?: string): Promise<void> {
    await this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, {
      type: "response",
      body: "QA approved. The delegated work is complete.",
    }).catch(() => undefined));
    await this.linear.completeIssue(issueId).catch((error: unknown) => {
      console.warn("failed to complete approved QA issue", {
        sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    if (ackCommentId) await this.linear.reactToComment(ackCommentId, "white_check_mark").catch(() => undefined);
    state.awaitingInput = false;
    this.touch(state);
    this.states.set(sessionId, state);
    await this.persist();
  }

  /**
   * A checkmark reaction on the issue holding an open QA attention approves it exactly like
   * replying with the approve text - see RESEARCH.md's "Reaction-based QA approval" entry for
   * why an issue-level reaction (rather than a reaction on the elicitation itself) is the only
   * signal Linear can actually deliver here.
   */
  private async handleQaReactionApproval(
    issueId: string,
    emoji: string | undefined,
    actorId: string | undefined,
    appUserId: string | undefined,
  ): Promise<void> {
    if (emoji !== "white_check_mark") return;
    if (appUserId && actorId === appUserId) return; // ignore the app's own reactions, if it ever adds any
    const matches = [...this.states].filter(([, state]) => state.issueId === issueId && state.attention[0]?.kind === "qa");
    for (const [sessionId, state] of matches) {
      // This is a consequential, auto-approving action taken on a coarse (issue-level, not
      // elicitation-level) signal - log it distinctly from the generic acknowledgement line
      // above so a wrongly-completed issue can actually be traced back to the reaction that did it.
      console.info("Linear checkmark reaction approved an open QA attention", { sessionId, issueId, actorId });
      state.attention = [];
      await this.approveQa(sessionId, state, issueId);
    }
  }
}

export function githubPullRequestUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)?.[0];
}
