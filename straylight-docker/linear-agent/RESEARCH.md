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

## Next live trial — 2026-08-19

The Claude-default and rationalized-attention slice converged successfully on
Straylight on 2026-08-18. Subscription usage was exhausted before a real task
could be delegated. The next step is one ordinary, low-risk real-work issue,
written normally without harness-specific prompt scaffolding. Observe the run
before expanding the system, especially whether it respects the requested
intent level, works autonomously without needless questions, and produces a
useful Steering or QA transition only when warranted.
