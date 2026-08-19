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

## Current experiment — rationalized attention

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

## Next hypotheses, not commitments

- An intent packet can preserve the chosen level of expression and make any
  attempted level-switch explicit.
- A visual review packet can bind a preview URL, state/viewport, screenshot or
  annotation, checks, and the last accepted intent.
- Observe whether the in-process Straylight MCP tools are narrow enough to keep
  Claude's authenticated capsule separate from each writable task jail.
- A fleet attention view should project current Linear Agent Sessions and issue
  priority, not become a second task database.

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
