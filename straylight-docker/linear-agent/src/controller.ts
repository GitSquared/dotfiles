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
import { finalText, progressText } from "./redaction.js";
import type { AgentRunner, PullRequestReview } from "./runner-client.js";
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

// GAB-26: a reply landed on a blocking Steering/QA attention, but the controller isn't
// unilaterally sure yet whether it was the real decision or just discussion - this is the
// bookkeeping that lets it defer restoring the issue's pre-attention state and resolving the
// discussion's tracked comment thread until the resumed turn it fed genuinely concludes. See
// settlePendingAttentionResolution.
type PendingAttentionResolution = {
  // The issue's state before the very first attention opened in this still-open discussion -
  // never overwritten by a later continuation round, since by then the issue's "current"
  // state is just the attention state itself, not a real value to restore to.
  previousStateId: string;
  // The discussion's own root tracked comment, so every later round threads a reply under it
  // (GAB-24) instead of opening a disconnected new top-level comment, and so there is exactly
  // one thread to resolve once the discussion is genuinely settled.
  rootCommentId?: string;
};

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
  pullRequest: { url: string; owner: string; repo: string; number: number; lastKnownReviewAt: string | undefined } | undefined;
  pendingAttentionResolution: PendingAttentionResolution | undefined;
  updatedAt: number;
};

type NotificationDisposition = "agentSessionOwned" | "contextOnly" | "acknowledgement" | "cancellation" | "lifecycle" | "unknown";

// A durable activity is the permanent record of a completed tool action, so a transient
// failure (Linear 5xx, a network blip, the 15s GRAPHQL_TIMEOUT_MS in src/linear.ts firing
// once) must not silently erase it the way an ephemeral status update can be. Same
// attempt count and backoff shape as putPreparedLinearUpload's asset retry in src/linear.ts.
const DURABLE_ACTIVITY_MAX_ATTEMPTS = 3;
const DURABLE_ACTIVITY_RETRY_BASE_MS = 250;
// A day past the longest real Claude subscription rate-limit window
// (seven_day) - a safety cap on the scheduled auto-resume delay, not a
// reflection of any specific plan's actual limit.
const MAX_AUTO_RESUME_DELAY_MS = 8 * 24 * 60 * 60 * 1_000;

// A GitHub review body is untrusted external text, same category as the repository files and
// web pages prompts.ts already tells the model never to treat as instructions - bounded the
// same way as any other untrusted text folded into a dispatched message, not forwarded verbatim.
function boundedReviewBody(body: string): string {
  return body.trim() ? progressText(body) : "(no comment body)";
}

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
  private pullRequestReviewTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly linear: LinearClient,
    private readonly runner: AgentRunner,
    stateDirectory?: string,
    private readonly attentionStateName: string = "In Review",
    // Overridable so tests can skip the real delay - same shape as putPreparedLinearUpload's
    // injectable sleep in src/linear.ts.
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => Bun.sleep(milliseconds),
    // Slice 23: how often the single global loop polls reviews for every tracked PR (no gh
    // CLI watch primitive exists for reviews, unlike checks). 0 disables polling entirely -
    // tests that never register a PR never pay for it regardless, since the timer is started
    // lazily on first registration, not here.
    private readonly reviewPollIntervalMs: number = 90_000,
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
        pullRequest: record.pullRequest ? { ...record.pullRequest, lastKnownReviewAt: record.pullRequest.lastKnownReviewAt } : undefined,
        pendingAttentionResolution: record.pendingAttentionResolution,
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
          // Only a genuinely terminal Linear status stops the watch - a session that merely
          // posted its latest response/error and went quiet can still be woken by a later
          // CI/review dispatch through handle()'s own cold-resume path, the same as any other
          // dormant session.
          if (isTerminalSessionStatus(status)) state.pullRequest = undefined;
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
      // The runner's own watch state (an in-memory gh pr checks --watch child) does not
      // survive a runner restart, independent of whether the controller itself restarted -
      // re-arm it here so a surviving tracked PR is never silently orphaned by the other
      // process bouncing.
      if (state.pullRequest) {
        this.ensurePullRequestReviewPolling();
        this.runner.watchPullRequestChecks?.(record.sessionId, state.pullRequest.url).catch((error: unknown) => {
          console.warn("failed to re-register a pull request watch after recovery", {
            sessionId: record.sessionId,
            message: error instanceof Error ? error.message : String(error),
          });
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
        ...(state.openAsks.length ? { openAsks: state.openAsks } : {}),
        ...(state.claudeConversationId ? { claudeConversationId: state.claudeConversationId } : {}),
        ...(state.pullRequest ? {
          pullRequest: {
            url: state.pullRequest.url,
            owner: state.pullRequest.owner,
            repo: state.pullRequest.repo,
            number: state.pullRequest.number,
            ...(state.pullRequest.lastKnownReviewAt ? { lastKnownReviewAt: state.pullRequest.lastKnownReviewAt } : {}),
          },
        } : {}),
        ...(state.pendingAttentionResolution ? { pendingAttentionResolution: state.pendingAttentionResolution } : {}),
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
      // GAB-26/GAB-24: if a discussion is still open from an earlier round on this same
      // session (a human reply the controller deliberately hasn't resolved yet - see
      // settlePendingAttentionResolution below), this new attention is a continuation of
      // that same conversation, not an unrelated fresh one. Re-querying the issue's current
      // state now would just capture "In Review" itself (the attention state, not the real
      // pre-attention one), so reuse the discussion's original previousStateId instead, and
      // thread the tracked comment as a reply under the discussion's own root comment rather
      // than opening a disconnected new top-level comment (GAB-24: "the agent had to post a
      // new top-level task comment instead of being able to answer my question in-thread").
      const continuation = state.pendingAttentionResolution;
      const previousStateId = continuation?.previousStateId ?? (await this.linear.issueState(state.issueId)).id;
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
      const comment = await (continuation?.rootCommentId
        ? this.linear.replyToIssueComment(state.issueId, continuation.rootCommentId, finalText(commentBody))
        : this.linear.createIssueComment(state.issueId, finalText(commentBody))
      ).catch((error: unknown) => {
        console.warn("failed to post the tracked attention comment; the native elicitation reply path still works", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      });
      const active: ActiveAttention = {
        kind: req.kind,
        priority: attentionPriority(req),
        previousStateId,
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
    if (attachment.richness === "github_pr") this.registerPullRequestWatch(sessionId, state, attachment.url);
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
      pullRequest: undefined,
      pendingAttentionResolution: undefined,
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
      const attentionCommentId = attention.commentId;
      state.attention = [];
      if (attention.kind === "qa" && isQaApproval(answer) && state.issueId) {
        await this.approveQa(sessionId, state, state.issueId, replyCommentId, attentionCommentId);
        return;
      }
      if (replyCommentId) await this.linear.reactToComment(replyCommentId, "white_check_mark").catch(() => undefined);
      // GAB-26: a reply to a Steering/QA elicitation might be the actual decision, or it might
      // just be a follow-up question - weighing options or asking for clarification before
      // deciding. The controller can't tell those apart from the text alone (unlike the
      // QA-approval fast path above, which is an unambiguous structured signal), and guessing
      // wrong is exactly the GAB-25 bug: a reply that was really a question got the thread
      // auto-resolved, the issue dropped out of its attention status, and a fresh run started,
      // all before the question was ever actually answered. So this only reacts with an
      // immediate checkmark - true receipt acknowledgement, not resolution - and defers the
      // real "decision landed" bookkeeping (issue-state restore, thread resolve) until the
      // resumed turn this reply feeds into actually concludes without needing to raise another
      // blocking attention of its own. See settlePendingAttentionResolution, called from
      // execute()'s normal completion path, start()'s crash handler, and the stop/cancellation
      // paths. Chained across possibly several rounds of discussion on the same original
      // attention (only the oldest previousStateId and the discussion's root comment id are
      // kept, not overwritten by each new round), rather than resolving one round at a time and
      // leaving the issue's own state field bouncing between attention and non-attention while
      // a single conversation is still ongoing.
      const rootCommentId = state.pendingAttentionResolution?.rootCommentId ?? attentionCommentId;
      state.pendingAttentionResolution = {
        previousStateId: state.pendingAttentionResolution?.previousStateId ?? attention.previousStateId,
        ...(rootCommentId ? { rootCommentId } : {}),
      };
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
      const hadPullRequest = Boolean(state.pullRequest);
      state.pullRequest = undefined;
      this.touch(state);
      await this.persist();
      const aborted = await this.runner.abort(sessionId).catch((error: unknown) => {
        console.warn("failed to abort stopped agent task", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      });
      if (hadPullRequest) {
        await this.runner.abortPullRequestWatch?.(sessionId).catch((error: unknown) => {
          console.warn("failed to abort a pull request watch for a stopped session", {
            sessionId,
            message: error instanceof Error ? error.message : String(error),
          });
        });
      }
      await this.dismissAttention(sessionId, state.issueId, attention, "The parent Straylight run was stopped.", true);
      // GAB-26: dismissAttention already restored issue state from `attention` above when
      // there was one currently open; only fall back to the deferred discussion's own
      // previousStateId when there wasn't (a stop landing in the window between a reply and
      // its resumed turn concluding), so the issue doesn't stay stuck in "In Review" forever.
      // Never resolves the thread here either way - a stopped session's still-open question
      // stays visible, matching dismissAttention's own convention.
      await this.settlePendingAttentionResolution(sessionId, state, { restoreIssueState: !attention.length, resolveThread: false });
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
      // The open question this thread existed to get answered now has been - resolve it the
      // same way a human would via the comment's "..." menu (GAB-22).
      await this.linear.resolveComment(parentId).catch(() => undefined);
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
      let bridgedViaIssue = false;
      try {
        session = await this.linear.createAgentSessionOnComment(rootCommentId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("comment must be on an issue") && !message.includes("comment threads on issues")) {
          this.notificationThreadSources.delete(rootCommentId);
          throw error;
        }
        // GAB-28: Linear permanently rejects an Agent Session anchored directly on a Document
        // comment thread. A genuine human @-mention here still needs to wake an agent, not
        // just leave an apology - bridge onto the Document's linked issue instead, true for
        // every issue-backed work-record Document this app creates. The notification doesn't
        // reliably carry that linked issue id even when one exists (confirmed live on GAB-28:
        // the Document had `issue.id` set, but the webhook payload didn't), so ask Linear
        // directly rather than trusting the payload alone.
        let linkedIssueId = payload.notification?.issueId ?? payload.notification?.issue?.id;
        if (!linkedIssueId && documentId) {
          try {
            linkedIssueId = await this.linear.documentLinkedIssueId(documentId);
          } catch (lookupError) {
            console.warn("failed to resolve the Document's linked issue", {
              documentId,
              message: lookupError instanceof Error ? lookupError.message : String(lookupError),
            });
          }
        }
        if (!linkedIssueId) {
          this.notificationThreadSources.delete(rootCommentId);
          // No issue to bridge through - the only remaining human-visible option is a plain
          // reply directly in the Document's own thread; that needs no Agent Session at all.
          try {
            await this.linear.replyToComment(
              rootCommentId,
              "Linear doesn't yet support Agent Sessions on Document comment threads, and this Document has no linked issue to bridge through. Mention me on an issue instead and I'll see it.",
            );
          } catch (replyError) {
            console.warn("failed to post the Document-mention fallback reply", {
              documentId,
              message: replyError instanceof Error ? replyError.message : String(replyError),
            });
          }
          throw new PermanentWebhookDeliveryError(
            "Linear currently rejects Agent Sessions on Document comment threads, and this Document has no linked issue to bridge through. The mention was quarantined without its private comment body.",
          );
        }
        try {
          session = await this.linear.createAgentSessionOnIssue(linkedIssueId);
          bridgedViaIssue = true;
        } catch (bridgeError) {
          this.notificationThreadSources.delete(rootCommentId);
          const question = payload.notification?.comment?.body?.trim();
          await this.linear.createIssueComment(
            linkedIssueId,
            finalText([
              "A mention on this issue's linked Document didn't reach me - Linear doesn't yet support Agent Sessions on Document comment threads, and starting one on the linked issue instead also failed.",
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
          throw new PermanentWebhookDeliveryError(
            "Linear currently rejects Agent Sessions on Document comment threads, and bridging through the Document's linked issue also failed. The mention was quarantined without its private comment body.",
          );
        }
      }
      if (this.notificationThreadSources.has(rootCommentId)) this.notificationSources.set(session.id, commentId);
      this.recordNotification(action, "agentSessionOwned");
      console.info(
        bridgedViaIssue
          ? "Linear Document comment mention bridged through its linked issue to an Agent Session"
          : "Linear Document comment mention promoted to an Agent Session",
        { documentId, commentId, rootCommentId, agentSessionId: session.id },
      );
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
        // restoreIssueState: false - the terminal status the human just set (e.g. dragging the
        // issue straight to Done, bypassing the QA "Approve and complete" button entirely) is
        // itself the reason we're cancelling. Restoring attention.previousStateId here would
        // silently overwrite that explicit choice back to whatever it was before the open
        // Steering/QA wait - "moved from Done to In Progress" a moment after a human marked it
        // Done, undoing the one thing they just did. The other cancelMatching call sites
        // (unassigned, lost team access, installation revoked) keep restoring: there the current
        // status is incidental to the cancellation reason, not the reason itself.
        await this.cancelMatching((session) => session.issueId === issueId, `Issue entered terminal status ${state.name}.`, false);
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
      // GAB-26: a crash still ends the round - don't leave a deferred discussion (and the
      // issue's attention status) stuck forever just because this particular turn blew up
      // instead of concluding cleanly.
      if (!state.attention.length) {
        await this.settlePendingAttentionResolution(sessionId, state, { restoreIssueState: true, resolveThread: true });
      }
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
    if (state.issueId) {
      try {
        const context = await this.linear.issueWorkspaceContext(state.issueId);
        if (context.project) taskPayload.projectContext = context.project;
        if (context.team) taskPayload.teamContext = context.team;
      } catch (error) {
        console.warn("Linear project/team context unavailable; the agent will fetch it directly if needed", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
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
    // GAB-26: this turn just concluded without needing to raise a fresh blocking attention of
    // its own, so whatever discussion an earlier reply deferred (settlePendingAttentionResolution)
    // is now genuinely settled - restore the issue's pre-attention state and resolve its tracked
    // thread. If a fresh attention DID land (state.attention.length), the conversation is still
    // live - leave it deferred for the next round.
    if (!state.attention.length) {
      await this.settlePendingAttentionResolution(sessionId, state, { restoreIssueState: true, resolveThread: true });
    }
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
    // "answered" is finish_work's third status (alongside blocked_external/deferred): a
    // purely conversational turn - a question or discussion with no deliverable to approve -
    // that the agent already replied to directly. It renders the same as a normal completed
    // response, just labeled distinctly in the footer so the run log still shows how it ended.
    const outcome = result.disposition?.status === "blocked_external"
      ? "blocked externally"
      : result.disposition?.status === "deferred"
        ? "deferred"
        : result.disposition?.status === "answered"
          ? "answered"
          : result.ok ? "completed" : "failed";
    const nonFailureDispositions = ["deferred", "answered"];
    const footer = `\n\n_Run ${outcome} in ${elapsed(result.elapsedMs)}._`;
    const activity = this.enqueueActivity(sessionId, () => this.linear.createActivity(sessionId, {
      type: result.ok || (result.disposition && nonFailureDispositions.includes(result.disposition.status)) ? "response" : "error",
      body: finalText(`${result.summary}${footer}`),
    }));
    if (result.disposition?.status === "blocked_external") this.scheduleAutoResumeIfMarked(sessionId, result.disposition.nextAction);
    const pullRequest = githubPullRequestUrl(result.summary);
    if (pullRequest) {
      const state = this.states.get(sessionId);
      if (state) this.registerPullRequestWatch(sessionId, state, pullRequest);
    }
    return pullRequest
      ? activity.then(() => this.linear.addExternalUrl(sessionId, { label: "Pull request", url: pullRequest }).catch((error: unknown) => {
        console.warn("failed to attach pull request to Agent Session", {
          message: error instanceof Error ? error.message : String(error),
        });
      }))
      : activity;
  }

  // Slice 23: fires from either capture site (a rich linkGitHubPullRequestAttachment publish,
  // or this scrape of the final summary) on EVERY turn that mentions the PR, not just the
  // first - the runner's own watchPullRequestChecks call started a fresh gh --watch child
  // for a first-time PR replaces any prior one for this session, so calling it again on a
  // later push (red CI -> fix -> push -> a fresh CI run) is exactly the re-arm the loop
  // needs; treating a same-URL call as a no-op here would leave that later run unwatched
  // forever. `lastKnownReviewAt` is preserved across a same-URL re-registration (so already-
  // seen reviews don't resurface) but seeded fresh - from wall-clock, not "no baseline" - for
  // a genuinely new PR, so the very first review poll doesn't dump the PR's entire pre-
  // existing review history as if it just happened.
  private registerPullRequestWatch(sessionId: string, state: SessionState, url: string): void {
    const parsed = parsePullRequestUrl(url);
    if (!parsed) return;
    const samePullRequest = state.pullRequest?.url === url;
    state.pullRequest = {
      url,
      ...parsed,
      lastKnownReviewAt: samePullRequest ? state.pullRequest?.lastKnownReviewAt : new Date().toISOString(),
    };
    this.touch(state);
    void this.persist();
    this.ensurePullRequestReviewPolling();
    this.runner.watchPullRequestChecks?.(sessionId, url).catch((error: unknown) => {
      console.warn("failed to start watching a pull request's CI checks", {
        sessionId,
        url,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  // Slice 23: the CI-checks half is watched by the runner's own long-lived `gh pr checks
  // --watch` child (see reportPullRequestChecks below, fed by the runner's callback) - gh
  // paces that itself. Reviews have no equivalent CLI primitive, so this is the one place
  // this codebase picks its own cadence: a single global interval walking every tracked PR,
  // not a per-PR timer - matching Gaby's own framing ("a centralized record with a single
  // watcher") and keeping total load auditable in one place. Lazily started on the first
  // registered PR, never in the constructor, so a controller instance that never sees a PR
  // (most of this test suite) never spins up a live interval at all.
  private ensurePullRequestReviewPolling(): void {
    if (this.pullRequestReviewTimer || this.reviewPollIntervalMs <= 0) return;
    this.pullRequestReviewTimer = setInterval(() => {
      this.pollPullRequestReviews().catch((error: unknown) => {
        console.error("pull request review poll failed", { message: error instanceof Error ? error.message : String(error) });
      });
    }, this.reviewPollIntervalMs);
    this.pullRequestReviewTimer.unref?.();
  }

  async pollPullRequestReviews(): Promise<void> {
    for (const [sessionId, state] of this.states) {
      if (!state.pullRequest || !this.runner.checkPullRequestReviews) continue;
      const pullRequest = state.pullRequest;
      let reviews: PullRequestReview[];
      try {
        ({ reviews } = await this.runner.checkPullRequestReviews(pullRequest.url));
      } catch (error) {
        console.warn("failed to poll pull request reviews", {
          sessionId,
          url: pullRequest.url,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const fresh = reviews
        .filter((review) => !pullRequest.lastKnownReviewAt || review.submittedAt > pullRequest.lastKnownReviewAt)
        .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt));
      if (!fresh.length) continue;
      const latest = fresh.at(-1)!;
      // Re-read from the live map rather than trusting the closed-over `state`/`pullRequest`
      // reference: this loop awaits per PR, so a concurrent change (session ended, a fresh
      // PR registered) could have moved on since this iteration started.
      const current = this.states.get(sessionId);
      if (!current?.pullRequest || current.pullRequest.url !== pullRequest.url) continue;
      // A blocking Steering/QA elicitation is Linear's own live "waiting for reply" card -
      // dispatchExternalUpdate's own prompted-webhook path would otherwise be indistinguishable
      // from a real human reply and silently clear it (see reportPullRequestChecks below for
      // the same guard). Deliberately skip marking this review "seen" too: leaving
      // lastKnownReviewAt untouched means the next poll, once attention clears, finds it fresh
      // again rather than losing it.
      if (current.attention.length) continue;
      current.pullRequest = { ...current.pullRequest, lastKnownReviewAt: latest.submittedAt };
      this.touch(current);
      void this.persist();
      const body = fresh.length === 1
        ? `New review from ${fresh[0]!.author} (${fresh[0]!.state.toLowerCase()}) on your pull request ${pullRequest.url}: ${boundedReviewBody(fresh[0]!.body)}`
        : `${fresh.length} new reviews on your pull request ${pullRequest.url} - most recent from ${latest.author} (${latest.state.toLowerCase()}): ${boundedReviewBody(latest.body)}`;
      await this.dispatchExternalUpdate(sessionId, body);
    }
  }

  // Slice 23: the runner's callback once its gh pr checks --watch child for this session's
  // PR exits (POST /internal/pull-request-checks, see src/server.ts). Re-verifies the
  // registry entry still matches before dispatching - a fresh PR or a closed-out session
  // between the watch starting and finishing means this result is no longer wanted.
  async reportPullRequestChecks(
    sessionId: string,
    prUrl: string,
    result: { body: string; conclusion: "success" | "failure" | "error" },
  ): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state?.pullRequest || state.pullRequest.url !== prUrl) return;
    // Same guard and same reasoning as pollPullRequestReviews above: a blocking Steering/QA
    // wait must not be silently cleared by a check result arriving mid-wait. Unlike a review,
    // there is nothing to re-poll later here - the watch already exited - so this result is
    // simply dropped rather than queued; the underlying GitHub state isn't going anywhere, and
    // the next push (which re-arms the watch via registerPullRequestWatch) or the human's own
    // reply picks the thread back up.
    if (state.attention.length) return;
    const prefix = result.conclusion === "success" ? "CI checks passed" : result.conclusion === "failure" ? "CI checks failed" : "Could not watch CI checks";
    await this.dispatchExternalUpdate(sessionId, `${prefix} on your pull request ${prUrl}: ${result.body}`);
  }

  // Slice 23's shared dispatch: a synthesized `prompted` webhook, exactly like Slice 24's
  // runScheduledResume - handle() itself already knows how to route this correctly whether
  // the session is actively mid-turn (a live-inject via followUp - exactly what a fresh CI/
  // review update should do, unlike an auto-resume nudge there is no "already running, skip
  // it" case here) or dormant (a cold resume via start()). Also guarded on attention here as
  // defense in depth - both current callers already check it before calling in, but handle()'s
  // prompted-with-open-attention branch treats ANY prompted payload as if it were the human's
  // own reply (clearing the wait, restoring issue state, resuming without a real reply), so a
  // future caller that forgets this check would silently clobber a live Steering/QA card.
  private async dispatchExternalUpdate(sessionId: string, body: string): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state || state.attention.length) return;
    await this.handle({
      action: "prompted",
      agentSession: {
        id: sessionId,
        ...(state.issueId ? { issueId: state.issueId, issue: { id: state.issueId, ...(state.teamId ? { teamId: state.teamId } : {}) } } : {}),
      },
      agentActivity: { content: { body } },
    });
  }

  // Not persisted: an in-memory setTimeout that resumes a blocked_external
  // session once the capsule's own reported reset time passes (see
  // synthesizeRateLimitDisposition, claude-capsule/agent-request.mjs). If
  // the controller restarts before it fires, the scheduled resume is
  // silently lost and the session just sits dormant until a human notices
  // and mentions it again - the same as any other blocked_external session
  // today, not a new failure mode. Acceptable for a rarely-restarted
  // single-host pilot; a persisted, re-armed-on-startup version is a larger
  // piece of work for if this actually bites.
  private scheduleAutoResumeIfMarked(sessionId: string, nextAction: string | undefined): void {
    const match = /^auto-resume-at:(.+)$/.exec(nextAction ?? "");
    const resumeAtText = match?.[1];
    if (!resumeAtText) return;
    const resumeAt = new Date(resumeAtText).getTime();
    if (!Number.isFinite(resumeAt)) return;
    const delayMs = Math.min(Math.max(resumeAt - Date.now(), 0), MAX_AUTO_RESUME_DELAY_MS);
    const timer = setTimeout(() => {
      this.runScheduledResume(sessionId).catch((error: unknown) => {
        console.error("scheduled auto-resume failed", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }, delayMs);
    timer.unref();
  }

  private async runScheduledResume(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId);
    // The session may have moved on since this was scheduled - a human
    // manually intervened, a fresh mention already restarted it, or the
    // issue reached a terminal status. Re-check rather than firing blindly:
    // this mirrors handle()'s own opportunistic staleness recheck, which
    // only runs when an open attention exists - a blocked_external session
    // never has one, so it needs its own check here.
    if (!state || state.running || state.attention.length) return;
    if (state.issueId) {
      try {
        const snapshot = await this.linear.agentSessionSnapshot(sessionId);
        if (isTerminalSessionStatus(snapshot.status)) {
          console.info("skipping scheduled auto-resume; Agent Session is no longer live", { sessionId, status: snapshot.status });
          return;
        }
      } catch (error) {
        // Fail closed: a resume starts a container and burns usage, so an
        // unverifiable status is treated the same as "don't know it's safe."
        // A missed auto-resume just costs a manual mention; a wrong one
        // restarts work on a session that may have already moved on.
        console.warn("could not verify an Agent Session is still live before an auto-resume; skipping it", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }
    await this.handle({
      action: "prompted",
      agentSession: {
        id: sessionId,
        ...(state.issueId
          ? { issueId: state.issueId, issue: { id: state.issueId, ...(state.teamId ? { teamId: state.teamId } : {}) } }
          : {}),
      },
      agentActivity: {
        content: { body: "The Claude usage limit that paused this run has now reset - resume and continue the work." },
      },
    });
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

  private async cancelMatching(predicate: (state: SessionState) => boolean, reason: string, restoreIssueState = true): Promise<void> {
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
      const hadPullRequest = Boolean(state.pullRequest);
      state.pullRequest = undefined;
      this.touch(state);
      const cancellation = Promise.all([
        this.runner.abort(sessionId).then(() => undefined).catch((error: unknown) => {
          console.warn("failed to abort invalidated agent task", {
            sessionId,
            reason,
            message: error instanceof Error ? error.message : String(error),
          });
        }),
        hadPullRequest
          ? (this.runner.abortPullRequestWatch?.(sessionId) ?? Promise.resolve()).catch((error: unknown) => {
            console.warn("failed to abort a pull request watch for an invalidated session", {
              sessionId,
              reason,
              message: error instanceof Error ? error.message : String(error),
            });
          })
          : Promise.resolve(),
        this.dismissAttention(sessionId, state.issueId, attention, reason, restoreIssueState),
        // GAB-26: mirrors the isStopRequest handling above - only fall back to restoring
        // from a deferred discussion's own previousStateId when dismissAttention didn't
        // already do it for a currently-open attention, and never resolve the thread here.
        this.settlePendingAttentionResolution(sessionId, state, { restoreIssueState: restoreIssueState && !attention.length, resolveThread: false }),
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
    restoreIssueState: boolean,
  ): Promise<void> {
    if (!attention.length) return;
    const item = attention[0]!;
    if (issueId && restoreIssueState) {
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
   * Finalizes a still-open, deferred Steering/QA discussion (GAB-26): restores the issue to
   * its pre-attention state and, when asked, resolves the discussion's own tracked comment
   * thread. Shared by every place a "this round is genuinely over" signal can arrive - a
   * resumed turn concluding without raising a fresh attention of its own (execute()'s normal
   * completion path), that same turn crashing outright (start()'s catch handler), and the
   * whole run being stopped or the session invalidated while no other attention is currently
   * open for dismissAttention to already be handling the restore itself.
   *
   * Always clears `state.pendingAttentionResolution` first, even when there's nothing else to
   * do (no issueId, resolution not requested) - a session id can be reused by a later,
   * unrelated Agent Session, and leaving stale bookkeeping around would make a brand-new
   * attention on that session wrongly thread itself under a long-settled conversation.
   */
  private async settlePendingAttentionResolution(
    sessionId: string,
    state: SessionState,
    options: { restoreIssueState: boolean; resolveThread: boolean },
  ): Promise<void> {
    const pending = state.pendingAttentionResolution;
    state.pendingAttentionResolution = undefined;
    if (!pending) return;
    if (options.restoreIssueState && state.issueId) {
      await this.linear.setIssueState(state.issueId, pending.previousStateId).catch((error: unknown) => {
        console.warn("failed to restore issue status after a settled Steering/QA discussion", {
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
    // Cancellation never resolves comments (matches dismissAttention's existing convention
    // above) - a stopped or invalidated session's still-open question genuinely deserves to
    // stay visible/unresolved, since nobody actually answered it.
    if (options.resolveThread && pending.rootCommentId) {
      await this.linear.resolveComment(pending.rootCommentId).catch(() => undefined);
    }
  }

  /**
   * Completes the parent work for an approved QA attention. Shared by the two ways a human
   * can approve: replying with the exact QA_APPROVE_VALUE text (handled inline in `handle()`),
   * and reacting with a checkmark emoji (handled by `handleQaReactionApproval` below). Callers
   * are responsible for having already cleared `state.attention` and for confirming the
   * attention being resolved was actually a QA (not a Steering) request.
   */
  private async approveQa(
    sessionId: string,
    state: SessionState,
    issueId: string,
    ackCommentId?: string,
    attentionCommentId?: string,
  ): Promise<void> {
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
    // Approval is the clearest possible "decision made, no longer relevant" signal (GAB-22).
    if (attentionCommentId) await this.linear.resolveComment(attentionCommentId).catch(() => undefined);
    // The whole discussion this attention was part of (if any) is moot now that the parent
    // work is complete - drop the deferred GAB-26 bookkeeping so a later reused session id
    // never mistakes stale state for a still-open conversation.
    state.pendingAttentionResolution = undefined;
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
      const attentionCommentId = state.attention[0]?.commentId;
      state.attention = [];
      await this.approveQa(sessionId, state, issueId, undefined, attentionCommentId);
    }
  }
}

export function githubPullRequestUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+/)?.[0];
}

export function parsePullRequestUrl(url: string): { owner: string; repo: string; number: number } | undefined {
  const match = url.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/);
  return match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : undefined;
}
