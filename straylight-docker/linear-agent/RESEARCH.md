# Straylight delegation-loop research

Straylight is the live instrument for exploring a better way to direct software
agents. It is not the proposed final product.

The working model has three coupled thirds:

1. **Harness** — capable models, safe tools, persistent environments, reliable
   execution, and enough evidence to trust what happened.
2. **Intent expression** — letting an engineer steer at the right level, from a
   principle or sketch to a precise instruction, without flattening everything
   into chat.
3. **Attention management** — letting many agents work without turning their
   operator into a shared blocking resource or an alarm console.

Linear is the current control surface and durable work graph. Subscription-backed
Claude Code is now the default runner; Pi is the explicit fallback and later
route for model/provider experiments. These are replaceable parts: semantic
capabilities such as attention requests must survive another harness change.

## Research rule

Use this system for real work. Let repeated friction earn changes. Prefer one
small falsifiable experiment over another broad framework, and keep deployment
separate from local implementation.

For each experiment record:

- the observed failure;
- the hypothesis;
- the smallest change;
- what happened in real tasks;
- keep, revise, or remove.

## Experiment (2026-08-18) — rationalized attention

**Observed failure:** an ordinary clarification tool gives an agent an open bar
to interrupt its operator, offers no fleet-level distinction between urgency and
normal review, and often asks for QA before presenting a reviewable artifact.

**Hypothesis:** forcing every loopback into a small Steering/QA contract will
reduce unnecessary interruptions and re-entry cost while creating enough
structured state for an eventual attention queue.

The request must answer:

1. What exact human action is necessary?
2. What original intent is relevant?
3. What new information or artifact changed the state?
4. What does the agent recommend?
5. What happens if the request waits, and how long can it safely wait?

It must also choose `interrupt` or `queue`, native Linear priority, and whether
the human response truly blocks the parent run. The broker turns it into a child
issue assigned to the sponsoring engineer, labelled Steering or QA and Blocking
or FYI. Blocking replies resume the parent; FYIs require acknowledgement while
the parent keeps working. QA is invalid without a preview,
Document, pull request, screenshot, report, or similarly reviewable HTTPS
artifact. The child issue and its Agent Session remain the visible source of
truth; the controller stores only minimal routing and queue metadata.

### Signals to observe

- unnecessary interruptions;
- queued requests that later proved unnecessary;
- time from request to useful response;
- time needed to regain context;
- QA requests missing a usable artifact;
- number of review rounds before ownership;
- unclassified access or blocker waits that deserve their own contract.

### What happened

Real use (2026-08-19, GAB-7) surfaced two concrete failures rather than the
anticipated ones:

- **Label creation crashed.** `ensureAttentionLabel` matched existing labels by
  `team.id`, so a workspace-level label of the same name never matched and the
  create call hit a duplicate-name rejection every time. Unverified whether an
  app-actor token can create labels at all; the crash reproduces either way.
- **Signal was never cheap.** Every request — including a nonblocking Signal
  meant to let the agent keep working — spawned a full child issue, its own
  Agent Session, and two labels. A chatty run produced several subissues that
  were never real decisions ("Idle and ready — awaiting next task"), which is
  exactly the alarm-flood failure mode a rationalized contract was meant to
  prevent, just moved to Linear's issue graph instead of a bot's DM history.

**Verdict: revise.** The five-question contract, the interrupt/queue split, and
the QA evidence requirement are keepers. The uniform child-issue-per-request
mechanism is not — it never distinguished a truly blocking pause (rare,
exclusive, worth Linear's most visible surface) from unbounded background
narration (common, cheap, meant to be ignorable). See the next experiment.

## Current experiment — attention rationalized by consequence, not uniformly

**Observed failure:** see above — a single mechanism (child issue + two
labels) served every attention kind regardless of whether it blocked the run,
which is itself an ISA 18.2-shaped alarm-management failure: alarms
undifferentiated by required action and urgency degrade into noise the
operator learns to ignore.

**Hypothesis:** matching Linear's own surface hierarchy to the actual
consequence of each signal — not routing everything through one escalation
path — carries the same signal at a fraction of the Linear-object cost, and
makes the genuinely blocking case *more* visible by not competing with
narration for attention:

1. **Debug / internal monologue** — the existing ephemeral `thought`/`action`
   activity stream. No tool call, no persisted state.
2. **Findings and progress worth a durable record** — a plain comment on the
   issue (new: the broker previously could only comment on Documents).
   Comments notify by default and carry real UI weight; an Agent Activity does
   not.
3. **Blocking Steering or QA** — since a session can only have one unresolved
   blocking attention at a time (already an enforced invariant, not a new
   one), a single-valued issue status is a faithful encoding of it. The parent
   issue flips to a configured "needs input" workflow state
   (`LINEAR_ATTENTION_STATE_NAME`) and the request posts as a comment on that
   same issue. Linear resumes an Agent Session natively from a reply comment
   on its own issue, so the human's answer lands directly back on the paused
   run — no child issue, no second session, no cross-session routing to get
   wrong.
4. **Discovered but out-of-scope follow-up** — a genuine subissue, but gated
   behind a forced justification (what, why not this task's job, what
   re-surfaces it) rather than a free-form create, because an agent left to
   invent "deferred" work will manufacture busywork nobody owns.

The "needs input" state has no generic lookup: Linear's `WorkflowState.type`
enum has no `blocked` value, so it is resolved by configured name per team and
fails with an actionable error — naming the missing state — rather than
attempting to create a workflow state automatically. Label creation is gone
entirely; nothing in this design needs it.

### Signals to observe

- whether the blocking state actually reads as more urgent now that it isn't
  competing with Signal-shaped subissue noise;
- whether Signal-as-comment loses anything real by dropping the formal FYI
  acknowledgement the prior experiment called for, or whether that
  requirement was itself overhead the child-issue mechanism imposed rather
  than a genuine need;
- whether tier-2 comments (findings/progress) get seen without an explicit
  ping, or need to escalate to a Signal-shaped notification after all;
- whether the justification gate on deferred follow-ups actually stops
  manufactured busywork, or just moves the manufacturing into the
  justification fields;
- any team missing the configured attention state, and whether the failure
  message was actually actionable in practice.

Not yet run against a real task; this is the hypothesis as implemented, not a
result.

### First real run (2026-08-19, GAB-13)

A "describe your environment" task surfaced concrete findings within the
first live trial:

- The same-issue comment reused the full five-field template written for a
  separate child issue with no shared context — heavily redundant when
  posted on the issue the human already has open. Fixed: a terser
  `renderAttentionComment` keeps only the decision itself; the full render
  stays on the sidebar elicitation Activity.
- `manage_linear`'s comment resource only supported Document comments; an
  agent wanting to post a plain issue-level note had no path and burned 18
  tool calls fighting it before falling back to a raw artifact link. Fixed:
  issue-level comment creation, defaulting to the current issue.
- Nothing tracked *which* comment thread a blocking attention actually
  lives in, so a reply to an unrelated thread on the same issue would have
  been misread as answering the pending Steering/QA. Fixed: the attention
  now records its own comment id, and a reply elsewhere is ignored rather
  than treated as resolving it - a prerequisite for genuine multi-topic
  threads, not just a bug fix.
- Gaby wants more of Linear's structural hierarchy in active use, not just
  the mechanism that shipped: distinct topics as separate threads, genuine
  back-and-forth within a thread before a decision counts as final, and a
  real uncoverable log of what the agent did (which ephemeral activities
  may or may not actually provide - unverified, see below). This goes
  beyond "attention," toward using Linear's structure to solve the same
  problem a flat chat transcript can't: making concurrent, asynchronous
  work legible without forcing it through one linear scroll.
- Added prompt guidance (both runners) so a resumed agent that gets a
  clarifying reply instead of a real decision answers it and re-opens the
  same attention rather than proceeding as if resolved. This reuses the
  existing resume path rather than adding a new one - functionally
  delivers "ask a follow-up before deciding," but does a full clear/reopen
  cycle rather than genuinely holding one continuous thread open. Whether
  that's good enough or needs the real sub-turn version is next to
  observe.
- Open and unverified: does Linear's Agent Session panel let you scroll
  back through past ephemeral activities, or only show the current one?
  This determines whether "thought logs I can uncover" already exists or
  needs new durable-but-non-notifying checkpoint activities.

### Second real run - checked against Linear's actual docs, not just logs

The second live test reported the run "still shows as running" in Linear
even after our own system correctly recorded `awaiting_qa`/`awaitingInput:
true`, and no approve/deny buttons were visible anywhere. Confirmed via
Linear's developer docs rather than guessing:

- Linear docs, verbatim: "Ephemeral activities are displayed temporarily,
  and will be replaced when the next activity arrives from the agent" and
  "Linear tracks session lifecycle automatically based on the last emitted
  activity." Session status is a pure function of whichever activity
  landed last - there is no separate "mark as awaiting input" call.
- The bug: `assertAgentMayAct` only rejects a further tool call *inside*
  its handler, which runs *after* the Claude SDK has already emitted the
  tool-call-start stream event the capsule turns into a fresh ephemeral
  progress activity. So if Claude attempts even one more tool call right
  after a blocking `request_attention` succeeds - which nothing prevents,
  since `permissionMode: bypassPermissions` only stops it from acting, not
  from trying - a new activity lands after the elicitation and Linear's
  own session status (and likely the select-signal button UI riding on
  that same elicitation) gets superseded before the human ever sees it.
  Fixed: `agent-request.mjs` stops projecting SDK progress into activities
  entirely once `context.awaitingInput` is true.
- Residual, not fixed this pass: `ProgressReporter`'s own heartbeat (a
  local timer in the TS controller, independent of the capsule) still
  posts "still working" if the model takes over a minute to actually stop
  after the tool call succeeds. Fixing that needs a signal to cross the
  capsule/controller HTTP boundary during the stream, not just in the
  final result - a real but smaller-probability contributor, deferred
  until we know whether the first fix was enough.
- The `select` signal doc includes a screenshot description placing the
  option buttons "in a row below" the triggering comment - i.e. inline in
  the same conversational area as comments, not hidden in a genuinely
  separate panel as assumed earlier. The "silent, hidden" complaint about
  Activities is more about visual weight and no-notification than
  physical separation - worth re-examining once the race above is fixed.
- Linear's own `promptContext` XML already models multiple concurrent
  comment threads explicitly (`<primary-directive-thread>` vs
  `<other-thread>`, each with a `comment-id` and full author/timestamp
  history) - "topics" as separate threads is already a first-class part
  of the data Straylight receives, not something needing new plumbing to
  represent. What's missing is on the output side: prompting the agent to
  actually reply within/reference the right thread (the generic
  `manage_linear` comment `reply` operation already supports this) rather
  than flattening everything into whichever comment `request_attention`
  happens to create.
- Linear's own best-practices doc: "Comments may not be reliable to read
  from, as they are editable... rely on Agent Activities as these are
  frozen-in-time snapshots." Confirms the existing recovery design
  (rebuilding context from Activities, not Comments) is the platform's own
  recommended pattern, not an idiosyncratic choice.

### Going bold - using more of the surface (2026-08-19)

Confirmed via the SDK schema rather than assuming: `ReactionCreateInput`
takes `commentId`/`issueId` + `emoji` (a generic mutation, not gated to
human OAuth actors as far as the schema shows), and `DocumentCreateInput`
takes `issueId` directly with no project - the same shape `CommentCreateInput`
already has. Both confirm the earlier `manage_linear` document-create
rejection was a routing gap, not a platform limitation. Shipped:

- `manage_linear`'s comment resource now posts directly on the current
  issue when created with no parentId (previously Document-only); document
  create now works the same way instead of requiring the separate
  `publish` path - one coherent path for both instead of two.
- The attention state flip now also bumps issue priority to match the
  request's urgency, and restores both together on resolution or
  dismissal - a second visual axis (list/board priority color) alongside
  the status column, not just a status change alone.
- The tracked attention comment gets resolved (`commentResolve`) when the
  blocking request is answered or dismissed, and the human's resolving
  reply gets a ✅ reaction - the same native "resolved" checkmark UX that
  prompted this whole redesign thread, now applied by the system itself
  instead of only appearing when a human manually resolves.
- Prompt guidance nudges the agent to reply within the specific thread a
  request is actually about (using the existing comment `reply` operation
  and the primary-directive-thread/other-thread markers already in
  `promptContext`) instead of always starting a new comment - the
  plumbing for topics already existed; this is the first attempt at
  actually using it.

Not yet run against a real task.

### Third real run - the comment/elicitation duplication, and the priority reversal (2026-08-19)

The bold round above shipped and ran on the same GAB-13 issue live. Four
findings, two of them reversing what had just shipped:

- **Confirmed empirically, not just inferred: a plain issue comment reply
  does not resume the Agent Session at all.** Gaby typed "approve" as a
  reply to the QA comment and nothing happened - no resume, no error, no
  feedback. Comments and the Agent Session's own prompted-event delivery
  are separate mechanisms; `issueNewComment` already routes to
  `handleNotification` as context-only, by design, and evidently a plain
  reply doesn't drive the session either. The elicitation Activity's own
  native surface (the "Input needed to continue" card - real buttons plus
  a dedicated text box) is the only thing that actually resumes a session.
  This reframes the design cleanly: **comments are a one-way decision
  log; the elicitation is the only real input channel.** Posting both for
  the same blocking request wasn't redundant polish, it was one working
  mechanism and one that silently does nothing when used as instructed.
  Reverted: blocking Steering/QA no longer posts a standalone comment at
  all - only the elicitation, using the terse render (the "big
  bureaucratic formula" - the full seven-section template - showed up
  directly in that same prominent card, which was the actual complaint;
  it was never a good fit for a primary, native, buttoned surface).
  `resolveComment`/the tracked attention comment id go with it, since
  there's no longer a standalone comment to resolve; the checkmark
  reaction still fires on the human's actual reply comment when one
  exists.
- **Reverted the priority bump entirely.** Gaby's call: issue priority is
  his own signal for how much he cares about an issue overall, which is
  what he uses to decide which of several open interruptions to handle
  first. An automated bump-then-restore - even temporary - overwrites a
  dimension that's supposed to stay under his control. `setIssuePriority`/
  `issuePriority` removed from `linear.ts`.
- **The progress display showed a raw UUID** ("Updating Linear list
  comment 145c7938-..."), which turned out to be caused by a real
  functional gap: `manage_linear`'s comment `list`/`get` still only
  supported Document-scoped access, the same gap `create` had before last
  night's fix. Fixed the same way - list defaults to the current issue's
  own comments when no Document id is given. Separately fixed the display
  itself: a truncated id ("145c7938") was tried first and rejected as
  still meaningless - replaced with a small phrase table so `manage_linear`
  progress reads as a sentence ("Reading comments") instead of any id at
  all.
- **"Zero messages / inner monologue... it was all sent as disappearing
  thoughts."** Confirms the ephemeral-vs-durable gap flagged after the
  first run was real, not hypothetical. Added prompt guidance (both
  runners, system-prompt level) to post a durable, non-ephemeral note at
  genuine decision points - not routine steps - so at least some real
  narrative survives instead of only the final summary.
- **A comment + `@straylight` mention inside the linked Document produced
  no response.** This is an already-known, already-handled Linear
  platform limitation, not a new bug: `handleNotification`'s
  `documentCommentMention` branch has carried a `PermanentWebhookDeliveryError`
  for this since before tonight - "Linear currently rejects Agent
  Sessions on Document comment threads." The webhook is correctly
  dead-lettered rather than retried forever, but nothing currently tells
  the human why the mention did nothing. Worth a follow-up (e.g. surface
  the failure on the parent issue) if this keeps coming up in practice.

### Fourth real run - a genuine crash, and confirmation the display fix landed (2026-08-19/20)

- `manage_linear` progress confirmed reading as "Linear · Reading comments"
  - the phrase-table fix works as intended.
- Deleting the delivered Document, archiving the session, and
  re-delegating the same issue reproduced a real crash: the fresh session
  trusted stale context (a prior summary/comment claiming the report was
  "already delivered, approved, and answered") without checking that the
  Document it pointed to still existed. It posted two Signal comments
  walking back its own claim, then tried to stop without ever calling
  Steering, QA, or finish_work - none of which Signal sets a disposition
  for. The one-shot repair guard (`stopDispositionGuard`, by design allows
  exactly one forced retry to avoid an infinite loop) let the second,
  still-invalid stop through, and `runAgent` correctly - if unhelpfully -
  threw "Claude ended without a structured work disposition." Also
  explains the "two verbose comments" complaint on this run: the right
  move was one QA re-confirmation, not two Signals second-guessing each
  other.
  Fixed by prompting, not by weakening the repair guard (removing the
  one-retry cap trades a clear failure for a real risk of a token-burning
  loop): both runners now say explicitly not to trust a prior summary's
  completion claim without verifying current state, and that "nothing
  changed" is never a reason to stop without a transition - re-request QA
  with still-valid or fresh evidence instead.

### Cleanup and research pass (2026-08-20)

No new live test this round - an unprompted pass over what tonight's
changes left behind, plus more of Linear's own docs.

- Found real drift: `workspace/AGENTS.md` - mounted into every task and
  read as authoritative alongside the system prompt - still described the
  removed child-issue mechanism ("The resulting child issue... is the
  durable human queue entry"). Live agents were reading this. Rewrote the
  attention section to match the current design and added the same
  stale-context-verification line the system prompts now carry, plus a
  `defer_followup` mention that was missing entirely.
  Added a proper Slice 16 to `ROADMAP.md` in the existing status/
  bullets/acceptance format, rather than editing Slice 13's history -
  that roadmap is a record of what was built when, not a live spec.
- Removed now-dead code: `linearAttentionPriority`/`LINEAR_PRIORITY` (the
  reverted priority bump's only caller) and `renderAttentionRequest`
  itself (the full seven-section template) - once the elicitation moved
  to the terse render too, nothing in production called it, only its own
  tests. Trimmed those tests to what they actually verify now.
- The `documentCommentMention` dead-letter flagged after the third run
  now does something instead of nothing: when the notification carries
  the Document's linked issue id, it posts a plain comment there quoting
  the question and explaining why the mention didn't work, before still
  quarantining the webhook. Fails silent exactly as before when Linear
  doesn't supply that id - purely additive, not a behavior change for the
  case that isn't fixable.
- Confirmed via docs and added: when a repository match is ambiguous or
  unscored, Linear's own guidance is to elicit rather than guess - the
  repository-suggestion prompt now says so explicitly.
- Considered and skipped: the docs also say an agent "should set itself
  as the delegate" when none is set and it's doing real implementation
  work, but explicitly *not* when an automation delegated it. There's no
  reliable way to tell those apart from the webhook payload alone, and a
  wrong auto-assignment would pollute a real workspace's delegate/assignee
  fields Gaby may use for other tracking. Skipped rather than guessed;
  flagging here rather than silently dropping it.
- Audited every silent `.catch(() => undefined)` in `controller.ts` for the
  same profile as the Document-mention gap (a human action that produces
  literally no visible trace anywhere). Found none worth changing: the
  rest are either genuinely best-effort (a missed confirmation activity
  when the underlying state change already succeeded and is visible) or
  have no alternative surface to fall back to (Linear itself being
  unreachable has no backup channel). Not every silent catch is a gap;
  this one confirmed that rather than assuming it.
- A first, deliberately small step toward the mention-as-thread idea
  above: a freshly `created` session now checks whether another tracked
  session already exists on the same issue (running, awaiting input, or
  mid-attention) and, if so, injects a note into `payload.guidance` saying
  so before the agent ever starts reasoning. This doesn't route anything
  across sessions - it just stops a new mention from acting as if it's
  the only thing happening on the issue, which is exactly what confused
  the crashed run. The full cross-session routing idea is still open.
- Re-read the crash fix critically rather than assuming the prompt
  guidance alone closes it. The Stop-hook repair message the Claude
  capsule sends when there's no disposition yet was static and generic:
  it re-lists Signal as one of the valid choices even when the model just
  got stuck *because* it signaled twice and stopped anyway. Re-listing
  the thing that already failed as an equally valid option invites
  repeating it. `context` now tracks whether a Signal fired since the
  last real transition, and the repair message is sharper in exactly that
  case: "a Signal alone never ends a turn... that still means requesting
  QA again, not stopping." This is the in-the-moment message fired right
  when the model is stuck, arguably a stronger lever than the static
  system-prompt line added earlier. Caught on self-review that `STRAYLIGHT_RUNNER`
  (`LINEAR_AGENT_RUNNER_BACKEND` in docker-compose) makes Pi genuinely
  selectable in production, not dead code, so the asymmetry was a live
  defect rather than a footnote - fixed rather than logged: `pi.ts`'s
  `ActiveRunState` now tracks the same flag, `PI_LIFECYCLE_REPAIR_PROMPT`
  became `piLifecycleRepairPrompt(signaledSinceLastTransition)` with the
  matching sharper branch, and every site that records a real disposition
  (Steering/QA, the access-Steering helper, finish_work) clears the flag
  so it always reads "since the last transition" rather than "ever this
  run" - inert within a single run today since a set disposition already
  bypasses the branch that reads it, but it keeps the name honest if this
  logic is ever reused across turns.

## Next hypotheses, not commitments

- An intent packet can preserve the chosen level of expression and make any
  attempted level-switch explicit.
- A visual review packet can bind a preview URL, state/viewport, screenshot or
  annotation, checks, and the last accepted intent.
- Observe whether the in-process Straylight MCP tools are narrow enough to keep
  Claude's authenticated capsule separate from each writable task jail.
- A fleet attention view should project current Linear Agent Sessions and issue
  priority, not become a second task database.
- Evaluated `@linear/sdk` to replace the hand-written GraphQL in `linear.ts`.
  It is schema-generated and covers the Agent Session/Activity surface, so it
  would work for simple flat mutations (the new issue comment, status
  updates). It does not fit the generic `manage_linear` reads: those return a
  fully denormalized nested tree (issue with state, assignee, team, parent,
  labels) in one round trip by design, while the SDK's model objects expose
  relations as separate lazy-loaded calls — adopting it there would mean an
  N+1 rewrite of the tool-result contract, not a simplification. Not adopted
  this pass; worth revisiting only for genuinely new flat-shaped calls, not as
  a wholesale migration of the existing read paths.
- Straylight controls both ends of the Linear↔Claude connection, so
  `@mention`-triggered new Agent Sessions don't have to become genuinely
  new Claude conversations. Confirmed live: mentioning `@straylight` on an
  issue that already has an active/paused session creates a second,
  independent Linear session ("delegated the issue to straylight") -
  Linear's own model has no notion of "this mention is actually about the
  same ongoing task." Nothing stops Straylight from detecting that case
  and routing the new session's prompt into the existing Claude
  conversation instead of starting a fresh one - real "topics" support,
  where a mention becomes a thread within the same context rather than a
  parallel task. Sizeable enough (cross-session bookkeeping, deciding
  what counts as "the same task") to design deliberately, not bolt on.

## Research conclusion — intent surfaces, not modes

The earlier distinction between focused collaboration and delegated execution
is real, but it is not a binary agent mode. It is movement along the essay's
levels of intent expression while the locus of initiative and attention also
changes.

The agent remains present at both ends:

- In **foreground collaboration**, the engineer holds initiative and attention.
  The agent is a visible, low-latency sidebar companion acting in short,
  observable increments through the currently open artifact.
- In **background delegation**, the agent holds initiative after receiving an
  outcome and authority boundary. It works out of sight and returns only for a
  justified Steering negotiation or reviewable QA handoff.

Three properties therefore describe the interaction better than a single mode:

1. **Initiative:** engineer-led or agent-led.
2. **Attention:** foreground or background.
3. **Intent surface:** conversation, choice, document, diagram, preview, or code.

### Intent-surface ladder

| Level of expressed intent | Natural surface |
| --- | --- |
| Fully owned | Local worktree with editor, terminal, browser, and a live agent sidebar |
| Precise instruction | Direct manipulation, selection, drawing, or annotation on the product |
| Option-picking | Compact evaluated choices with recommendation and tradeoffs |
| Detailed implementation plan | Structured plan with diagrams and comments anchored to exact parts |
| Architecture sketch | Shared spatial diagram or model |
| Principles and guidelines | Durable Documents, design rules, and repository guidance |
| Brainstorming and raw thoughts | Fast exploratory conversation that preserves alternatives and unknowns |
| Fully delegated | Linear issue, autonomous remote execution, rationalized Steering, and QA |

These are not separate integrations. Each surface should express an **intent
delta anchored to a versioned artifact**: a choice, passage, diagram node,
viewport coordinate, DOM element, file selection, or code diff. The agent must
record whether it applied, superseded, rejected, or still needs clarification
on that delta.

### Core transition — take work local and hand it back

Linear and Straylight are the asynchronous delegation and fleet surfaces. A
local workspace is the focused-collaboration surface. Moving between them must
be a first-class, lossless round trip rather than a new disconnected chat.

The desired flow is:

1. `focus` starts local collaboration from a Linear issue, or `take` pauses an
   existing remote run and gives its exclusive write lease to the engineer.
2. The local worktree opens with the current intent, base revision, uncommitted
   changes, plan, consequential decisions, unknowns, and evidence. Local Claude
   Code uses the engineer's ordinary editor, browser, dev servers, and
   authenticated developer tools. Because the engineer is present, questions
   happen in context rather than becoming attention-queue issues.
3. `return` conflict-checks and hands the reviewed workspace plus a compact
   semantic handoff back to Straylight. The engineer may then delegate the next
   outcome, keep ownership, or close the work.
4. Remote execution resumes only after ownership is explicitly returned.

The handoff should preserve work identity, original and latest intent, current
intent level, authority, base Git revision, binary diff and untracked files,
plan dispositions, decisions, unknowns, evidence, next checkpoint, and current
owner. Provider-private chat history is not the continuity contract; durable
state and artifacts are.

Three invariants apply to every surface transition:

- **Same work, different surfaces:** the Linear issue, workspace, and artifacts
  remain one work item.
- **Lossless round trips:** comments, drawings, edits, decisions, and anchors
  survive the transition back.
- **Respect the current intent level:** an agent must not drag delegated work
  into implementation trivia or turn shaping into autonomous implementation.
  Changing levels is an explicit negotiation.

### Current boundary

The deployed slice implements the delegated end, option-picking through Linear
elicitation, and early evidence-backed QA. Warm Claude follow-ups provide
continuity but not genuinely live collaboration: an active Claude turn is not
bidirectional, so follow-ups queue for a later turn.

It does not yet implement local take/return ownership, a live artifact-aware
sidebar, anchored plan/diagram review, direct preview annotation, or a shared
handoff envelope. Those are product hypotheses to test, not capabilities to
imply through prompting.

## Pi removed — 2026-08-20

Removed the Pi fallback runner entirely rather than keep maintaining it
unused. The trigger was concrete, not aesthetic: fixing the Signal-aware
Stop-hook repair message for Claude and then finding the Pi fallback's copy
had silently drifted out of parity is exactly the tax of carrying two
runtimes through a design that is still moving every round. Claude Code has
been the default and the only one actually live-tested this session; keeping
Pi meant every prompt, tool, and lifecycle change had to be re-derived twice,
and correctness verified twice, for a path with no evidence anyone exercises.

Deleted outright rather than left unwired: `src/pi.ts`, `src/pi-resources.ts`,
`src/model-policy.ts`, `pi-config/` (model allowlist, RTK extension, auth),
the `askClaude`/`/v1/ask` shell-out-to-the-CLI path end to end (workbench,
runner-server, capsule-client, `claude-capsule/claude-request.mjs`), the
`STRAYLIGHT_RUNNER`/`LINEAR_AGENT_RUNNER_BACKEND` runtime switch, and every
docker-compose env var and bind mount that only existed to configure Pi.
`materializeLinearInputs` moved to `linear-inputs.ts` since Claude's own
harness depended on it despite living in `pi.ts`. Kept: everything that
turned out to be shared runner infrastructure wearing a `PI_`-prefixed name
from when Pi was the only backend (`PI_WORKDIR`, `PI_TIMEOUT_MS`,
`PI_MEMORY_DIR`, the warm-session pool, the Docker task-container spawner,
`playwright-core` for the browser dev service) - renaming those now would be
pure churn unconnected to the actual goal.

Caught before it shipped: `WorkbenchHarness.runClaude` looked like more of
the same dead Pi machinery (a "delegate to a Claude helper" path with no
tool in `agent-request.mjs` ever calling it) and was deleted along with
`askClaude` - until typecheck stayed green and a closer trace showed why
that's the wrong read. Every task container's `CAPSULE_URL` deliberately
points at the always-on workbench, not the real capsule
(`linear-agent-claude-capsule:8790`); `ClaudeHarness`'s own direct capsule
call (`runBrokeredAgent`, the prompt/resume/model/timeBudgetMs-only shape)
lands on `WorkbenchHarness.runClaude`, which looks the caller's bearer token
up against its own active-task registry, then re-issues the request to the
real capsule with the full shape (`taskUrl`/`workbenchUrl`/`taskToken`) using
its own privileged credential. That's the actual security boundary for the
*primary* Claude run, not a leftover Pi delegate feature - restored it
(and the matching `CapsuleAgentRequest`/`runAgent` full shape in
`capsule-client.ts`) before committing anything. Only `askClaude`/`/v1/ask`
(a distinct, always-separate "ask Claude a one-shot question" shortcut) was
ever Pi-only.

## Native `auth` signal for access repair — 2026-08-20

Linear's Agent Activity API has a dedicated `auth` signal (elicitation-only):
Linear renders a "Link account" control instead of plain text, dismissed once
a newer activity lands, with `signalMetadata: { url, providerName }`. Straylight
already had a missing-access Steering path (a blocking request with a link in
its evidence) but never used the native signal - `AgentActivitySignal`/
`AgentActivitySignalMetadata` in `types.ts` already typed `"auth"` correctly,
just unused.

Wired end to end: `request_attention` gained an optional `missingAccess:
{workspace: "capsule" | "tools", providerName}` parameter. The capsule already
had `capsuleAuthUrl`/`toolAuthUrl` in `RunnerConfig`, but they went nowhere -
`ClaudeHarness` never read them, and they were never threaded through the
`CapsuleAgentRequest` that reaches `agent-request.mjs`. Added them to the
request shape and to `WorkbenchHarness.runClaude`'s enrichment step (the same
place that already adds `taskUrl`/`workbenchUrl`/`taskToken`, per the relay
mechanism above), so `context.capsuleAuthUrl`/`context.toolAuthUrl` are real
inside the capsule. `AttentionRequest` gained `accessRepair: {url,
providerName}`, valid only alongside `kind: "steering"`; the controller turns
it into `signal: "auth"` on the elicitation instead of `select`/none, and
`renderAttentionComment` still includes the link as plain markdown so
surfaces that don't render the special auth UI (email notifications, mobile
previews) stay usable.

The model never sees or handles a raw URL - it names which workspace is
missing access and a human-readable provider name; the actual authenticated
URL is resolved server-side from config the model has no reason to see.

## externalUrls and PR linking, closing a real gap — 2026-08-20

Went looking for whether `externalUrls` (PR/preview link surfacing) was
built at all and found the opposite of what an initial grep suggested: it
already exists, wired through `addExternalUrl`, used for Documents,
`share_artifact`, and a `githubPullRequestUrl` regex scrape at `finish()`.
The real gaps were narrower than "unused": the regex only fires once, at
the very end of a run, against the final summary text, and only matches
`github.com/.../pull/N`; and - the actual finding worth recording - neither
`linear_activity`'s `publish`/`external_url` actions nor the fact that
`publish` with `kind: "attachment"` creates a proper issue-level Attachment
(not just a session-level link chip) were ever documented to the model.
`linear_activity`'s only tool-schema shape is a loose `z.record` passthrough,
so a natural-language description is the *entire* interface the model has
for it - an unwritten capability is functionally an absent one regardless of
what the code supports.

Fixed by improving the description and adding explicit system-prompt and
`AGENTS.md` guidance: publish a pull request or live preview/deploy URL the
moment it exists, via `publish`/`kind: "attachment"`, not just restated in
the final summary. Left the `finish()` regex scrape exactly as it was - a
conservative, already-tested safety net for exactly the case where the model
forgets - rather than also upgrading it to create a full issue attachment,
since that risks a duplicate Attachment card if the model's final summary
happens to restate a PR URL it already published moments earlier. The
proactive path gets the richer treatment; the fallback stays deliberately
thin.

## Mention-as-thread: resuming a dormant conversation across sessions — 2026-08-20

The open item flagged in the "attention rationalized" experiment: an
`@mention` on an issue that already has a dormant (completed or
awaiting-input) session creates a second, fully independent Linear Agent
Session with no memory of the first. Linear's own model has no notion of
"this mention continues that work" - a new session is a new session, always.
Scoped deliberately to the dormant case only, not the harder "sibling is
mid-turn" case: a completed prior session's Claude conversation can be safely
resumed from a brand-new task container; sharing one live SDK conversation
between two concurrently-running turns cannot be done safely, so a running
sibling still only gets the existing warning-guidance treatment from the
`findActiveSiblingSession` mitigation, nothing more. Real cross-session
routing while something is actively running is still the larger, deliberate
design the earlier note flagged - this closes the narrower, safe half.

This only became buildable because of the relay mechanism traced during Pi
removal: a task container's Claude conversation is not tied to that
container at all - the claude-capsule service holds it on a persistent named
volume (`linear_agent_claude_profile`) shared across every task, forever.
Passing `resume: <id>` through a brand-new container reaches the exact same
conversation regardless of which ephemeral workspace asks. The gap was never
infrastructure, only that the id never left the task container: `ClaudeHarness`
wrote it to a local `.straylight/claude-session.json` scoped to that one
Linear session's own workspace, and the controller never learned it.

Wired minimally along the seam that already exists rather than inventing a
new one: `PiResult` gained `conversationId`, surfaced from `ClaudeHarness.run`
on every completed turn (not just cached locally). `SessionState` gained
`claudeConversationId`, persisted (bounded by the existing 500-session cap
and recency sort, so dormant conversations age out exactly like everything
else already does) rather than lost across a controller restart the way it
would have been under the old save-filter, which only kept sessions with
live work outstanding. On a fresh `created` event, `findResumableConversation`
walks sibling sessions on the same issue for the most recently updated one
with a recorded conversation - bailing immediately if *any* sibling is
running, not just one that happens to hold the target id, since resuming
correctly isn't worth a subtle concurrency bug. The resulting
`resumeConversationId` flows through `AgentTaskPayload`, and
`ClaudeHarness.run` only falls back to it when this session has no local
history of its own - a same-session follow-up in a warm container still
takes priority, unaffected.

`claudeInitialPrompt` gets one added line, only when resuming: told plainly
that this is a continuation, not a fresh task, and - matching the existing
stale-context guidance - not to trust its own prior conclusions without
verifying current state either.

A second-pass review caught that the prompt line only addressed *semantic*
staleness (old conclusions may no longer hold) and missed *physical*
staleness: the workspace itself is a brand-new container, keyed on the new
Linear session id under `workspace/runs/<sessionKey>`, so it starts empty
even though the resumed Claude conversation's history references a cloned
repo, a branch, and prior edits that only ever existed in the old container.
Without an explicit warning, the model's first move on resume would plausibly
be an ENOENT reading a file it "remembers," or a "not a git repository" from
a check run outside any checkout. Added a second sentence to the same
conditional prompt line: this is a fresh, empty workspace, nothing from prior
turns exists on disk, re-clone and re-checkout before acting on anything
remembered. Also added the process-boundary coverage the original tests
skipped - both new mention-routing tests exercised the feature only in
memory (mocked `AgentRunner`, or `ClaudeHarness.run` called directly with the
field pre-set) and never crossed the actual controller → runner-client →
`/run` JSON → `ClaudeHarness` → NDJSON wire. Added assertions in
`runner-protocol.test.ts` that `conversationId` survives an encode/parse
round-trip (and that a non-string value is rejected) and in
`runner-integration.test.ts` that `resumeConversationId` set on the client
side arrives intact in the harness's `run(payload, ...)` call over the real
HTTP body.

## Empty plan on resume — 2026-08-21

Same gap as the workspace-empty fix above, just the other piece of state
living under the same fresh container's `.straylight/` directory. The
workspace-empty note already established that a resumed Claude conversation
carries semantic memory (what it concluded) into a container that has none
of the physical state (files, checkouts) that memory refers to. The native
plan is exactly that kind of physical state, stored right next to the
session file this was traced from: `ClaudeHarness.planFilename()` in
`src/claude.ts` resolves `.straylight/plan.json` under the task's own
`piWorkdir`, scoped to one Linear session's one container, same as
`.straylight/claude-session.json`. A brand-new container for a resumed
mention has neither file on disk.

Missing `claude-session.json` was already handled deliberately -
`readSession` catches ENOENT and returns `undefined`, which is exactly the
"no local history, fall back to `resumeConversationId`" path `ClaudeHarness.run`
needs. `readPlan` does the same for a missing `plan.json`: ENOENT falls back
to `emptyPlan()` in `src/plan.ts`, silently. That fallback is correct
behavior, not a bug - the new container legitimately has no plan yet. The gap
was that a resumed Claude conversation doesn't know that. It remembers
calling `manage_plan` with, say, `{action: "update", id: 3}` in its prior
turn, and nothing in the prompt told it that id died with the old container.

The failure mode is `applyPlanRequest` in `src/plan.ts` throwing
`Plan item 3 does not exist` (the exact message the `update` and `remove`
branches raise when `findIndex` comes back `< 0` against an empty-plan
lookup) - a real error, correctly raised, but one the model would plausibly
read as "my plan got corrupted" rather than "I'm in a fresh container and
never re-created it here." `reconcilePlan` raises the same message for an
unknown id, and it's arguably the likelier trigger: the initial prompt
itself instructs reconciling every item before a terminal transition, so a
resumed session closing out is more likely to reconcile a remembered id than
to `update` one first. Same shape as the pre-fix ENOENT-on-a-remembered-file
or not-a-git-repository confusion, just for plan item ids instead of file
paths.

Fixed the same way, in the same place: one more clause appended to the
existing conditional line in `claudeInitialPrompt` (`src/prompts.ts`) that
already warns about the empty workspace on `resumeConversationId`. Told to
treat the local plan as equally fresh and empty, and to start a new plan or
list current plan state via `manage_plan` rather than referencing a
remembered item id - which covers `reconcile` too, since the guidance is to
stop trusting old ids at all, not just for one action. Checked
`claude-capsule/agent-request.mjs` before touching anything: its
`manage_plan` case only builds a progress-display phrase (`item ${id}`) and
forwards the request over HTTP to `/v1/plan`; storage, the ENOENT fallback,
and the "does not exist" error all live purely in `src/claude.ts` and
`src/plan.ts`, so no capsule change was needed.

## Testing the missingAccess tool-handler path - 2026-08-21

Went back over the native `auth` signal work from 2026-08-20 looking for
test coverage gaps, since every test that touched it exercised one of two
things: `resolveAccessRepair(missingAccess, context)` directly as a pure
function (`claude-capsule/agent-request.test.mjs`), or a controller test
that hands `collaborateLinear` an already-fully-formed `accessRepair` object
(`test/controller-recovery.test.ts`'s "posts an access-repair Steering
request"). Nothing actually called the `request_attention` tool the way
Claude calls it. The real logic - `const { missingAccess, ...attention } =
request;` then the `attention.kind !== "steering"` guard then
`attention.accessRepair = resolveAccessRepair(...)` inside the tool's own
handler in `claude-capsule/agent-request.mjs` - sits between those two
tested layers and neither test walks through it.

Confirmed this was a real gap, not a hunch, by mutating it two ways and
re-running the untouched capsule suite each time: deleting the `kind !==
"steering"` guard line, and replacing the `{ action: "attention", request:
attention }` forward with a hand-picked subset of fields that dropped
`accessRepair`. Both mutations passed all 11 existing tests clean. Linear
would have silently rendered a plain evidence link instead of the
account-linking control, or let a Signal/QA request quietly attach
`accessRepair` without the model ever asking for `steering`, and nothing
would have caught it.

The obstacle to testing the handler directly is that `createStraylightTools`
returns `createSdkMcpServer(...)`'s output, not the raw tool array - so the
closure with the destructuring/guard/spread isn't reachable as an exported
function. Traced how `@anthropic-ai/claude-agent-sdk`'s `createSdkMcpServer`
actually wires it up: it builds an `McpServer` instance and calls
`instance.registerTool(name, {...}, handler)` per tool, and
`@modelcontextprotocol/sdk`'s `McpServer._createRegisteredTool` stores that
exact handler function, unwrapped, on
`instance._registeredTools[name].handler`. So
`createStraylightTools(context).instance._registeredTools.request_attention.handler`
*is* the real closure from `agent-request.mjs`, reachable without changing
any non-test source. Confirmed empirically with a throwaway script before
committing to the approach, then re-ran both mutations against the new tests
specifically: both were caught (the guard deletion produced an unexpected
fetch call and a mismatched error message; the spread-breaking change left
`capturedBody.request.accessRepair` `undefined` against the expected
value).

Added two tests exercising that handler:

- `missingAccess` alongside `kind: "signal"` or `kind: "qa"` rejects with
  exactly the error the code throws, `missingAccess requires kind:
  steering`, and - mocked via `t.mock.method(globalThis, "fetch", ...)`
  rather than trusting network behavior in a sandboxed run - confirmed no
  HTTP call is attempted either.
- `missingAccess` alongside `kind: "steering"` forwards a `request` body
  whose `accessRepair` field deep-equals what `resolveAccessRepair` itself
  returns for the same input (computed by calling the already-tested pure
  helper, not duplicated by hand), and confirmed `missingAccess` itself does
  not leak into the forwarded object.

`bun run test:capsule` (13/13, up from 11) and `bun run check` (typecheck
plus the full `test/*.ts` suite, 115/115) both stayed green throughout, and
neither `agent-request.mjs` nor any other non-test file needed to change -
`createStraylightTools` was already exported.

## Next live trial — 2026-08-19

The Claude-default and rationalized-attention slice converged successfully on
Straylight on 2026-08-18. Subscription usage was exhausted before a real task
could be delegated. The next step is one ordinary, low-risk real-work issue,
written normally without harness-specific prompt scaffolding. Observe the run
before expanding the system, especially whether it respects the requested
intent level, works autonomously without needless questions, and produces a
useful Steering or QA transition only when warranted.

## Tool-description corrections - 2026-08-21

Same bug class as the `request_attention` fix in 9e08ffe: a tool's
natural-language description is the model's only interface to what the tool
actually does, and an undocumented capability or an inaccurate description is
functionally as bad as a bug. Four more of `agent-request.mjs`'s descriptions
turned out stale, incomplete, or silently assuming knowledge the model has no
way to have. None of these needed a behavior change - the underlying code was
already correct; only the string Claude reads was wrong or missing something
load-bearing.

**`manage_service`'s `persistent` flag was undocumented.**
`WorkbenchHarness.startService`/`createPostgresService` in `src/workbench.ts`
show the real behavior: postgres defaults to a fresh random 24-byte password
(`crypto.randomBytes(24)`) and a tmpfs data directory every start;
`persistent: true` instead reads/writes a stable password to
`.services/postgres/connection.json` under the session's own workspace and
binds the data directory onto host-backed storage, so the same database
survives this session's container being recreated on resume. `startService`
also has `if (service === "browser" && persistent) throw new Error("The
browser service is always disposable")` - a hard rejection the description
never mentioned, so a model that reasonably assumed persistence was
orthogonal to service kind had no way to anticipate the runtime error.

**`manage_linear` never said which operations are valid for which
resource.** The description listed every verb (get/create/update/list/
link/unlink) against every resource noun as one undifferentiated list, which
reads as "any verb works on any resource" without ever having claimed it
outright. `src/linear.ts`'s six `manage*` dispatch functions each end in
their own `throw new Error(\`${resource} does not support ${operation}; use
...\`)` fallthrough, which is the actual authority: issue/project take
get/create/update/delete; document adds list; comment adds
reply/resolve/unresolve; relation only takes list plus create-aliased-link
and delete-aliased-unlink; subissue treats create/link/unlink as four
distinct operations. Checked `isLinearManageRequest` in
`src/linear-actions.ts` first, since if that guard enforced its own
per-resource allowlist upstream of `linear.ts` the matrix would have to come
from there instead - it doesn't; it only validates shape (resource and
operation are each in the full enum, id/parentId/relatedId are strings if
present), so the six dispatch functions' own error clauses are ground truth
and the matrix was lifted verbatim from them.

**Document's `id` field silently meant three different things.** On
`create`, `manageDocument` reads `request.id` as the issue to attach the new
Document to, defaulting to `context.issueId` (the current issue) - not the
Document. On `get`/`update`/`delete` it's the Document's own id, with no
fallback. `list` ignores `id` entirely and reads `request.parentId` instead
(also defaulting to the current issue) for which issue's Documents to
enumerate. Nothing in the old description said any of this, so a model
reasoning by analogy from `update`/`delete` - where `id` is unambiguously
"the thing you're touching" - had no signal that `create` breaks that
pattern.

**The `bash` tool's timeout and truncation behavior was never stated.**
`ClaudeHarness.shell` in `src/claude.ts` defaults `timeoutMs` to 120 seconds
when omitted and clamps it to the tool schema's own 300-second ceiling
(`z.number().int().min(1_000).max(300_000)` on the tool definition itself).
The more interesting gap was `maxBuffer: 256 * 1024`, passed straight through
to `Bun.spawn` inside `runtime.ts`'s `captureCommand`. Read Bun's own type
declarations first (`node_modules/bun-types/bun.d.ts`), which document that
both a timeout and a `maxBuffer` overrun kill the subprocess with
`killSignal` (default SIGTERM) - then didn't take that on faith and wrote a
throwaway probe script spawning a slow-emitting subprocess under the
installed Bun (1.3.14): confirmed empirically that once a single stream
crosses roughly 256 KB the process is actually killed mid-run, well before it
would otherwise finish, not just capped after the fact. Whatever partial
output survives that gets `redact()`-ed and then `.slice(-128 * 1024)`-ed
independently per stream in `shell()`'s return - tail kept, head dropped, no
marker showing where the cut happened. None of that was in the description,
so the model had no way to know a large-output command might be killed
outright rather than merely truncated, or that a visible tail could silently
be missing its beginning.

`bun run test:capsule` (13/13) and `bun run check` (typecheck plus 115/115 in
`test/*.ts`) both stayed green throughout - no test in either suite asserts
on tool description text today, and none needed to change, since nothing
about the dispatch logic, zod shapes, or runtime behavior moved.

## Urgent-signal escalation - 2026-08-21

A `kind: "signal"` attention request is deliberately, permanently
non-blocking: `isAttentionRequest` in `src/attention.ts` hard-forces
`delivery: "queue"` for every signal regardless of stated urgency, and that
does not change here. What did change is what a signal's own comment can
carry when the caller marks it `priority: "urgent"` - the question was
whether Linear's API actually gives an agent a way to make one comment more
visible than another without touching status, without expecting a reply,
and without any decorative text that only looks like it does something.

**What I verified, and where.** `src/linear.ts`'s `createIssueComment` calls
`commentCreate(input: CommentCreateInput!)` with only `{ issueId, body }` -
`body` is plain Markdown, the same Markdown the Linear editor itself parses.
Linear's own developer docs (`https://linear.app/developers/graphql`,
"Adding mentions in Markdown" section) state the mechanism directly: a bare
URL to a user's profile page - `https://<workspace>/profiles/<handle>` -
appearing anywhere in Markdown gets converted into a real `@mention` in the
rendered comment, identical to typing `@` and picking a person in the editor.
A companion line I found while reading the agent-interaction guide
(`https://linear.app/developers/agent-interaction`) makes the payoff
explicit for the exact case here: for a user mention, "this will send a
notification to their Inbox." This is not the same claim as a plain
`@DisplayName` string doing something - Linear's editor does not parse `@`
followed by text at all when it arrives as raw Markdown from the API; it
parses a specific URL shape into a mention node. I confirmed the exact field
needed to build that URL by pulling Linear's full public schema SDL
(`https://raw.githubusercontent.com/linear/linear/refs/heads/master/packages/sdk/src/schema.graphql`)
and finding `User.url: String!`, documented plainly as "User's profile URL."
That means the codebase never has to reconstruct a workspace URL key itself -
asking Linear for `assignee { id url }` on the issue returns an
already-correct, ready-to-embed mention URL.

**Why this is a comment concern, not a `signal`/`delivery` concern.** The
`isAttentionRequest` validator and `attentionBlocking`/`attentionPriority` in
`src/attention.ts` are untouched. The mention is not a new delivery channel;
it is an optional extra token glued onto the same plain-comment body that
non-urgent signals already get, decided purely by whether
`attentionPriority(req) === "urgent"`. I added `LinearClient.issueAssigneeUrl`
in `src/linear.ts` - a one-shot `issue(id) { assignee { url } }` query
returning just the URL (there was never a second caller for the assignee's
`id`, so it never got fetched). `collaborateLinear`'s `signal` branch calls
it only on the urgent path, inline with the same `.catch(() => null)`
one-liner used roughly fifteen other places in this file for exactly this
"best-effort side lookup, never let it fail the request" shape - an
adversarial review pass caught that a first draft had instead grown a
dedicated `urgentSignalMention` method with its own try/catch and a
paragraph of doc comment to do the same thing, which was more machinery
than the behavior needed. `collaborateLinear` then does
`mention ? `${mention}\n\n${comment}` : comment` before the same
`finalText(...)` call that already existed - so a routine signal's rendered
comment is byte-for-byte what it was before this change, and an urgent
signal with no resolvable assignee (or a failed lookup) degrades to that
exact same plain comment. `finalText`'s `redact()` step already URL-parses
every `https://` substring in the body for credential/query stripping; a
bare profile URL with no credentials or query string round-trips through it
unchanged, so it survives to reach Linear exactly as the mention parser
expects it.

One risk the same review pass surfaced and I'm recording rather than
papering over: the claim that a bare profile URL renders as a real
`@mention` and fires an Inbox notification is verified against Linear's
public docs and schema, not against an actual posted comment on live
Linear. If that's wrong or has changed, the failure mode is silent
degradation - an urgent signal posts a plain URL above the comment instead
of a real mention - not a crash, so it won't show up in tests or logs. The
next live trial should specifically check that an urgent signal actually
produces a rendered `@mention` and an Inbox notification, not just that the
comment contains the right substring.

**Net effect:** an urgent signal now additionally puts the issue's current
assignee in their own Linear Inbox via a real mention notification, using
only a mechanism Linear's parser already treats as a first-class mention -
not a look-alike. A routine signal, or an urgent signal on an unassigned
issue, is unchanged. Nothing here can flip issue state, block the run, or
require a reply; only who gets tapped on the shoulder for the same comment
changed, and only for the priority tier that already meant "worth a human's
attention sooner."

Added four cases to `test/controller-recovery.test.ts` alongside the existing
`collaborateLinear`/attention tests: an urgent signal with an assignee gets
the mention prefix; a routine signal never even calls `issueAssigneeUrl`,
let alone mentions anyone; an urgent signal on an unassigned issue falls
back to the plain comment; and an urgent signal whose assignee lookup
throws falls back the same way instead of surfacing the error.
`claude-capsule/*` was not touched, so `bun run test:capsule` did not need a
rerun for this feature specifically.

## Reaction tool for Claude - 2026-08-21

The system already auto-reacts with a ✅ on a resolving reply (the
`reactToComment(replyCommentId, "white_check_mark")` calls in
`controller.ts:470/485`), but Claude itself had no way to do the same thing
on purpose - it could only post a whole new comment or activity to
acknowledge something. `LinearClient.reactToComment(commentId, emoji)` in
`src/linear.ts:634` already existed and does nothing fancier than call
`reactionCreate(input: ReactionCreateInput!)`; the gap was entirely on the
routing side.

**Fit the existing broker instead of adding one.** `collaborateLinear` in
`src/controller.ts` already switches on a `LinearSessionRequest["action"]`
discriminated union (`attention`/`defer`/`activity`/`external_url`/`plan`/
`publish`), validated shape-first by `isLinearSessionRequest` in
`src/linear-actions.ts`, and exposed to Claude as the single generic
`linear_activity` tool in `claude-capsule/agent-request.mjs` (`{ request:
z.record(...) }`, forwarded verbatim to `/v1/linear-session`). Added one more
member to the union instead of a parallel path: `{ action: "react";
commentId: string; emoji: string }`, a validator branch
(`isString(request.commentId, 200) && isString(request.emoji, 100)`), and a
`collaborateLinear` branch that calls `this.linear.reactToComment(...)` and
returns `{ ok: true, action: "react" }` - the same shape `external_url`
already returns, no `data` needed since `reactToComment` is void. It had to
land as an explicit `if` before the trailing `publish` handling, which relies
on every other member of the union having already been eliminated by the
time it runs; appending after that block instead would have broken that
narrowing.

**Where a `commentId` actually comes from.** Checked this before settling on
the shape, since a reaction verb Claude can't target is the same class of
gap as an undocumented tool. Three real sources already reach Claude:
`documentReview()` in `src/prompts.ts:55` renders each thread entry as
`` - Comment ${comment.id} `` directly into the initial and follow-up
prompts; `manage_linear`'s comment `list`/`get` operations return the raw
`COMMENT_FIELDS` object (which includes `id`) as JSON tool output; and
Linear's own `promptContext` XML (surfaced as "Supporting Linear context")
already tags each thread with a `comment-id`, per the earlier "Going bold"
research entry. No new plumbing was needed to expose an id - only a verb
that could use one.

**`emoji` is not gated to a fixed list, and the tool description says so
honestly instead of guessing.** Pulled Linear's public schema SDL
(`https://raw.githubusercontent.com/linear/linear/refs/heads/master/packages/sdk/src/schema.graphql`)
and confirmed directly: `input ReactionCreateInput { commentId: String,
emoji: String!, ... }` - a plain string, not an enum. The schema also
defines a per-workspace `CustomEmoji` type ("uploaded by users... unique
name within the workspace"), which is why there's no universal allowed set
to enumerate even in principle. The only concrete value seen anywhere in
this codebase is `"white_check_mark"`, so the `linear_activity` description
names that one as the example shortcode to reuse and states plainly that an
unrecognized name gets rejected, rather than inventing a plausible-looking
list the way the `manage_service`/`manage_linear` descriptions were wrong
about undocumented behavior in the "Tool-description corrections" entry
above.

**Deliberately not added: any issue-scoping on `commentId`.** `manage_linear`'s
comment `update`/`resolve`/`delete` already accept an arbitrary
caller-supplied comment id with no check that it belongs to the current
issue (`requiredId(request.id, undefined, ...)`, no `state.issueId`
involved). Giving `react` alone a narrower guard would be inconsistent with
the rest of the broker's surface for no stated reason, so it was left the
same.

**Checked the third caller of `/v1/linear-session`, not just the two in the
capsule/controller path.** `src/linear-tool-client.ts`'s `LinearToolClient`
is a separate client of the same endpoint, used by the legacy Pi harness in
`src/claude.ts` (plan mirroring, `shareArtifact`'s activity note). Its
`collaborate(request: LinearSessionRequest, signal?)` takes the whole typed
union verbatim rather than enumerating actions itself, so widening
`LinearSessionRequest` with `react` reaches it automatically - confirmed by
`bun run check`'s full typecheck passing with no changes needed there.

Added acceptance/rejection cases for `{ action: "react", ... }` to
`test/linear-actions.test.ts`; a `collaborateLinear` routing test to
`test/controller-recovery.test.ts` asserting it calls `reactToComment` with
the exact `commentId`/`emoji` and needs no `issueId` on the session; and,
since `linear_activity` has no per-action logic of its own (unlike
`request_attention`, it just forwards `{ request }` verbatim), one test in
`claude-capsule/agent-request.test.mjs` reaching into
`instance._registeredTools.linear_activity.handler` the same way the
`missingAccess` tests already do, to prove a `react` body reaches the wire
unmodified. `claude-capsule/agent-request.mjs`'s tool description changed,
so `bun run test:capsule` needed a rerun this time, not just `bun run check`.

An adversarial review pass afterward caught that the `react` branch's
`reactToComment` call had no `.catch`, unlike the identical call at
`controller.ts:474` and the other best-effort Linear side-effects throughout
this file - an unrecognized emoji or a transient Linear failure would have
surfaced as an unhandled rejection instead of the reaction simply not
landing. Added `.catch(() => undefined)` to match the existing pattern, plus
a test asserting a throwing `reactToComment` still returns `{ ok: true,
action: "react" }` rather than rejecting.

## Trimming request_attention's unused fields - 2026-08-21

Not a speculative cleanup - the codebase owner's own explicit call, after
reading `request_attention`'s shape and judging it "good internal
rationalization of signals but too much context for decisions to be taken
with." The root cause was mechanical to confirm: `request_attention`'s zod
schema in `claude-capsule/agent-request.mjs` required `originalIntent`,
`delta`, `impact`, and `timing` on every single call (plus an optional
`evidence[].description`), and `src/attention.ts`'s `AttentionRequest` type
and `isAttentionRequest` validator mirrored the same shape - but
`renderAttentionComment`, the only function anywhere in this codebase that
ever turns an `AttentionRequest` into something a human actually sees
(either a plain Signal comment, or the Steering/QA elicitation Activity
body), never reads any of those five fields. It reads `title`, `action`,
`recommendation` (non-signal only), `accessRepair`, `options` (steering
only), and `evidence.label`/`evidence.url`. Confirmed by grep before
touching anything: no other file in `src/` or `claude-capsule/` reads
`originalIntent`, `delta`, `impact`, `timing`, or `evidence.description`
either - not in redaction logic, not in logging, not in any other
prompt-building path. Four required fields and one optional field were
being validated as mandatory or allowed, then silently discarded, on what is
very likely the highest-frequency tool call in the whole system - every
Signal, every Steering ask, every QA gate paid the cost of composing prose
nobody downstream would ever read.

Removed `originalIntent`, `delta`, `impact`, and `timing` from the
`AttentionRequest` type, `isAttentionRequest`'s bounded-field validation, and
the `request_attention` zod schema; removed `evidence[].description` from
`AttentionEvidence`, its evidence-array validation, and the corresponding
zod shape. `recommendation` stayed everywhere - `renderAttentionComment`
genuinely reads it (only for `kind !== "signal"`) and renders it as
`*Recommendation:* ...`. `defer_followup`'s neighboring `what`/`whyNotNow`/
`resurface` fields were deliberately left alone: `renderDeferredItem` reads
all three, so that tool's shape was never part of this problem and touching
it would have been the same mistake in reverse. The `request_attention` tool
description string didn't name any of the removed fields, so no wording
change was needed there.

Grepping the whole repo afterward for `originalIntent`, `\bdelta\b`,
`\bimpact\b`, and `\btiming\b` turned up only unrelated hits worth noting
explicitly, since the names are generic enough to collide with real code:
`delta` all through `agent-request.mjs`'s SSE stream-projection code
(`content_block_delta`, `event.delta.thinking`, etc.) and a test title
string referencing "delta" in English prose, plus `timing` inside an
unrelated recommendation string ("...unless the backfill starts timing
out."). None of those are the removed field and none were touched.

Every test fixture constructing an `AttentionRequest`-shaped object needed
the same five fields stripped: `test/attention.test.ts` (the shared
`steering` fixture and one `evidence[].description` fixture in the QA-gate
test), `test/linear-actions.test.ts` (two fixtures, one accept case and one
reject case), `test/controller-recovery.test.ts` (nine fixtures across nine
different integration tests), and `claude-capsule/agent-request.test.mjs`
(the shared `baseAttentionRequest` helper). None of the surviving assertions
had their premise broken by the removal - nothing in any of these four files
asserted that `isAttentionRequest` rejects a payload for lacking
`originalIntent`/`delta`/`impact`/`timing` specifically; the "rejects" cases
that happened to include a stripped fixture were all rejecting for an
unrelated reason (missing QA evidence, an unsafe URL, a duplicate option
value), so those still fail for the same reason after the fields are gone.
Only field-stripping was needed, no test logic rewrites.

`bun run check` (typecheck plus all 120 tests in `test/*.ts`) and
`bun run test:capsule` (14/14) both stayed green after the change.

## Timeout hardening for Docker Engine and Linear GraphQL calls - 2026-08-21

Two independent operability gaps, both with the same root cause: a bare
network call with no timeout and no abort path, sitting underneath code that
has no fallback if that call simply never comes back.

The first is the whole Docker Engine HTTP surface. `DockerEngine`'s private
`requestBuffer` in `src/docker-engine.ts` issued a raw `node:http` request
against the Docker socket with no `.setTimeout(...)` and nothing watching it -
every public method (`create`, `start`, `stop`, `remove`, `inspect`, `logs`,
`pull`, the network calls) funnels through it and inherited the same
unboundedness. `workbench.ts`'s task-startup timeout only bounds the
readiness poll *after* a container already exists in Docker's own state; it
never wrapped the `engine.create()` / `engine.start()` calls themselves. If
dockerd wedges mid-create, `start()` → `execute()` → `workbench.run()` never
returns, and the session just sits "running" forever with no error and no
recovery path. Worse, it chains: `PiRunnerClient.health()` in
`src/runner-client.ts` was a bare `fetch()` with no signal, so a hung Docker
call inside `workbench.health()` hangs the runner's own `/healthz`, which
hangs `controller.health()`'s call into `runner.health()`, which hangs the
controller's own `/healthz`. One stuck Docker call took down health
reporting for all three services at once.

The second is `AgentController.initialize()`, which `src/index.ts` awaits
*before* it ever calls `Bun.serve(...)`. For every persisted session,
`initialize()` calls `this.linear.agentSessionSnapshot(...)`, which bottoms
out in `LinearClient.graphqlWithToken`'s bare `fetch(GRAPHQL_URL, ...)` in
`src/linear.ts` - also no signal, also unbounded. Records are reconciled
sequentially with `await` inside a `for` loop, so the very first snapshot
call hanging is enough to wedge the whole boot sequence: no later record
ever gets processed, and the controller's HTTP port never opens. There is no
code path that recovers from this short of a human noticing and restarting
the process - and even then, on the next restart, the same record hits the
same hang again.

Reading the existing `catch` block in that `for` loop surfaced a second,
subtler bug behind the first: when a recovery snapshot call rejected (for any
reason, not just a new timeout), the handler did nothing but
`console.warn(...)`, then fell through to the unconditional `this.touch(state)`
below the `try`/`catch`. `touch()` bumps `updatedAt` to "now", and
`ControllerStateStore.save()` sorts by `updatedAt` descending and keeps only
the top `MAX_STORED_SESSIONS` (500) - so a session whose recovery keeps
failing gets bumped to the *front* of that list on every single restart,
permanently occupying a slot, permanently inert, and permanently invisible:
nobody except whoever reads the process's stdout ever learns it happened. A
wedged controller that never opens its port is loud (someone notices the
service is down); a controller that boots fine but quietly carries a
zombie session forever is the worse failure mode, because there is no signal
telling anyone to look.

The fix is the same shape in both places: give the network call a timeout so
a hang degrades into a bounded, catchable rejection instead of an unbounded
wait, then make sure the code around that rejection actually does something
useful with it instead of swallowing it.

For `DockerEngine`, checked `src/config.ts` first rather than inventing a
second timeout knob next to `taskStartupTimeoutMs` - but that field is a
different concept (bounding the readiness poll *after* a container exists),
not the Docker socket HTTP call itself, so a new `dockerRequestTimeoutMs`
field was added to `WorkbenchConfig` (env `PI_DOCKER_REQUEST_TIMEOUT_MS`,
default 30s, loaded with the same `positiveInteger` helper as its sibling)
and threaded into `new DockerEngine(config.dockerSocket,
config.dockerRequestTimeoutMs)` in `workbench.ts`. 30 seconds is generous
headroom for a busy-but-alive daemon on every method except `pull()`, which
legitimately takes minutes on a cold image cache over the network; `pull()`
passes its own longer constant (10 minutes) straight into `requestBuffer`'s
now-optional per-call `timeoutMs` parameter, so a slow-but-progressing pull
isn't punished by the same budget that should catch a truly wedged daemon.

Actually wiring the timeout up was not as simple as `AbortSignal.timeout()`.
The first attempt passed `signal: controller.signal` straight into
`http.request(...)`'s options, mirroring how `fetch()` takes a signal
elsewhere in this codebase - and the new `test/docker-engine.test.ts`'s
"never responds" case just hung until Bun's own 5-second test timeout killed
it. A throwaway repro script (`node:http.request` against a `node:net` Unix
socket server that never writes anything back) confirmed empirically that
Bun's `node:http` compat does not honor the `signal` request option for a
Unix domain socket. Switching to manually calling `request.destroy(error)`
on abort didn't work either: per Node's own documented `ClientRequest`
semantics, `destroy()` with **no** error argument only emits `'close'`, not
`'error'`, and the same repro script showed that on Bun, even
`destroy(error)` *with* an error argument only emits `'close'` - Node emits
both events; Bun emits neither in the expected combination. An intermediate
version tried making `'close'` the fallback settlement path instead, guarded
by an `aborted` flag - and a second empirically-failing test run caught that
`'close'` fires on *every* request, including a completely normal,
already-successfully-completed one, sometimes before the response's own
`'end'` event fires; an unconditional close-handler rejection broke the
success-path and non-2xx-error tests, which got a generic "closed
unexpectedly" message instead of the real response body. The working
implementation abandons events as the timeout signal entirely: the
`setTimeout` callback is the sole authority - it settles the promise
directly (`settleReject`, guarded against double-settling so a real
response arriving a moment later is a no-op) and only afterward calls
`request.destroy()` purely to release the socket, ignoring whatever that
destroy does or doesn't emit. The `'error'` handler is left as a second,
independent path for connection failures that were never a timeout (socket
missing, connection refused) - unaffected by any of this. All of this is
Bun-runtime-specific behavior discovered by writing and running the test
against a real Unix socket server, not assumed from Node's documentation.

`PiRunnerClient`'s `health()`, `repositories()`, and the shared `command()`
helper behind `followUp()`/`abort()` (src/runner-client.ts) each got
`signal: AbortSignal.timeout(this.controlTimeoutMs)` (default 15s, a
constructor parameter). `run()` was deliberately left untouched - it already
sets Bun's own `timeout: false` on purpose, because it's a long-lived
streaming call bounded by `piTimeoutMs` (up to an hour) rather than a quick
control round-trip, and touching it isn't part of this gap.

`LinearClient.graphqlWithToken`'s `fetch(GRAPHQL_URL, ...)` in `src/linear.ts`
got the same treatment: `signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS)`,
15s. This is the one that actually closes gap 2 for real network conditions
- once this fetch is bounded, `agentSessionSnapshot()`'s rejection propagates
normally, `initialize()`'s `for` loop moves on to the next record, and
`Bun.serve` opens on schedule even if Linear itself is having a bad day.

The `initialize()` recovery `catch` block now does two things it didn't
before: it clears `state.pending` and `state.active` so an unrecoverable
session stops being treated as resumable - it no longer forces the record
to survive `ControllerStateStore.save()`'s retention filter on the next
persist purely because "resume this" markers were left dangling, though a
session that still carries an open `attention` or a `claudeConversationId`
correctly keeps its slot regardless, same as any other dormant session
(that's what the very first test in this file exists to protect). It
deliberately leaves `state.awaitingInput` alone: we can't disprove a real
open Steering/QA wait just because this one snapshot call failed, and
forcing it false while `attention` stays populated would leave the session
in a self-contradictory state that a later human reply can no longer route
into correctly. Second, the catch block calls
`this.linear.createActivity(record.sessionId, { type: "error", body: ... })`
- the same activity-posting pattern used everywhere else in this file for
reporting a run-level failure onto the Agent Session (e.g. the crash handler
in `start()`) - to tell a human the session could not be recovered after a
restart, instead of leaving that information sitting only in
`console.warn`. That call is itself wrapped in `.catch(...)` with a second
`console.warn`, because if Linear is the reason recovery failed in the first
place, the report may fail too, and a failed report must not throw out of
`initialize()` and re-wedge the boot sequence this fix exists to prevent.

New test coverage: `test/docker-engine.test.ts` (previously nonexistent -
there was no unit coverage of `DockerEngine`'s HTTP layer at all, only
`decodeDockerStream` via `test/workbench.test.ts`) spins up a real
`node:http` server on a short-lived Unix socket (deliberately under `/tmp`
directly rather than `os.tmpdir()`, since macOS caps `sun_path` at ~104
bytes and `os.tmpdir()` alone can already eat half that budget) and covers:
a normal response resolving well inside its timeout, a server that never
responds getting aborted at its configured timeout instead of hanging (using
a 30ms timeout so the test itself stays fast), a non-2xx response surfacing
Docker's own JSON error message rather than a generic one, and a connection
to a socket nobody is listening on failing immediately with the real error
rather than waiting out the timeout. `test/controller-recovery.test.ts` got
a new test with two persisted records: one whose fake `agentSessionSnapshot`
sleeps 20ms then rejects (standing in for what the now-timeout-bounded real
client does on a hang, without the suite actually waiting out a real 15s
timeout), and one that resolves normally. It asserts `initialize()` still
completes in well under a second despite the first record never resolving
quickly, that a `type: "error"` activity naming the stranded session and
mentioning it "could not be recovered" gets posted, that
`lastRecovery.errors` reflects the failure, and that the stranded session's
record eventually drops out of `ControllerStateStore` entirely rather than
surviving indefinitely.

`bun run check` (typecheck plus all 125 tests in `test/*.ts`, up from 120)
and `bun run test:capsule` (14/14, unaffected by this change) both stayed
green. The full suite runs in under 2 seconds - the new Docker socket tests
included, since their timeouts are all configured in the tens-of-milliseconds
range rather than waiting out anything close to the real 30s/10min/15s
production defaults.

## Reaction-based QA approval - 2026-08-21

A paused QA elicitation only unblocked on a reply matching the exact
`QA_APPROVE_VALUE` string. A ✅ reaction on the same content did nothing -
`handleNotification`'s `issueEmojiReaction`/`issueCommentReaction` branch
(`controller.ts`) just counted it as an "acknowledgement" and returned. The
brief was explicit that this should count as approval; the actual work was
figuring out how the controller would even learn a reaction happened, since
this whole system is webhook-driven and there was no polling loop anywhere
to fall back on.

**First question: does Linear send a webhook for a reaction at all, and is
it real-time?** Pulled the public schema SDL (same
`raw.githubusercontent.com/linear/linear/.../schema.graphql` source used in
the "Reaction tool for Claude" entry above) and Linear's own agent docs
(`linear.app/developers/agents`, `/agent-interaction`). Two things settled
this quickly:

- `WebhookResourceType` (the enum of subscribable webhook categories) does
  list a standalone `Reaction` resource - but that's a generic, workspace-wide
  data-change stream (`ReactionWebhookPayload`, create/update/remove on *any*
  reaction anywhere) that this app doesn't subscribe to and that isn't scoped
  to the bot's own sessions at all. Turning it on would mean a new webhook
  category, a firehose to filter, and no obvious way to tie a random reaction
  back to a specific session without a lot of extra bookkeeping.
- Far more useful: Linear already folds reaction events into the
  `AppUserNotification` category this app *already* receives, as
  `action: "issueEmojiReaction"` (react on an issue) and
  `action: "issueCommentReaction"` (react on a comment) - confirmed by
  extracting `IssueEmojiReactionNotificationWebhookPayload` and
  `IssueCommentReactionNotificationWebhookPayload` from the SDL directly.
  Both carry `reactionEmoji: String!` (the normalized shortcode, e.g.
  `"white_check_mark"` - matching the exact string this codebase already
  writes via `reactToComment`), `actorId` (who reacted), and `issueId`/
  `commentId`. This is the same webhook `handleNotification` already pattern
  -matches on today, just discarding it (`controller.ts`'s
  `["issueEmojiReaction", "issueCommentReaction"].includes(action)` branch
  predates this work). No polling, no new webhook subscription, no new
  infrastructure needed on paper.

  This is inferred from the schema and from the fact that a branch already
  exists to catch these action strings, not from having watched a real
  `issueEmojiReaction` payload land - I don't have production traffic to
  confirm against. Two things are worth an operator actually checking against
  a live workspace before trusting this: whether the app receives an
  `AppUserNotification` for a reaction on an issue at all when it's only a
  session's *delegate* rather than a human collaborator who'd normally get
  notified (`health().controller.notifications.counts.acknowledgement`
  ticking up with `action: "issueEmojiReaction"` in the logs is the tell),
  and whether the OAuth app's webhook configuration has the `AppUserNotification`
  category enabled at all (it must, for the existing `issueMention`/
  `issueCommentMention` handling to work, but confirm rather than assume).

**Second question, the one that actually changed the design: what can a
human physically react to?** The brief's premise was "a reaction on the
specific comment/activity holding the QA elicitation." That assumes the
elicitation itself is a reactable thing. It isn't. Cross-checked two facts
in the same SDL:

- `type Reaction` only has parent-entity fields for `comment`, `issue`,
  `initiativeUpdate`, `post`, and `projectUpdate`. There is no `agentActivity`
  field.
- `type AgentActivity` (the query-side object backing every elicitation) has
  no `reactions` field and no `comment` field of its own - only
  `sourceComment: Comment`, documented as "the source comment this activity
  is linked to. Null if the activity was not triggered by a comment." That's
  the comment that *caused* the activity (e.g. a mention), not a comment
  *representing* it. `collaborateLinear`'s `agentActivityCreate` call
  (`linear.ts`) never sets one, and the mutation only ever returns the new
  activity's own `id`, which this codebase doesn't even keep (`ActiveAttention`
  has no comment/activity id field at all).

So there is no Comment, and no reactable entity, standing in for the QA
elicitation bubble itself. Reacting to it is not a thing Linear's data model
supports. The only reaction that can plausibly mean "I'm responding to the
open QA on this issue" is an **issue-level** reaction
(`issueEmojiReaction`) - the elicitation lives inside the issue's Agent
Session panel, and the issue is the thing `collaborateLinear` moves into
"In Review" for exactly as long as the QA is open. That's the mechanism this
entry wires up. `issueCommentReaction` is deliberately left exactly as it
was - a pure acknowledgement, no side effect - because scoping it to "any
comment on this issue" would silently approve QA on an unrelated ✅ left on
some other, older comment thread; that's precisely the misleading
half-measure the brief warned against building.

**The wiring itself** reuses the existing approval path rather than growing
a parallel one. The QA-completion logic inside `handle()`'s `prompted`
branch (create the "QA approved" response activity, `completeIssue`, react
back on the reply comment, clear `awaitingInput`) was pulled out into a new
private `approveQa(sessionId, state, issueId, ackCommentId?)` on
`AgentController` (`controller.ts`) - `handle()`'s original QA-approval-by-
text branch now just calls it. A new `handleQaReactionApproval(issueId,
emoji, actorId, appUserId)` checks `emoji === "white_check_mark"`, skips if
the reacting actor is the app's own user (defensive - this app doesn't react
to issues anywhere today, but it's a free guard against ever
self-triggering if it someday did), finds every tracked session whose
`state.issueId` matches and whose `state.attention[0]?.kind === "qa"`, clears
that attention, and calls `approveQa` for each (no `ackCommentId` - there is
no reply comment to react back on in this path, unlike the text-reply case).
`handleNotification`'s `issueEmojiReaction` branch now calls it, passing
`payload.notification?.reactionEmoji`/`actorId` (both newly added to
`AppUserNotificationWebhook["notification"]` in `types.ts`, matching the SDL
payload fields 1:1) and `payload.appUserId`. Since `handleNotification`
already does `JSON.parse(rawBody) as LinearWebhook` with no runtime schema
validation (`server.ts`), these fields were already arriving on the wire
whenever a real `issueEmojiReaction` fired - widening the type was the only
change needed to start reading them; nothing about what Linear sends had to
change.

Scoping deliberately keys off `state.attention[0]?.kind === "qa"` rather
than also checking `state.awaitingInput` - the two are set together
wherever attention is opened (`collaborateLinear`'s `attention` branch), so
checking one is checking both, same as the existing text-reply branch only
ever checks `attention.kind`.

Added three tests to `test/controller-recovery.test.ts`, next to the
existing "completes the issue directly when the engineer approves a QA
attention" test whose setup they mirror: reacting with `white_check_mark` on
the issue while a QA attention is open completes the issue exactly like the
text-reply case (and, correctly, never calls `reactToComment` - there's no
comment to ack); reacting with a different emoji (`thumbsup`) leaves the
attention open and never calls `completeIssue`; and a checkmark reaction
does nothing on a session with no attention open at all, and does nothing on
a session whose open attention is a Steering rather than a QA.

The approval branch also gets its own `console.info` naming `sessionId`,
`issueId`, and `actorId` distinct from the generic "observed as
acknowledgement" line every reaction already logs - this is a consequential,
auto-completing action taken on a comparatively coarse signal, and needs to
be traceable back to the reaction that triggered it after the fact.

`bun run check` (128 tests now, up from 125) and `bun run test:capsule`
(14/14, untouched by this change) both stayed green.

**This is a tradeoff to ratify, not just a caveat.** The brief asked for a
reaction on "the specific comment/activity holding the open QA elicitation."
What got built approves on a reaction to the *issue* instead, because
nothing else is reactable (see above) - which means any ✅ left on that
issue for an unrelated reason while a QA happens to be open will complete
the parent work too. That's a real false-positive surface on a consequential
action, not a cosmetic gap, and it was resolved in this codebase's favor
without a human sign-off on that specific tradeoff. There is a narrower
alternative that matches the brief literally: `collaborateLinear`'s
`signal` branch already posts a plain comment via `createIssueComment` for
non-blocking Signals; the QA `attention` branch could do the same
alongside the elicitation Activity, store that comment's id on
`ActiveAttention`, and have `handleQaReactionApproval` match
`issueCommentReaction` where `notification.commentId` equals that stored id
instead of matching on `issueEmojiReaction` at the issue level. That closes
the ambiguity entirely, at the cost of one extra comment (and one extra
field to persist) per QA elicitation. It was not built, in keeping with
"don't rebuild unless asked" once the coarser version was already working
and typechecked - but it is the option to reach for if the false-positive
risk above turns out to matter in practice.

**A second limitation, about recovery rather than ambiguity: a missed
reaction cannot be reconciled the way a missed reply can.** `initialize()`'s
restart recovery walks each session's persisted `agentSessionSnapshot` and
inspects its latest non-ephemeral `AgentActivity` to decide whether a wait is
still open - which works for the text-reply path because a human's reply
*is* an `AgentActivity`/`Comment` that shows up in that history. A reaction
creates neither. If the webhook carrying an `issueEmojiReaction` is lost -
say, the controller is down for the few seconds it's in flight - there is
nothing left anywhere in Linear's API for a later restart to notice; the
session simply stays `awaitingInput` forever, exactly the failure mode this
feature exists to fix, until the human notices and falls back to the
text-reply path (or reacts again, if they happen to). The text-reply path
has no equivalent blind spot. This is inherent to reactions carrying no
durable history entry to reconcile from, not something a retry or a bigger
timeout would fix.

## Before/after screenshot guidance for browser-affecting changes - 2026-08-21

Linear's own coding-session changelog entry (2026-08-20, "Coding sessions:
environments, browser use, and updated pricing") describes its agent
verifying UI work "where users experience it: in the browser," navigating
the affected flow and capturing before-and-after screenshots so a reviewer
can see the visual change directly. Read that against this codebase and the
gap wasn't missing plumbing - it was missing instruction. Every piece
Linear's write-up describes already exists here, unused by any standing
guidance:

- `manage_service` with `service: "browser"` starts an isolated, per-task
  Playwright browser (`claude-capsule/agent-request.mjs`, `src/workbench.ts`);
  the tool description already documents it as always disposable.
- `view_image` (`ClaudeHarness.viewImage`, `src/claude.ts:244-248`) reads a
  PNG/JPEG/GIF/WebP from `/workspace` as visual model input - the gate that
  lets Claude actually look at a screenshot before making a claim about it.
- `share_artifact` (`ClaudeHarness.shareArtifact`, `src/claude.ts:223-241`)
  uploads a workspace file to Linear and posts it as a `type: "thought"`
  activity with no `ephemeral` flag set - durable, not transient status -
  rendered as `![label](assetUrl)` for an image. Its own tool description
  (`claude-capsule/agent-request.mjs:529`) already points at this exact use:
  "Use the returned private HTTPS asset URL as evidence in a QA attention
  issue."
- `request_attention`'s QA path already structurally requires evidence -
  `attention.ts:133` refuses a `qa` request with an empty `evidence` array -
  it just never required that evidence be a screenshot instead of a prose
  description.

So the fix here is guidance-only: two new lines, no new tool, no schema
change, no behavior change. `src/prompts.ts`'s `claudeInitialPrompt` gets one
new line directly after the existing "Use view_image ... Use share_artifact
..." line, telling Claude that a change touching browser-rendered UI should
use the browser service to actually navigate the affected flow, capture a
before screenshot and an after screenshot, share both, and put them in QA's
evidence - not describe the change in words when a picture is available.
`workspace/AGENTS.md` gets the same instruction as a new bullet directly
after the existing document-embedding bullet (the one that already walks
through starting the browser, connecting with `playwright-core`, and saving
a PNG under `/workspace`), phrased as "use that same browser mechanic
proactively" so it doesn't re-explain mechanics already spelled out one
bullet up. Both explicitly scope this to changes with a real browser-rendered
surface, so Claude doesn't invent a browser-QA requirement for a pure
backend/API change.

One clause earns its place in both: capture the *before* screenshot during
orientation, before the first edit, not after the fix is already in.
Without that, "before" naturally gets read in the moment as "the current
state, whatever that now is" - by the time Claude remembers to take a
screenshot it has usually already made the change, and recovering the true
before-state means stashing or checking out the pre-edit tree. Both new
lines say this explicitly.

Added one assertion to the existing `behavior.test.ts` prompt test
(`assert.match(prompt, /browser-rendered UI/)`, next to the existing
`/manage_plan/` and `/persistent notes under/` checks) so a future prompt
trim can't silently drop this without a test noticing - prompt-content
coverage in that neighborhood was otherwise zero. `bun run check` (128
tests, same count - one assertion added to an existing test, not a new one)
and `bun run test:capsule` (14/14) both stayed green; neither suite's
counts moved because nothing about tool schemas, dispatch logic, or runtime
behavior changed.

**What this doesn't fix:** nothing enforces that the before shot actually
happens before the edit. There's no hook gating a code change on a prior
screenshot, and a QA request's evidence array accepts any HTTPS links
regardless of whether they're actually a before/after pair or even images
at all (`attention.ts`'s validation checks `label`/`url` shape and array
bounds, not content). If Claude skips straight to implementing and only
remembers the screenshot workflow afterward, the true "before" state is
already gone and there's no automatic recovery - same character of gap as
the reaction-based QA approval entry above, where a missed signal has no
durable trace to reconcile from later. This is a prompt nudging behavior,
not a constraint the runtime enforces.

## Durable action log, and refocusing manual durable notes on reasoning - 2026-08-21

Every progress event Claude's own working process produces - `type:
"thought"` or `type: "action"` - was hardcoded `ephemeral: true` at the
harness level, unconditionally, in `ClaudeHarness.run()`'s callback
(`src/claude.ts`). Ephemeral activities in Linear replace each other and
leave nothing behind once the run ends (Linear's own docs:
linear.app/developers/agent-interaction). So Claude's natural "here's what
I'm doing, here's what happened" narration vanished completely unless it
stopped to make a separate `linear_activity` call - which the prompt
actively discouraged for routine steps. The brief: make a genuinely
completed action durable automatically, for free, and refocus the prompt's
manual-note guidance onto reasoning the automatic log can't capture.

**Tracing the real shape mattered more than the fix itself.** The brief's
working assumption was that a `type: "action"` event carrying a `result` is
Linear's documented completion shape (`{action: "Searched", result: "12°C,
mostly clear"}`), and that becoming durable was a pure reclassification of
an event already flowing through the callback - no new correlation to
build. Tracing `createProgressProjector` in `claude-capsule/agent-request.mjs`
top to bottom, that assumption was wrong in a way that would have shipped
an inverted feature. Before this change, the *only* place an `action`
event ever carried a `result` was the `tool_progress` branch - a heartbeat
the SDK fires in 10-second elapsed-time buckets *while a tool call is
still running* (confirmed against the SDK's own `SDKToolProgressMessage`
type and the existing test at `agent-request.test.mjs` asserting
`result: "12s elapsed"`). A genuinely finished tool call's real output
arrives as a *separate* SDK message type, `SDKUserMessage`/`SDKUserMessageReplay`
(`type: "user"`, with `tool_result` content blocks carrying the tool's
actual text) - and nothing in this codebase read it. It flows through the
same `for await` loop in `runAgent()` untouched.

Gating on "has a result" against the code as it stood would have inverted
the intent on both sides: a bash command that finishes in under 10 seconds
(the common case) would log nothing, while one that runs for five minutes
would get a durable Linear post every 10 seconds, each just saying "N s
elapsed" - real spam, and not the "what happened" record the feature was
for. So this became a two-part fix instead of a one-line reclassification:

- `tool_progress`'s elapsed/retry text moved out of `result` and into
  `parameter` (e.g. `"rg -n TODO src · 12s elapsed"`). It's still-running
  status, not a completion, and it now can't be mistaken for one no matter
  what gates on `result`.
- A new branch handles `message.type === "user"`, reads each `tool_result`
  block's actual text, and reports one genuine `{type: "action", action,
  parameter, result}` completion per finished tool call. The correlation
  this needed already existed in a nearby, narrower form: `toolTargets`
  (tool_use_id → parameter) was already being populated at
  `content_block_start`/`content_block_stop` for the heartbeat's benefit. I
  added a sibling map, `toolNames` (tool_use_id → SDK tool name), because
  the transient `streamedToolCalls` entry that holds the name is deleted at
  `content_block_stop`, before the tool actually finishes.
- Both maps are scoped to one `createProgressProjector()` closure, i.e. one
  `runAgent()` call. That turned out to double as the guard against a
  second, harder-to-verify risk: whether a resumed session's `resume`
  replays prior turns' `SDKUserMessageReplay` messages through this same
  stream. I could not confirm either way from the SDK's type definitions or
  docs available here. It doesn't need resolving, because a `tool_result`
  for a `tool_use_id` this projector instance never saw start via its own
  `content_block_start` is skipped unconditionally (`toolNames.get(...)` is
  `undefined`) - old history from a prior process's projector instance
  can never be re-logged as a fresh completion, whatever the SDK's replay
  behavior turns out to be.

With `result` now meaning what it was assumed to mean, `src/claude.ts`'s
callback gates on exactly that: `ephemeral: !(progress.type === "action" &&
progress.result)`. An in-progress action (no result) and a thought both
stay ephemeral, unchanged.

**The plumbing between that callback and Linear turned out to have two more
places that would have silently eaten the whole feature.** `RunnerEvent`'s
activity variant (`src/runner-protocol.ts`) typed `ephemeral` as the
literal `true` - not `boolean` - and `parseRunnerEvent` rejected anything
else (`event.ephemeral !== true` threw). Left alone, the first durable
event crossing the runner's ndjson wire would have made
`PiRunnerClient.run()` throw and kill the run outright, not just drop the
event. And in `src/controller.ts`, the callback passed to `this.runner.run()`
(inside `execute()`, well clear of the sub-turn negotiation/clear-and-reopen
region around the Steering-reply branches) called `createEphemeralActivity`,
which hardcoded `{ ephemeral: true }` on every event regardless of what the
event actually said. Both were part of the same fix: the type widened to
`boolean`, the parser now checks `typeof event.ephemeral === "boolean"`, and
the controller callback (renamed to `publishActivity`, with
`createEphemeralActivity` kept as a thin `publishActivity(..., true)`
wrapper for its one always-ephemeral call site) now forwards `event.ephemeral`
instead of overwriting it.

**`ProgressReporter` (`src/progress.ts`) had two mechanisms built
specifically for ephemeral status that would have quietly broken a durable
log.** Its single `pending` slot is last-write-wins by design - correct for
"only the latest status matters," wrong for "every one of these must be
kept." And its dedup check drops a report whose JSON matches the last one
sent - correct for not re-showing the same ephemeral message, wrong for two
genuinely separate completions that happen to render identically. Durable
activities now go into their own FIFO queue, untouched by either mechanism:
`flush()` drains it in full, in order, before sending the ephemeral slot (if
any), and every entry is awaited and sent individually so one failure
doesn't block or drop the rest.

Updated the existing `agent-request.test.mjs` assertion for the
now-relocated elapsed-time text, and added: a completed-tool-call test
asserting the real `tool_result` text comes through as `result`; a
structured-content-block variant (an array of blocks rather than a plain
string); the never-seen-tool_use_id guard test described above; and an
empty-result test (an image `tool_result` with no extractable text logs no
durable entry rather than one with a blank result). In the main suite:
`runner-protocol.test.ts` gained a durable round-trip case and inverted the
old "ephemeral: false is rejected" assertion into "a non-boolean ephemeral
is rejected"; `claude.test.ts` gained a test asserting a completed action is
non-ephemeral while an in-progress action and a thought both stay ephemeral
in the same run; `progress.test.ts` gained two tests - a burst of two
durable events plus two ephemeral ones inside one debounce window comes out
as both durables in order followed by only the latest ephemeral, and a
durable event repeated verbatim is delivered every time rather than
deduplicated away.

`src/prompts.ts`'s guidance line (and its exact duplicate in
`claude-capsule/agent-request.mjs`'s system prompt, per `grep`) no longer
claims "most progress narration ... is not kept" - that's now false for
completed actions. It reads: "Every completed action ... is now posted to
the record automatically, so you don't need to narrate the what. Reserve an
explicit linear_activity call ... for the why the automatic log can't
capture: comparing tradeoffs between approaches, explaining a non-obvious
choice, flagging a discovery that changes the plan, or explaining why an
approach was abandoned." `test/behavior.test.ts` doesn't assert on this
line's exact text, so nothing there needed updating.

`bun run check` (132 tests, up from 128) and `bun run test:capsule` (18/18,
up from 14) both stayed green.

**What I couldn't fully rule out.** Volume is now bounded by tool-call
count rather than wall-clock time, which is the right shape - but a burst
of several tool calls that all complete within the same debounce window
(parallel bash/manage_linear/apply_patch calls in one turn, say) produces
that many uncoalesced `createActivity` POSTs to Linear back-to-back, each
awaited in sequence rather than spaced out. I have no way from here to
check Linear's actual per-session or per-app rate ceiling against that, so
I can't rule out a burst large enough to get throttled. This is a real,
unresolved risk, not a hedge - distinct from the SDK-replay question above,
which the per-instance tracking maps genuinely close off regardless of the
answer.

## Opportunistic staleness reconciliation - 2026-08-21

Linear's own docs (linear.app/developers/agent-best-practices) say it
plainly: "Follow-up activities after the first response can still be sent
for up to 30 minutes before the session is considered stale. Note that this
stale state is recoverable by sending another agent activity." `initialize()`
already knows how to read that signal - on every controller restart it calls
`agentSessionSnapshot()` once per persisted session and reconciles our local
belief against Linear's live `status` (plus, for that startup path only, the
type of the latest non-ephemeral activity): `complete`/`stale`/`error` clears
the local wait, `awaitingInput`/an open `elicitation` confirms it, anything
else is either resumed or left alone. The gap was that this only ever ran at
process startup. A long-running controller - the normal case, restarts are
the exception - never re-checked. If a human sat on an open Steering or QA
past Linear's 30-minute window, `state.attention` stayed populated and
`state.awaitingInput` stayed `true` in memory indefinitely, with nothing to
notice Linear had already moved on.

**The trigger I picked: any subsequent webhook for that same session, while
its attention is still open, opportunistically re-checks before the existing
reply-handling logic runs.** Concretely, in `handle()` (`src/controller.ts`),
right after the session's `SessionState` is looked up/created and before the
`payload.action === "prompted" && state.attention.length` block that
interprets an incoming reply, I added a guarded block: if
`state.attention.length` and the payload isn't a stop request, call
`agentSessionSnapshot(sessionId)` and check the live `status` against a new
`isTerminalSessionStatus()` helper (the `complete`/`stale`/`error` set,
extracted out of `initialize()`'s condition so both places name the same
three strings). If it's terminal, clear `attention`, `awaitingInput`,
`pending`, and `active` - bookkeeping only - before falling through to the
rest of `handle()`. I chose this over the alternatives for concrete reasons:

- **A new timer/polling loop** would be new architectural surface in a
  codebase that has none today, to solve something a webhook we're already
  receiving can just as well trigger. Not justified.
- **Checking unconditionally on every webhook, attention or not,** would add
  a GraphQL round-trip to the hot path of every ordinary mention and reply.
  Gating on `state.attention.length` means the extra call only happens for
  the rare case that actually needs it - a session currently blocked on a
  human.
- **`handleNotification()`'s dispatch** (`AppUserNotificationWebhook`) was
  the other candidate the brief raised, but most of what it handles isn't
  session-scoped - `issueMention` and friends carry an issue, not an
  `agentSession.id`, and the actual instruction is left to the
  `AgentSessionEvent` that `handle()` receives separately (see that
  function's own comment to that effect). The one notification path that
  *is* session-scoped for an open QA attention -
  `handleQaReactionApproval()`, triggered by a checkmark reaction - is a
  deliberate, different resolution mechanism (an explicit approval signal,
  not a staleness check) and didn't need touching.

**Why the live check is status-only, unlike `initialize()`'s dual check.**
I first wrote it to reuse the exact same OR condition as `initialize()`
(terminal status *or* latest activity type is `response`/`error`), reasoning
it was "the same reconciliation logic, just triggered differently." That's
wrong for this call site specifically. While an attention is genuinely open,
`execute()` skips `finish()` entirely (`src/controller.ts`, the
`!result.awaitingInput` guard) - `finish()` is the only place that posts a
`response`/`error` activity. So the latest non-ephemeral activity on a truly
open Steering/QA is the `elicitation` itself, not a `response`. That
heuristic is safe at startup, reasoning from a cold, static persisted record.
Live, checking it on every webhook a healthy open session receives would
have real false-positive exposure I couldn't fully rule out from here -
Linear's activity feed is an external system whose exact behavior when a
session idles isn't something I can enumerate with confidence. Since a false
positive here means silently discarding a real human decision mid-flight,
I kept the live check to `status` alone and left `initialize()`'s existing
heuristic untouched. Added a test - "does not clear a genuinely open
attention just because its latest activity looks like a closing response" -
that constructs exactly that shape (`status: "awaitingInput"` but the latest
activity is `type: "response"`) specifically to pin this down; without the
status-only restriction, that test fails.

**Why bookkeeping-only, not `dismissAttention()`.** The existing
`dismissAttention()` helper (used by `cancelMatching()` and the stop-request
path) both restores the issue to its pre-attention state *and* posts a
`response` activity. I considered reusing it here for consistency, but it
carries side effects this call site can't justify: if Linear's status is
`complete`, the issue may already have been resolved by other means, and
dragging it back to `previousStateId` off a speculative status read would be
actively wrong, not neutral. And posting any activity to a stale session is,
per the same Linear doc, exactly what recovers it from staleness - which
contradicts what "reconcile" is supposed to mean here (this session is done
with us, not resurrected). So the live reconciliation only clears the four
local fields and logs a `console.info`; the issue's Linear state is left
wherever it was.

**The stop-request guard.** The new block is skipped when `isStopRequest(payload)`
is true. Without that guard, a stop webhook arriving on a now-stale session
would get its attention cleared by the new check *before* the existing stop
handler runs, which would make that handler's own `dismissAttention()` call
a no-op (`attention` would already be empty) - silently dropping the
issue-state restore and the "Stopped by user" activity that a stop request
is supposed to guarantee. The stop path already handles a stale/absent
session fine on its own terms; it didn't need the new check layered under it.

**Residual gap, stated plainly.** This closes the case the brief described -
a session that goes stale/complete while waiting, then receives another
webhook. It does not close the case where no further webhook ever arrives:
a session opened for Steering/QA, ignored forever, with no reply, no
unrelated mention, nothing. That session's `attention`/`awaitingInput`
still only gets reconciled against Linear's live status the next time the
controller restarts. Catching that fully would need either a periodic sweep
or Linear pushing us a staleness event, and the brief was explicit that a
new timer is out of scope unless no webhook-driven trigger works - one does,
for the case actually described, so I didn't add one. This gap is real and
un-closed, not hedged.

Extracted `isTerminalSessionStatus()` as a small module-level function next
to `elapsed()`/`requiredIssueId()`/`isStopRequest()` at the top of
`src/controller.ts`, and had `initialize()` call it instead of repeating the
three-string array inline - a pure refactor, its branch behavior at startup
is unchanged. Added two tests to `test/controller-recovery.test.ts`: the
stale-session case above (asserts `agentSessionSnapshot` was actually
called, attention clears, the normal reply flow's `setIssueState`
restore/`reactToComment` checkmark do *not* fire, and the late reply still
starts a fresh run rather than being dropped) - and, in that same test, a
second reconciliation cycle on the same session where the fake snapshot
returns `"Complete"` (capitalized) instead of `"stale"`, to actually
exercise the "complete" half of "stale/complete" the task asked for and the
`.toLowerCase()` case-folding, rather than just asserting it by name - plus
the false-positive guard case described above (same assertions inverted:
the normal flow's restore and checkmark *do* fire, proving the live check
correctly left a healthy wait alone). `bun run check` (134 tests, up from
132 - one new test, one extended) and `bun run test:capsule` (18/18,
untouched by this change) both green.

## Durable-log reliability: retry and error marking - 2026-08-21

A fresh review of last night's "durable action log" change (previous
section) surfaced three gaps: durable posts are dropped silently on
failure with no retry; a failed tool call is logged identically to a
successful one; and `initialize()`'s recovery branching had never been
exercised with the latest activity being a durable `action` - which that
same change just made the common case for any session interrupted
mid-task, not an edge case.

**Gap 1 traced to one real site, not two.** The brief named two
"log-and-drop" spots: `AgentController.publishActivity()`'s
`createActivity(...).catch(console.warn)` in `src/controller.ts`, and
`ProgressReporter.flush()`'s durable-queue loop in `src/progress.ts`.
Tracing what `ProgressReporter`'s injected `send` actually *is* in
production changed the plan. `ClaudeHarness.run()` (`src/claude.ts`)
constructs the reporter with the callback `streamRun()`
(`src/runner-server.ts`) passes in: `async (event) => { if (!cancelled)
controller.enqueue(encodeRunnerEvent(event)); }` - a write into this run's
own outgoing ndjson HTTP stream, entirely local to the runner process. It
has no transient-failure mode to retry into: if `enqueue` throws, the
stream is already broken (the controller process disconnected, or
similar), so a second and third attempt fail identically, and every
*other* queued send - durable or ephemeral - fails right behind it.
`PiRunnerClient.run()` on the controller side then sees its read loop
throw, which is already handled: `start()`'s `execute(...).catch(...)`
reports the run as crashed and posts an "Agent run crashed" activity.
Retrying at this site would only add up to 750ms of dead sleep per
durable entry while a run is already failing, for no actual delivery
benefit. I left it alone functionally and replaced the comment above the
loop with an explanation of why, so the next person tracing this shape
doesn't have to redo the same trace.

The real, worth-retrying network call - `LinearClient.createActivity()`
posting to Linear's GraphQL API - happens one process over, inside
`AgentController.publishActivity()`. That's where a Linear 5xx, a network
blip, or the 15-second `GRAPHQL_TIMEOUT_MS` (added earlier tonight, per an
earlier section) firing once can genuinely and transiently fail a post
that should otherwise have gone through. `publishActivity()` now branches
on `ephemeral`: the ephemeral path is untouched (one attempt, log and
drop - a status about to be replaced anyway isn't worth retrying); the
durable path retries up to `DURABLE_ACTIVITY_MAX_ATTEMPTS` (3) times with
`DURABLE_ACTIVITY_RETRY_BASE_MS * 2 ** (attempt - 1)` backoff (250ms,
500ms) - the same attempt count and backoff shape as the existing
`putPreparedLinearUpload()` asset-retry in `src/linear.ts`, including its
pattern of an injectable `sleep` (defaulting to `Bun.sleep`, overridable
through a new optional 5th `AgentController` constructor argument so
tests never depend on a real timer).

The retry is inline and awaited, not handed to a background queue,
deliberately: the durable log is a chronological record, and a later
activity for the same session must never land in Linear before an earlier
one that's still retrying. The cost of that choice is real and worth
naming - worst case is three attempts at up to `GRAPHQL_TIMEOUT_MS` (15s)
each plus 750ms of backoff, around 46 seconds stalling that one event's
delivery (and, since `execute()`'s callback awaits `publishActivity()`
per event, delaying whatever progress the run produces next) before
giving up. Bounded and rare in practice, but not free. I judged that an
acceptable trade against silently losing part of the permanent record,
which is the entire point of the feature this closes a gap in.

`publishActivity()`'s two call sites (`createEphemeralActivity()`'s one
always-ephemeral use, and the `runner.run()` progress callback in
`execute()`) are the only two - confirmed by grep - so the change's blast
radius is narrow. One durable path was deliberately left out of this fix:
`manageLinear()`'s `request.action === "activity"` case calls
`this.linear.createActivity()` directly, un-retried. That's the
`linear_activity` tool Claude calls itself for manual reasoning notes -
unlike the automatic completion log, a failure there already surfaces to
Claude as a tool error it can see and react to in the same turn, which is
a fundamentally different exposure than the fire-and-forget progress
narrator this task described. Retrying it too would have been easy but
wasn't asked for and isn't the same gap.

On exhausting all three attempts, the durable post really is dropped -
but not silently: a counter and a `{ sessionId, at, attempts, message }`
record are kept and surfaced under a new `durableActivities` key in
`health()`, alongside the existing `linearInputs`/`notifications`
counters that were already there for the same reason.

**Gap 2: marking a failed tool call, and a second bug the first fix
would have hidden.** `toolResultText()` in
`claude-capsule/agent-request.mjs` extracts a `tool_result` block's text
but never reads `is_error` (confirmed present at the block level, not
nested in `content`, on `BetaToolResultBlockParam` in
`@anthropic-ai/sdk`'s own type definitions). The `message.type === "user"`
branch that turns a finished tool call into a durable `{type: "action",
action, parameter, result}` now checks it: when `is_error` is `true`, the
`action` label gets a `"Failed: "` prefix (`"Failed: Running command"`,
`"Failed: Applying patch"`) - matching this file's existing terse,
label-based style rather than inventing new punctuation or an emoji
marker.

A prefix alone would have re-created the exact shape of bug this gap
describes for one case: the branch only reports at all when `if (result)`
- and a failed call whose error carried no extractable text (a thrown
`Error` with an empty message, an `is_error` content array with no text
block) produces an empty `result` and would have been skipped entirely,
same as a genuinely empty *success* already is. That's the loudest kind
of failure staying invisible, which defeats the point. Fixed by falling
back to a placeholder (`"(no output)"`) only when `is_error` is true; an
empty-but-successful result is still skipped, unchanged.

**Gap 3: pinning down that `action` falls through the same way
`thought` does.** Reading `initialize()`'s branching
(`src/controller.ts`): a terminal status or a latest-activity type of
`response`/`error` skips as done; `awaitingInput` status or a latest type
of `elicitation` skips as a confirmed open wait; anything else - which
`action` falls into, since it's neither - resumes if the session was
`pending` or `running`, else skips. Existing tests only ever supplied
`thought` (resumes) or `elicitation` (waits) as the latest activity's
type; nothing exercised `action`, even though last night's own change
made a durable `action` the *expected* latest activity for exactly the
common case this branch exists to handle - a session interrupted
mid-task. Added a test mirroring the existing `thought` recovery case,
latest activity `{type: "action", action: "Running command", parameter:
"bun test", result: "ok"}`, asserting not just that the run resumed but
that `lastRecovery.skipped` is `0` and `awaitingInputSessions` is `0` -
so the test would actually fail if a future change accidentally routed
a durable `action` into either of the other two branches instead.

Added three tests to `test/controller-recovery.test.ts` (retry-then-
succeed, retry-exhaustion surfaced through `health()`, and the gap-3
recovery case) and two to `claude-capsule/agent-request.test.mjs` (the
`"Failed: "` marking, and the no-extractable-text placeholder). All three
controller tests inject a no-op `async () => {}` sleep so nothing depends
on a real timer - deliberate, given this suite's own documented flake
history around `Bun.sleep`-based polling. `bun run check` (137 tests, up
from 134) and `bun run test:capsule` (20/20, up from 18) both green, run
twice to be sure.

**Residual risk, stated plainly.** `health()` is not a place a human
looks unprompted - it's an endpoint someone has to think to curl, not a
push notification. A durable post that exhausts all three retries is
still, in the end, lost: the permanent record has a hole in it, and the
only trace is that counter plus a `console.error` line in the container's
own logs, discoverable only by someone who already suspects something is
wrong and goes looking. This is strictly better than gap 1's starting
point (a `console.warn` and nothing else, indistinguishable from an
ephemeral failure), but it does not close the underlying risk that a
sustained Linear outage silently thins out the audit trail this whole
feature exists to provide. Closing that fully would need Linear itself
notified some other way (a dead-letter surface like `webhook-inbox.ts`'s,
replayed once Linear recovers, or an out-of-band alert) - genuinely more
mechanism than this task asked for, and I didn't build it speculatively.
