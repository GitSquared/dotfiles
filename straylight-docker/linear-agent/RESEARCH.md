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

## Next live trial — 2026-08-19

The Claude-default and rationalized-attention slice converged successfully on
Straylight on 2026-08-18. Subscription usage was exhausted before a real task
could be delegated. The next step is one ordinary, low-risk real-work issue,
written normally without harness-specific prompt scaffolding. Observe the run
before expanding the system, especially whether it respects the requested
intent level, works autonomously without needless questions, and produces a
useful Steering or QA transition only when warranted.
