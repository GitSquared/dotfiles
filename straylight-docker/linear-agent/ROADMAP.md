# Straylight capability roadmap

This roadmap keeps Claude's tool surface small and semantic. Product-specific
mechanics belong in the trusted controller; Claude gets a few tools with verbs
that remain useful as Linear and the workbench evolve. Named "Pi" through
Slice 17 - that runner was removed entirely (Claude Code is now the sole
backend), the title just hadn't caught up.

## Slice 1 — capable remote workbench

Status: implemented on mainline Pi `0.84.0`; automated checks pass, awaiting
deployed Linear verification.

- Replace `ask_linear` with one `linear` collaboration tool:
  `request_input`, `block`, `share`, and `attach`.
- Upload screenshots, reports, and other review artifacts from `/workspace` to
  Linear's private file storage before publishing them in the Agent Session.
- Treat pull requests as ordinary session URLs. Linear can enrich GitHub PR URLs
  without Pi needing a `push_branch` or `open_pr` tool.
- Replace the replace-all plan tool with durable `manage_plan` verbs:
  `list`, `replace`, `add`, `update`, and `remove`. Mirror every mutation to the
  native Linear Agent Plan.
- Replace provider-specific access escalation with `request_access` for either
  the Claude workbench or the persistent developer-tool workbench.
- Make Pi explicitly online and explicitly enable its sandboxed read, write,
  search, and shell tools.
- Move the control runtime to Bun, retain Node.js 24 as a Pi/qmd compatibility
  layer, and add GitHub CLI.
- Persist GitHub CLI and Git credential-helper state in `/tool-profile`, mounted
  read-only into task jails without exposing the Docker socket or Linear credentials.
- Add bounded `delegate` verbs for explore, plan, review, and implementation
  helpers. Helpers get isolated contexts, share the session workspace, inherit
  cancellation, and cannot talk to Linear or Claude directly.

Acceptance:

1. Ask for a two-option decision and confirm Linear renders native choices.
2. Publish a Markdown note, PNG screenshot, and PDF from `/workspace`.
3. Attach an arbitrary HTTPS review URL and a GitHub PR URL.
4. Create a plan, complete one item, stop the task, then resume and confirm the
   same plan is reconstructed and updated.
5. Run `node --version`, `bun --version`, `gh --version`, and an outbound fetch.
6. With GitHub logged out, confirm Pi requests developer-tool access. Authenticate
   over SSH, reply `resume`, then clone and push through the retained profile.
7. Delegate one exploration task and one review task; stop during a helper run
   and confirm the helper process and task jail both terminate.

## Slice 2 — first-class web research

Status: implemented; extension loading is verified in the built image, while a
live search awaits deployed Pi authentication.

- Pin `pi-web-access@0.18.0` and load its declared extension entrypoint directly
  through Pi's SDK resource loader.
- Expose its four generic research tools: search, source checking, content fetch,
  and bounded retrieval of stored search content.
- Force the keyless Exa MCP provider and the non-interactive workflow for the
  headless Linear runner. Do not reuse browser cookies or open a curator UI.
- Give delegated helpers the same research tools without giving them Linear,
  Claude, or workbench-supervisor tools.
- Optionally copy an Exa API key from the persistent developer-tool profile when
  anonymous rate limits become a problem; no key is required by default.

Acceptance:

1. Search for a current fact and return source URLs.
2. Fetch and extract a documentation page without a browser.
3. Confirm anonymous rate limiting is reported clearly rather than treated as an
   authentication failure.
4. If an optional Exa key is configured, confirm it survives task containers and
   image rebuilds without appearing in Linear.

## Slice 3 — browser and development services

Status: implemented. The supervisor and prebuilt browser image were locally
verified against the real Docker Engine, including a cross-container Playwright
connection and rendered page. Project-specific migration, screenshot publishing,
and deployed browser QA remain acceptance checks.

Do not run Docker-in-Docker and do not mount the Docker socket into a task jail.
The trusted workbench supervisor exposes one generic `service` tool with
`start`, `status`, `logs`, and `stop` verbs. Every active run receives a private
auxiliary bridge network. Its task container joins that network as `task`; its
session-labelled service sidecars join only that network, publish no host ports,
have separate resource limits, and are removed on stop or disconnect.

Initial service templates:

- PostgreSQL 17.10 with disposable tmpfs storage by default and explicit
  per-session persistent storage under the private workspace
- Playwright 1.62 remote browser server reachable only from the matching task
  container, with a prebuilt Straylight-owned versioned image and WebSocket
  endpoint returned by the tool. Browser binaries and the launcher live in
  reusable image layers; only browser processes and runtime state are disposable.

Normal project dev servers continue to run inside the task jail and are tested
from the Playwright sidecar over the private session network. This reproduces the
useful local workflow without giving repository code control of Docker or the
host.

Acceptance:

1. Start PostgreSQL, apply migrations, run tests, and destroy it with the task.
2. Start a project dev server, drive it with Playwright, and publish a screenshot
   through `linear share`.
3. A stopped or crashed session removes every matching sidecar.
4. Sidecars cannot reach another session's workspace or services.

## Slice 4 — deeper Linear publishing

Status: implemented, awaiting deployed Linear API verification.

- Create, discover, read, and update issue-backed native Linear Documents for
  substantial Markdown review artifacts, including reuse across Agent Sessions.
- Create or refresh rich issue attachments for external reports, previews,
  deployments, and pull requests.
- Keep repository suggestions, private file/image upload, session URLs, native
  documents, and issue attachments behind the existing `linear` verbs.
- Return the final private Linear asset URL from controller-brokered file/image
  shares, allowing Pi to embed fresh images in Documents without exposing the
  controller's Linear credential or presigned storage capability.
- Keep these behind the existing generic `linear` verbs; do not add one tool per
  Linear mutation.
- Route semantic collaboration through an acknowledged controller broker rather
  than the best-effort transcript stream, so tool success means Linear accepted
  the operation.

The Agent APIs and Agent Plan APIs are still previews, so controller adapters and
tests should absorb schema churn without changing Pi's tool vocabulary.

## Slice 5 — live output, memory, and task-local extensibility

Status: implemented. The runner image was locally verified with qmd indexing and
retrieval from the persistent memory mount; live output, cross-session memory,
and Document updates still await deployed Linear acceptance.

- Stream Pi's cumulative user-facing assistant text through Linear's supported
  ephemeral activity surface, interleaved with semantic action cards, then emit
  one durable final response. Linear exposes no public activity-update mutation,
  so this is replacement-style streaming rather than an editable token stream.
- Keep shared cross-session Markdown notes under `linear-agent/memory/`. Pi can
  write concise notes directly and search them through one generic `memory`
  tool backed by qmd's local BM25 index; embeddings and model downloads are not
  required.
- Discover global and task-local Pi extensions. Pi may write scoped extensions
  under `/workspace/.pi/extensions`, then request a bounded resource reload that
  happens only after the current turn finishes.
- Remove the rigid final-response checklist. Use native Linear plans, blockers,
  elicitations, Documents, files, and URLs for structured communication.
- Keep extension execution inside the existing task trust domain. Do not copy
  untrusted repository extensions automatically or promote a task extension to
  the shared global profile.

Acceptance:

1. Watch a multi-paragraph Pi answer appear incrementally before the final
   durable response, without duplicate durable comments.
2. Save a non-secret Markdown note in one Agent Session and retrieve it from a
   separate session with `memory`.
3. Create a tiny task-local extension, reload resources once, invoke its tool,
   and confirm cancellation still stops the task jail.
4. Publish and then update an issue-backed Linear Document; confirm GraphQL
   validation failures include a useful safe diagnostic.

## Slice 6 — cost-aware model policy

Status: superseded. This slice's design (Pi allowlist/classifier/picker) was
built against the Pi fallback runner, which Slice 17 removed entirely -
`src/model-policy.ts`, `src/pi.ts`, `src/pi-resources.ts`, and `pi-config/`
are gone. Model selection today is a hardcoded `"sonnet"` literal
(`src/claude.ts`, `src/workbench.ts`); there is no allowlist, classifier, or
escalation logic left to build outcome/cost telemetry on top of. The plan
below is kept for reference only - re-derive a model-policy design from
scratch against the Claude-only runtime before reviving any of it.

- Store one small explicit allowlist in persistent Pi configuration. Each entry
  names provider/model, relative cost class, supported reasoning levels,
  capabilities, and eligible task classes. Query Pi's authenticated model
  runtime at startup and reject unavailable or unlisted choices.
- Classify each new session with the configured low-effort Luna router from
  scope, mutation risk, ambiguity, repository breadth, and requested work type.
- Choose the cheapest eligible model and reasoning level before the first main
  turn. Pi's SDK changes both on an idle session when the agent explicitly asks
  to escalate without losing its history.
- Instruct Pi to request one-tier escalation after a failed check-and-repair
  cycle, repeated tool loop, context pressure, or explicit uncertainty. Never
  silently downgrade during a turn, and never select outside the engineer-owned
  allowlist.
- Helpers currently inherit the parent model and reasoning level. Letting them
  choose a cheaper eligible tier within the parent's ceiling remains a future
  optimization; exceeding that ceiling must still require surfaced escalation.
- Surface the selection and escalation reason as short ephemeral Linear
  activities. The controller currently records elapsed time and outcome only;
  add per-turn model, reasoning level, token usage, and retry telemetry before
  claiming measured cost efficiency rather than merely economical routing.

The initial allowlist is Luna/low, Terra/medium, and Sol/high through the
`openai-codex` subscription provider, with Terra fallback. Keep volatile provider
prices in optional telemetry metadata rather than hard-coding them into prompts.

## Slice 7 — Bun-native control layer

Status: implemented and locally verified in the Linux runner image.

- Move the controller, workbench supervisor, task runner server, subprocesses,
  and tests to Bun and native Bun APIs where the required semantics are proven.
- Retain a small compatibility boundary for dependencies or Unix-socket Docker
  operations that Bun cannot yet replace safely.
- Keep protocol payloads and Linear UX unchanged so the runtime migration is a
  separately reviewable slice.

Implemented boundary: `Bun.serve`, Web `Request`/`Response` streams, request
cancellation, `Bun.spawn`, `bun.lock`, `bun install`, and `bun test` own the
control path. Long-running streamed and brokered requests explicitly disable
Bun's ten-second idle timeout after validation. `node:http` remains only for Docker Engine's Unix-socket API;
Node filesystem calls remain where atomic rename, POSIX modes, recursive copies,
or directory-entry metadata are required. The image retains Node for upstream Pi
executables and qmd's native SQLite installation, but all three Straylight entry
points execute with Bun.

## Slice 8 — warm sessions and adaptive concurrency

Status: implemented and locally verified; deployed latency and capacity
telemetry remain acceptance checks.

- Retain up to three completed session workbenches for ten minutes so follow-up
  questions reuse the Pi process, filesystem, project servers, browser, and
  development database instead of rebuilding the container graph.
- Disable Claude and development-service supervisor capabilities while a warm
  task is idle. Stop, cancellation, crash, LRU eviction, expiry, or supervisor
  shutdown removes the complete session graph.
- Begin with one runnable turn. Under queued demand, sample VM CPU and available
  RAM every ten seconds; open one extra turn when their rolling ten-minute p75
  is below 75% and 80%, and close spare capacity gradually under sustained
  pressure or lower demand. This deliberately has no configured floor,
  hardware-size magic number, or fixed upper ceiling.
- Report active, queued, and warm tasks plus the current adaptive active limit,
  p75 resource readings, and the last safe pre-cleanup failure diagnostic in
  workbench health.

Acceptance:

1. Complete a turn and follow up within ten minutes; confirm the task container
   id and running browser/project process are unchanged.
2. Follow up after expiry; confirm a new container reconstructs Pi history and
   workspace state.
3. Stop both an active and idle-warm session; confirm every matching task,
   sidecar, and private network disappears.
4. Queue multiple simultaneous turns on a quiet VM; confirm capacity
   grows one slot per healthy sample, then stops growing when CPU or RAM p75
   crosses its target.

## Slice 9 — measured context optimization

Status: RTK-only pilot implemented with a pinned, checksum-verified v0.45.0
binary and Pi hook; deployed savings measurement remains.

- RTK has a native Pi `tool_call` adapter and transparently compacts common Git,
  GitHub CLI, test, Playwright, search, and file-command output. Pin it in the
  image behind a feature flag, retain an explicit raw-output escape hatch, and
  compare total input tokens, repeat commands, missed diagnostics, and task
  success on representative runs.
- Do not install context-mode alongside RTK initially. It now has full Pi hooks,
  but adds eleven MCP tools, its own FTS5 store and session continuity layer,
  arbitrary-code execution surfaces, and mandatory routing. Those overlap the
  existing qmd memory, web tools, sandbox, and warm Pi sessions.
- Revisit context-mode only if telemetry shows large non-shell payloads or
  compaction remain a material cost after RTK. If trialled, disable its upgrade,
  hosted insight, and duplicate memory surfaces; pin the package and test its
  hook interaction with cancellation, Linear tools, and task-local extensions.

## Slice 10 — Linear as a durable control plane

Status: generic issue/project/document/relation/subissue operations, explicit Inbox
notification routing, durable controller recovery, and persistent webhook
inbox/retry/deduplication, plus bounded inbound files and multimodal images
implemented locally. Deployed Document create/list/update is verified; restart,
bitmap upload, and rich attachment acceptance remain.

- Persist the controller's session registry and reconstruct pending/running
  state from Agent Activities after a controller restart. Webhook deduplication,
  follow-ups, plan state, and stop must remain correct across process loss.
- Extend the existing `linear` tool with a small `manage` surface using resource
  nouns and generic verbs. Candidate resources are issues, properties,
  relationships, subissues, projects, and documents; do not expose raw GraphQL
  or add one tool per mutation.
- Pass user-supplied issue files and images into Pi as bounded multimodal input,
  with private-file download and content-type validation in the controller.
- Deliberately route useful Inbox notifications such as direct issue/comment
  mentions, new comments, and reactions. Avoid treating every issue comment as
  a new instruction; only explicit agent interactions should resume work.
- For a newly created mention session, make `agentSession.comment.body` the
  authoritative request for both model selection and Pi; retain the issue body
  and formatted prompt context as supporting material only.
- Keep the private storage PUT on bounded, retrying Bun fetch; use the
  controller's hop-specific errors to establish the failing boundary before
  introducing another transport.
- Add lightweight acknowledgement reactions only if they improve responsiveness
  without duplicating Agent Activities.
- Keep automatic queue delegation in Linear Triage Rules rather than building a
  second polling queue inside Straylight.

## Slice 11 — structured visual explanations

Status: implemented locally with pinned `visual-explainer@0.8.1`; deployed
generation, attachment, and browser rendering remain acceptance checks.

- Load the reviewed package's single `visual_explainer` tool, skill, and prompt
  set explicitly from the runner image. Do not download extensions at task
  startup or let repositories choose this shared capability.
- Map its fixed `~/.agent/diagrams` output onto the session's writable
  `/workspace/.agent/diagrams` directory. Render headlessly with `open: false`,
  then use the existing generic Linear share operation or browser service.
- Use it for architectures, schemas, plans, comparisons, and technical recaps.
  Keep bitmap/photo generation out of scope until a separately authenticated,
  reviewed image-generation provider is justified.

Acceptance:

1. Ask for a small architecture or schema view and confirm Pi selects the
   `visual_explainer` skill without a manual slash command.
2. Confirm the complete HTML appears in both mapped paths, survives a warm
   follow-up, and uploads through `linear share` from the workspace path.
3. Serve the HTML from the task container, inspect it through the owned browser
   service, and publish a screenshot with no browser-console or layout errors.

## Slice 12 — compact re-entry, closure, and Document review

Status: issue-backed review is implemented locally; a deployed probe showed
that Linear currently rejects Agent Sessions anchored directly on Document
comments. This builds on native
Linear issue, Agent Session, plan, and Document surfaces without introducing a
second task-card database or a rigid final-comment template.

- Maintain one compact re-entry projection at meaningful checkpoints. It should
  cover `Now` (at most three sentences), lifecycle status, the exact thing Gaby
  needs to do, recent consequential decisions, impact, genuine blocker, evidence
  links, and the next safe checkpoint. Omit empty fields, transcript narrative,
  tool output, and discarded paths.
- Use native issue properties and Agent Session state for queryable lifecycle and
  attention placement. Use an issue-backed work-record Document only when the
  task needs richer durable orientation; list existing Documents and update the
  same one by id rather than creating checkpoint copies.
- At closure, reconcile the original request and current Linear plan. Give every
  remaining item an explicit disposition: done, blocked, deferred, abandoned,
  or a named next owner/action. Distinguish implementation, merge, deployment,
  and customer-visible completion instead of treating any one as generic done.
- Add generic Document-comment discovery, thread reading, reply, and resolution
  operations behind the existing `linear` tool. Prefer anchored review comments
  when Linear's API exposes them; otherwise retain the exact selected text and
  Document id in an ordinary review thread.
- Make an explicit Document review request authoritative input to an
  issue-backed Agent Session, including the current comment thread and bounded
  Document context. Treat ordinary edits, subscriptions, and unmentioned
  comments as context-only notifications so they do not synthesize new
  instructions. Keep direct Document-comment mention routing quarantined until
  Linear supports an Agent Session anchor for that comment type.
- Let Pi disposition a batch of review comments, revise the existing Document,
  and report which comments were applied, declined with rationale, or still need
  a decision. Keep the reviewed Document and its comment trail as evidence.

Implementation notes:

- `manage_plan reconcile` requires one explicit terminal disposition for every
  current plan item. Linear's native plan has only completed/canceled terminal
  states, so blocked/deferred/abandoned entries use canceled natively while the
  visible item text preserves the exact disposition, rationale, owner, and next
  action.
- The generic `linear manage` surface now supports Document comment list, get,
  create with anchored quoted text, reply, update, resolve, unresolve, and
  delete. No review-specific one-off tool was added.
- The controller resolves a Document mention's source comment through Linear,
  includes the root thread and at most 80 KB of current Markdown, and lets Pi
  continue with the mention body if that supporting lookup fails.
- Linear delivers Document-comment mentions as Inbox notifications, but its
  current `agentSessionCreateOnComment` mutation rejects Document comments with
  `comment must be on an issue`. The controller classifies that validation as a
  permanent delivery, retains only safe event metadata in the dead-letter
  ledger, and stops retrying. Ordinary Document comments remain context-only.
- Re-entry remains a compact behavioral contract over native lifecycle, plan,
  and one optional work-record Document. It is intentionally not a mandatory
  comment template or a second persisted state model.

Acceptance:

1. Pause a multi-step task, return later, and identify current state, required
   attention, evidence, and next action from Linear without reading the Pi
   transcript.
2. Close a task with partially completed scope and confirm every original plan
   item has an explicit disposition and customer-visible completion is honest.
3. Link an existing Document from an issue-backed session; confirm the agent
   reads the relevant Document and thread, updates the same Document, and
   replies in the review surface. Separately mention Straylight directly in a
   Document comment and confirm one safe dead-letter entry replaces indefinite
   retries.
4. Add an ordinary unmentioned Document comment or edit and confirm it remains
   context-only and does not start or redirect Pi work.
5. Submit several Document review comments and confirm Pi returns an auditable
   applied/declined/needs-decision disposition for each without creating a new
   Document.

## Slice 13 — rationalized attention requests

Status: implemented locally; deployed interaction and queue-pressure measurement
remain acceptance checks.

- Replace open-ended `request_input` with a dedicated semantic attention
  request. Signal is a queued nonblocking question or notification, Steering
  pauses for a required answer, and QA pauses checked work for human ownership.
  Delivery remains separately classified as an interruption or queued review.
- Materialize every request as a Linear child issue assigned to the sponsoring
  engineer. Use native priority for ordering and labels for Signal/Steering/QA plus
  Blocking/FYI; blocking items pause and route replies to the parent, while FYIs
  remain acknowledgement work and let the parent continue.
- Require the exact human action, the relevant original intent, what changed,
  the agent's recommendation, the impact of waiting, and the real response
  window. Choice cards remain optional and reserved for genuine judgment calls.
- Require at least one HTTPS evidence link before QA can enter the queue. The
  agent should upload screenshots or reports and attach previews, Documents, or
  pull requests before requesting review.
- Keep the active attention projection in the durable controller registry and
  expose aggregate counts by kind, delivery, priority, and blocking state in
  health. Do not create a second task database or copy the full private request
  into telemetry.
- Restore an `awaitingInput` session after controller restart without replaying
  the work that produced its elicitation, then clear the attention projection on
  a human follow-up, stop, terminal completion, or cancellation.

Acceptance:

1. Attempt QA without evidence and confirm the broker rejects it before Linear
   is disturbed.
2. Request a queued Signal and confirm its FYI child remains while the parent
   continues; request QA with a preview and confirm it blocks for approval.
3. Request blocking Steering with real options and confirm Linear creates its
   child Agent Session, renders a native select signal, and routes the reply back
   into the paused parent while still accepting free text.
4. Confirm controller health distinguishes Signal, QA, Steering, FYI,
   blocking, urgent, and true interruptions across simultaneous sessions.
5. Restart the controller while an attention request is pending; confirm it
   remains awaiting input and does not rerun tools or external actions.

## Slice 14 — pilot lifecycle and repository-cache hardening

Status: implemented locally; deployed acceptance pending.

- Give operators one `./compose` wrapper that derives the live Docker socket
  group for every fresh SSH shell. Keep `DOCKER_GID` out of `.env`.
- Refresh each allowlisted repository cache centrally at most once per TTL.
  Task jails continue to mount caches read-only, borrow their Git objects, and
  keep the canonical authenticated HTTPS remote as `origin`.
- Add Claude's initial semantic `finish_work` capability and structured terminal
  dispositions. Slice 15 removes agent-declared completion and replaces the
  generic human-blocked state with explicit Steering and QA transitions.
- Use a deterministic Claude Stop callback for one repair turn when the
  disposition is missing, conflicts with attention state, or the final summary
  appears to require an engineer without a blocking child issue. Keep the same
  disposition in the runner protocol so future backends can adopt it.
- Log only tool names plus terminal disposition for each Claude run, giving the
  pilot enough evidence to distinguish an ignored collaboration tool from a
  broker failure without retaining tool arguments or private task text.

Acceptance:

1. Start a fresh SSH shell and run `./compose run ... gh auth status` without
   exporting `DOCKER_GID`; confirm authenticated GitHub access works.
2. Push a new commit upstream, delegate two sessions inside the cache TTL, and
   confirm one central refresh plus canonical HTTPS task origins.
3. Give Claude a missing-access blocker and confirm it cannot end as ordinary
   completion: a blocking Steering child appears and health reports it.
4. Complete a normal low-risk task and confirm the later Slice 15 QA transition
   supersedes the original self-declared completion behavior.
5. Restart after a permanently unsupported Document-comment delivery and
   confirm pending becomes zero while one bounded dead-letter summary remains.

## Slice 15 — human-owned completion and quiet-stream survival

Status: implemented locally; deployed acceptance pending.

- Make the normal loop rigid: Signal is nonblocking and work continues; Steering
  waits for required input; QA waits for human approval. Remove `completed` from
  Claude's `finish_work` surface so the default runner cannot end with an
  ambiguous invitation.
- Give QA standard approval controls. Exact approval completes the QA child and
  parent issue without another model turn; every other response resumes the same
  parent workspace and conversation for changes before another QA handoff.
- Require QA evidence, force external blockers and deferrals to name a next
  action, and fail closed if terminal prose still asks the engineer to "let me
  know", review, or confirm outside an attention transition.
- Give the Pi fallback the same lifecycle contract: one bounded repair turn when
  it stops without a disposition, an inline tool guard after any terminal
  transition, and `finish_work` only for external blockers or deferrals. Route
  its missing-access path through a blocking Steering child too.
- Emit an invisible NDJSON heartbeat every 15 seconds, suppress Bun's native
  long-fetch timeout where supported, and send replacement-style visible progress
  for quiet Claude turns.
- Keep the Linear setup thin: existing Started/Completed states, lazy attention
  labels, native child issues, assignee, and priority. Treat a saved attention
  view as optional and add no mandatory board or workflow state yet.

Acceptance:

1. Keep a Claude run quiet for longer than five minutes and confirm the runner
   stream remains connected while visible ephemeral progress changes.
2. Ask for a nonblocking question or notification and confirm a Signal child is
   queued while work continues to Steering or QA.
3. Require a decision and confirm only Steering pauses and resumes the parent.
4. Finish checked work and confirm QA is mandatory, includes evidence and fixed
   approval controls, and cannot degrade into "tell me if you want more" prose.
5. Approve QA and confirm parent and child complete without inference; request
   changes instead and confirm the same parent resumes and later returns to QA.
6. On the Pi fallback, omit a terminal transition and confirm one repair turn is
   forced; omit it again and confirm the run fails instead of publishing an
   ordinary completion.

## Slice 16 — attention rationalized by consequence, not uniformly

Status: implemented and iterated against live deployment across several same-day
rounds of real delegated tasks; acceptance below reflects what those rounds
actually found, not a first guess.

- Replace the uniform child-issue-per-request mechanism from Slice 13
  (label creation was crashing in production - a workspace-level label never
  matched the team-scoped lookup, so the same duplicate-name create was
  retried every time) with tiers matched to whether the request actually
  blocks the run: Signal is a plain comment on the issue, nothing more, and
  never ends the turn by itself; Steering and QA flip the issue to a
  configured workflow state (`LINEAR_ATTENTION_STATE_NAME`, resolved by name
  and failing with an actionable error if a team lacks it - there is no
  generic `blocked` workflow-state type to look up) and post as the session's
  own elicitation Activity; `defer_followup` creates a genuine subissue for
  out-of-scope discoveries, gated by a forced justification (what, why not
  this task's job, what re-surfaces it) so an agent can't manufacture
  busywork nobody owns.
- Confirmed live, not assumed: a plain comment reply never resumes a paused
  Agent Session. Comments and the session's own prompted-event delivery are
  separate mechanisms; only the elicitation's native surface (real
  approve/deny controls plus a dedicated reply box) actually resumes one.
  This reverses Slice 13/15's design of posting the same content as both a
  child issue and its own session - keeping both was never redundant polish,
  it was one working channel and one that silently did nothing.
- Attention now tracks which comment thread it is actually about, so a reply
  to some unrelated earlier Signal comment on the same issue is never
  mistaken for the answer to an open Steering/QA.
- Extended `manage_linear`'s comment and document resources to create and
  list directly on the current issue (previously Document-only for both),
  removing a real gap that cost an agent 18 tool calls fighting it on one
  live run. Replaced the resulting raw-id progress noise with a short phrase
  table so `manage_linear` progress reads as a sentence.
- Added prompt guidance, since a live re-delegation crashed on exactly this:
  don't trust a prior summary's completion claim without verifying current
  state, and "nothing changed" is never a reason to stop without a real
  lifecycle transition - request QA again instead.
- Tried and reverted mid-slice: bumping issue priority to match request
  urgency, restored on resolution. The engineer's own call - priority is his
  signal for triage order across many issues, not the agent's to touch even
  temporarily.

Acceptance:

1. Request a Signal and confirm it lands as a plain issue comment - no
   label, no subissue, no elicitation card.
2. Request blocking Steering or QA and confirm the issue flips to the
   configured attention state, the elicitation shows real approve/deny
   controls (or accepts free text), and a plain comment reply elsewhere on
   the issue does not resume the run.
3. Reply through the elicitation itself and confirm the issue restores its
   prior status and the run resumes using the actual reply content.
4. Delete a delivered artifact, archive the session, and re-delegate the
   same issue; confirm the agent verifies current state rather than trusting
   a stale "already done" summary, and resolves through a real transition
   instead of failing with no recorded disposition.
5. Confirm `defer_followup` creates a real subissue carrying its
   justification fields, without pausing the current run.

## Slice 17 — Claude-only runtime, native auth signal, mention continuity

Status: implemented and locally verified (typecheck, full `bun run check`,
and the capsule test suite all green); deployed acceptance pending.

- Removed the Pi fallback runner entirely - `src/pi.ts`, `src/pi-resources.ts`,
  `src/model-policy.ts`, `pi-config/`, the `askClaude`/`/v1/ask` CLI-shell-out
  path, and the `STRAYLIGHT_RUNNER` backend switch. Claude Code is now the
  only runtime. Traced every caller rather than assuming from naming alone:
  `WorkbenchHarness.runClaude` looked like more of the same dead machinery
  but is the live security relay for the primary Claude run (a task
  container's `CAPSULE_URL` points at the workbench on purpose, not the real
  capsule), so it stayed.
- Wired Linear's native `auth` Agent Activity signal to the existing
  missing-access Steering path (`request_attention`'s new `missingAccess`
  parameter): a dedicated account-linking control in Linear's UI instead of
  a plain comment, with `capsuleAuthUrl`/`toolAuthUrl` finally threaded from
  `RunnerConfig` through to the capsule tool rather than sitting unused.
- Documented `linear_activity`'s `publish`/`external_url` actions to the
  model for the first time (previously code-complete but invisible to the
  agent through its only interface, a natural-language tool description) and
  added explicit guidance to publish a pull request or live preview the
  moment it exists, attaching it to the issue's own Links section, not just
  waiting for the final summary.
- Closed the narrower, safe half of the mention-as-thread gap: a new mention
  on an issue with a dormant (not actively running) prior session now
  resumes that session's own Claude Code conversation instead of starting
  blind, using the same cross-container relay the Pi-removal trace
  surfaced. A mid-turn sibling is left untouched - real concurrent-session
  routing is still the larger, deliberate design flagged in RESEARCH.md, not
  a bolt-on.

Acceptance:

1. Confirm `STRAYLIGHT_RUNNER`/`pi-config` are gone from the deployed
   compose file and the controller starts with no Pi-related environment
   variables configured.
2. Delegate an issue with a deliberately broken developer-tool credential;
   confirm the Steering elicitation renders Linear's native account-linking
   control, not a plain comment link.
3. Confirm a pull request opened mid-run appears as an issue Attachment
   before the run ends, not only in the final summary.
4. Mention `@straylight` on an issue with a completed (not running) prior
   session; confirm the new session's first response shows awareness of the
   prior conversation's specifics rather than re-deriving them from the
   issue description, and confirm it re-clones the repository and
   re-checks-out its branch in the new container rather than assuming the
   old checkout is still on disk.
5. Mention `@straylight` again while a previous session on the same issue is
   still actively running; confirm the new session starts a genuinely fresh
   conversation (with the existing sibling-activity warning), not a shared
   one.

## Slice 18 — parallel work streams and a richer signal taxonomy

Status: the ask tier, the decision model, and QA surfacing still-open
asks are implemented and locally verified (typecheck, full `bun run
check`, and the capsule test suite all green); deployed acceptance
pending. Sub-issue-per-stream and genuine concurrent sub-agent execution
stay explicitly deferred - see "Not decided yet" at the end.

Implemented: `linear_activity`'s new `{action: "ask", question}` posts a
tracked, non-blocking comment thread (`src/controller.ts`'s
`collaborateLinear`), recorded in new session state
(`state.openAsks: OpenAsk[]`, `src/attention.ts`) that never touches
`awaitingInput` or issue status. A reply landing on a *specifically
tracked* thread - matched by exact comment id, not just "any reply on
this issue" - resumes the agent with that answer via the same internal
path a real Steering/QA reply uses, unless a blocking Steering/QA is
already open on that session (deliberately left unrouted rather than
fighting that resume path). A QA elicitation's body now lists any
still-open tracked asks explicitly, rather than depending on Claude to
remember to mention them. The four-step decision checklist (override on
irreversibility/destructiveness/security-boundary or the outcome not
clearly deriving from what was asked; an altitude filter for whether a
question is even product-level; investigate first; proceed on a cheap,
reversible guess and record it as a plan-item assumption otherwise) is
in both `src/prompts.ts` and the capsule's own SDK `systemPrompt`,
identically.

An adversarial review pass on the first implementation caught three real
gaps before this landed: the ask-removal-then-resume sequence in
`routeAskReply` wasn't atomic (a resume failure could silently lose the
human's reply with no way to retry - fixed by restoring the ask and
logging on failure, verified by a test that fails once then succeeds on
retry); two pre-existing `createActivity` calls in the same-turn
follow-up path lacked the `.catch()` every sibling call already has,
so a transient failure there would have surfaced as an unhandled
rejection; and the routing had no actor-identity guard against the app's
own comments, unlike its `handleQaReactionApproval` sibling. All three
fixed and covered.

Origin: Gaby rejected the one-blocking-ask-at-a-time model as an accident
of avoiding a platform limit, not a real fix for "several pending
decisions arrive together and I lose track of the ones I didn't dig
into." A 5-lens panel (attention, throughput, archivability, platform
feasibility, failure resilience) reviewed his proposed schema; Gaby then
corrected and tightened the panel's synthesis directly. What follows is
the settled result, not the panel's raw output.

**The hard platform constraint, driving everything below:** a Linear
`AgentSession` has exactly one `status` field, computed from "whichever
activity landed last" (Linear's own docs, and independently proven by this
repo's own 2026-08-19 incident where a follow-up tool-call activity buried
a fresh elicitation). Parallelizing *work* is unreservedly fine.
Parallelizing *how many things can hold Linear's one native blocking slot
at once* is not something the platform allows, no matter how it's built.
"A stream blocks itself" and "a stream interrupts Gaby in real time" are
two different mechanisms with different cardinalities, full stop.

**The decision model — when the agent asks vs. just decides:**

Work-parallelization and question-parallelization are separate axes.
However the agent splits implementation into concurrent threads (its own
discretion - not a fixed backend policy, see below) has nothing to do with
which product questions come up along the way; a question about database
indexing doesn't belong to "the backend thread," it's a challenge to the
precision of the original expressed intent, cutting across whatever
structure the work happened to take. Every such question runs through this
procedure, in order:

1. **Override (trumps everything below, either condition alone is
   enough):** is the action irreversible, destructive, or does it cross a
   security/access boundary? Or - independent of risk or cost - does the
   outcome *not* clearly derive from the expressed instruction, i.e. you
   cannot look at {the decision} and {what was actually asked} and
   confidently trace a direct line without several inferential hops or a
   quiet expansion of scope? Either one forces a real, genuine ask,
   regardless of every check that follows. The second condition exists
   specifically to catch compounding drift: each individual step can look
   locally defensible while the cumulative trajectory becomes a task
   nobody actually asked for.
2. **Altitude filter:** is this even a product-level concern - product
   sense/taste, user-facing interaction design, overall backend
   design/maintainability, or operating cost? If not - which of two
   equivalent internal work-splits, a button's exact widget choice with no
   distinct UX implication, internal naming - the agent just decides,
   permanently, no confirmation needed, ever. It can still land in the
   routine traceability journal (free, passive), but it never becomes
   something waiting on Gaby's review.
3. **Investigate.** For anything that clears the altitude bar: can
   existing convention, precedent elsewhere in the codebase, or
   documentation actually settle it? If yes, there was never a question to
   raise - just do it.
4. **Cheap and reversible:** if investigation can't settle it but a wrong
   guess is cheap to detect and undo (a revert, a follow-up patch, nothing
   already shipped or externally visible), proceed on the best guess and
   record it as an assumption (mechanism below) rather than stopping.
5. **Genuine ask:** anything left - a real preference/priority call
   investigation can't resolve, not cheap to silently get wrong - becomes a
   non-blocking tracked question (the "ask" tier, below), not an interrupt
   that stalls the rest of the work.

**Assumption tracking needs no new entity.** An assumption is a plan item
(`manage_plan`) written to say so, backed by a durable journal entry
explaining the reasoning - both mechanisms already exist and already
require every plan item to carry a disposition before a terminal
transition (`src/plan.ts`'s `reconcilePlan`). No new field, no new status:
Claude composes the checkpoint by reading its own plan and journal and
explicitly calling out which items are still tagged as assumptions, the
same way it already has to reconcile every plan item before QA.

**The "ask" tier - non-blocking, tracked, independently resolvable.**
Instead of a blocking elicitation, post a real comment thread; track it
(`commentId`, question, timestamp) without touching session status or
`awaitingInput`. Several can be open at once safely, because comment
threads - unlike session status - carry their own independent
resolved/unresolved state. A reply landing on a *specifically tracked*
thread routes back as an answer to that question instead of being
discarded as context-only (today's deliberate treatment of plain replies,
which stays the default for anything not tracked). If a tracked ask never
gets answered, it surfaces as an explicit unresolved line at checkpoint,
tied to whatever assumption the agent proceeded under in the meantime.

**Checkpoint QA** stays the existing elicitation mechanism, unchanged at
the wire level - composed content is what's new. One per expressed
intent, never per stream: an index of outcomes plus links to evidence,
and a rollup of every assumption and open ask still unresolved - pulled
from the plan/journal that were already being kept live, not assembled
fresh from raw logs. It must never fall back to quoting a raw trace
directly; a checkpoint that's just "whatever accumulated, dumped" is the
same bundling failure that started this conversation, one level up.

**Not decided yet, deliberately:**

- Whether a stream defaults to its own Linear sub-issue for archive
  separation, or stays internal orchestration state promoted only when it
  earns independent visibility. Real tension with `defer_followup`'s
  existing anti-busywork gate either way.
- Whether a stream needs its own real `AgentSession` (a native per-stream
  status/blocking slot, at the cost of a new container and Linear object
  per stream) or can stay an in-process sub-agent inside the current
  session (cheap, but blocking has to ride entirely on the ask-tier).
- The native blocking slot's priority rule when more than one thing
  legitimately wants it - blast-radius-with-preemption is the leading
  idea, not yet designed in detail.
- Genuine concurrent sub-agent execution under a supervisor. Today there is
  exactly one sequential Claude Agent SDK loop per session; real
  "stream 1 keeps working while stream 2 waits on Gaby" needs that to
  exist first. Reserve for after measuring whether free read/verification
  fanout (no new architecture, buildable today) already captures most of
  the value real parallelism was reaching for - fan out writes only when
  paths are provably disjoint, since the common issue is one coupled
  change where coordination overhead costs more than it saves.

## Slice 19 — streaming input (live signals mid-turn)

Status: design proposed after a research pass, not decided, not built.

Origin: the GAB-15 crash (Slice 18's ask tier queuing a reply mid-run,
then auto-starting a doomed second turn right after the first one opened
a blocking QA) is a direct symptom of a deeper fact: today's capsule
invokes the Claude Agent SDK in one-shot "print mode" - `query({prompt:
someString, ...})` - and `ClaudeHarness.followUp()`
(`src/claude.ts`) is a hardcoded `return false`, with its own honest
comment: "Claude's print-mode turn is not bidirectional." A live Linear
signal arriving mid-turn has nowhere to go but a queue that only drains
once the turn fully ends. Gaby's own framing: "the same intelligence
[should] get all the new signals as i send them, and give it a clear set
of tools to answer them... prioritize trodding along on its main work or
answering me or just reacting with an emoji... like a coworker would."

**The SDK genuinely supports this.** `query(prompt: string |
AsyncIterable<SDKUserMessage>)` accepts a live stream instead of a
string; the returned `Query` object has `streamInput(stream)` to keep
pushing messages into an already-running conversation, plus
`interrupt()`, `backgroundTasks()`, and mid-session reconfiguration -
all gated behind streaming input, none available in today's print mode.
`SDKUserMessage` even carries a `priority: 'now'|'next'|'later'` field,
though its exact semantics aren't elaborated in the SDK's own type
definitions - a real unknown, not assumed behavior.

**Two approaches, not five:**

- **A - session-lived Query.** One `Query` per Linear session, open from
  first webhook to terminal disposition, surviving blocking Steering/QA
  waits (potentially hours). Requires pinning or rebinding the task
  container across that whole window, holding a runner capacity slot
  continuously, making the Stop-hook's one-disposition-per-run invariant
  session-scoped instead of per-turn, and an idle-timeout policy with a
  cold-path fallback.
- **B - turn-scoped streaming Query (recommended).** Turn boundaries
  stay exactly as today (start -> terminal disposition), but `query()`
  takes an `AsyncIterable<SDKUserMessage>` instead of a plain string, so
  the runner can push new messages into the *live* turn while it's
  running. Container lifecycle, warm-task TTL, capacity accounting, and
  the per-turn disposition invariant are all untouched. Between turns,
  resume works exactly as it does today.

**Why B, not A:** A's only marginal gain over B is skipping the
cold-resume round-trip after a human reply - bought at the price of
every cascade above, concentrated in exactly the interval (a human
sitting on an open QA) where holding a live container and subprocess is
least wanted. B closes the entire failure window that actually exists: a
signal has nowhere to go *only while a turn is actively running*, which
is precisely the GAB-15 case (the reply arrived mid-run, before QA was
even requested). B is also a strict prerequisite of A, so nothing built
here is wasted if A is ever revisited. One correction worth naming: an
initial read of the codebase called session-lived tool credentials
(`taskUrl`/`taskToken`, rebound whenever the workbench replaces a warm
task container) a hard blocker for A - overstated. `forward()` in
`claude-capsule/agent-request.mjs` reads those fields at call time, not
once at construction, so rebinding on container replacement is a field
write, not a full `Query` restart. That makes A cheaper than it first
looked, but doesn't change the recommendation - B wins on its own terms.

**Phased plan, cheapest/most de-risking first:**

0. **Spike, no product code. Done, 2026-08-24 - passes, with a corrected
   mental model.** Ran a standalone streaming `Query` (not in the
   capsule - a scratch script pointed `pathToClaudeCodeExecutable` at the
   system CLI) that started `sleep 12 && echo DONE_SLEEPING` as a Bash
   tool call, then pushed a second `SDKUserMessage` the instant that
   tool_use was observed - i.e. genuinely mid-flight, not before the
   first turn even started (an earlier naive attempt using a blind
   `setTimeout` instead of gating on an observed event pushed the second
   message before any assistant turn existed at all, and just measured
   CLI startup latency - not a real test; discarded once corrected).

   Two mechanisms exist, and they are opposites, not variants:
   - **`priority: "now"` acts as an interrupt, not a side-channel.** The
     in-flight Bash tool call was cancelled outright - the tool_result
     came back `is_error: true`, `"The user doesn't want to take this
     action right now. STOP..."`, `non_execution_kind: "cancelled"` - and
     the whole turn ended with `terminal_reason: "aborted_streaming"`.
     `sleep 12` never completed; no `DONE_SLEEPING`, no reply to the
     injected message either. This is functionally `interrupt()` wearing
     a different name, not a way to answer a ping "on the side."
   - **`shouldQuery: false` queues without disrupting, but isn't
     instant.** The same Bash tool call ran to full, undisturbed
     completion (`task_started` -> `task_notification: completed` ->
     tool_result `DONE_SLEEPING`). The injected message produced no
     assistant turn of its own - exactly as the SDK's own doc comment
     says ("merged into the next user message that does query"). Only
     once the sleep tool's result naturally started the model's next
     turn did it address both things at once: `"PONG\n\nThe sleep
     command already completed with DONE_SLEEPING."`

   **Verdict:** there is no mode where a live signal interrupts a tool
   call mid-execution without cancelling it - that's not on offer. The
   real choice is interrupt-and-lose-the-tool-call vs. queue-and-batch-
   into-the-next-tool-result-boundary. `shouldQuery: false` clears the
   gate as originally written ("lands at the next tool-result boundary,
   proceed"), and on reflection that boundary *is* the coworker
   behavior, not a fallback from it: a coworker mid-build doesn't drop
   what they're doing to read a Slack ping either, they glance at it
   once the build finishes. Almost every tool call this agent makes -
   a `Read`, an `Edit`, a short `grep`, a quick status check - resolves
   in seconds, so in the common case "next tool-result boundary" reads
   as immediate. The gap only becomes noticeable for the minority of
   long-running calls (a test suite, a build, a long wait), which is
   exactly when a human coworker would also be heads-down and slow to
   check their phone. Already a real improvement over today either way
   (a queued reply currently waits for the *entire remaining plan*, not
   just the in-flight tool).
1. **Done, 2026-08-24.** `claude-capsule/agent-request.mjs`: `runAgent`'s
   `query()` prompt is now `createInputQueue()`'s long-lived AsyncIterable
   (the exact push-based-queue shape validated live in the Phase 0 spike)
   instead of the raw `input.prompt` string. Correction to an earlier
   draft of this entry: this is *not* "purely additive" - the injection
   *capability* is unused so far (`server.mjs` doesn't call it, `resume`
   is untouched), but the *transport* changed for every run, print mode
   included, since `query()` now always gets a streaming prompt. That
   distinction mattered: it's what put a real, ship-blocking bug in
   scope-for-this-step instead of "someone else's problem later" - see
   below. `createInjector` rejects injection outright while
   `context.awaitingInput` or `context.disposition` is set, mirroring
   `assertAgentMayAct`'s own guard one scope tighter, so a signal can
   never wake the model onto its own blocking elicitation - the GAB-15
   failure shape, closed structurally rather than patched. `runAgent`
   takes an optional `onQueryReady({inject, interrupt})` callback
   (default no-op) so `server.mjs` doesn't need to change yet;
   `interrupt` is the raw `Query.interrupt()`, unused until a caller
   needs it. 6 new unit tests drive `createInputQueue`/`createInjector`
   directly (28/28 `test:capsule`, 168/168 `bun run check` - both suites
   pass but neither exercises a real `query()` call, capsule or
   otherwise, so they could not have caught the bug below).

   **A real bug this step's own tests couldn't see, caught by asking an
   advisor to review before Phase 2.** The `for await` loop over
   `messages` had no `break` on `result` - it relied on the SDK's own
   iterable ending once a turn concluded, true in print mode (the input
   is exhausted, the process ends, the stream closes) but not in
   streaming-input mode: the input queue is still nominally open
   (`createInputQueue` only closes in `finally`, which only runs once the
   loop already exited - a real chicken-and-egg deadlock, not just a slow
   path), so the SDK keeps the session alive waiting for more input that
   might still come. Verified live with a standalone script mirroring
   `runAgent`'s exact loop shape: a real `result` message arrived at
   +6.6s, and the loop then hung with nothing further, still running
   past a 45s timeout. Every production run would have ended in a
   `piTimeoutMs` timeout instead of a normal disposition - a regression
   that would only have surfaced once this shipped live. Fix: `break`
   immediately after capturing `result` (now in `agent-request.mjs`).
   This isn't just a patch - it's the correct model for a turn-scoped
   query (Approach B): injection only ever needs to reach a turn that's
   still in flight, never one that already produced its result. Also
   verified separately: `resume` still works correctly across two
   streaming-input turns (a second turn correctly recalled a fact only
   established in the first, resumed by `session_id`) - the other
   untested assumption this step depended on. Both checks are in
   RESEARCH.md.
2. **Done, 2026-08-24.** `claude-capsule/server.mjs`: the existing ndjson
   response is unchanged; a module-level `liveRequests` Map now keys the
   `{inject, interrupt}` handle `onQueryReady` hands back off the
   request's own `requestId` - client-supplied when present (validated,
   bounded to 128 chars) so the broker can address a run it just
   started, minted here as a fallback otherwise. New route `POST
   /v1/agent/:requestId/input` (control-token authenticated, same as
   `/v1/agent`) looks it up and calls `inject`; a stale or unknown id
   just isn't found (`{accepted:false, reason:"not_found"}`) rather than
   pushing into nothing, since the map entry is removed in the same
   `finally` that already exists for cleanup.
3. **Done, 2026-08-24.** `src/claude.ts` / `src/workbench.ts` /
   `src/runner-server.ts`: `ClaudeHarness.followUp()` stops being a stub.
   It declines outright (`false`) when the follow-up carries new input
   files - materializing them into a workspace an in-flight turn is
   still using concurrently is a separate, harder problem this doesn't
   attempt, and the existing cold-queue path already handles inputs
   safely between turns. Otherwise it calls the capsule's
   `followUpBrokered(prompt)` (via a new broker-side route,
   `POST /v1/agent/input`, resolved from the task's own bearer token via
   the same `taskForToken` lookup `runClaude` already uses - the task
   container never sees the real capsule's requestId, only the runner
   does) and returns whether it was `accepted`. `WorkbenchHarness` tracks
   the in-flight `capsuleRequestId` on the session's `ActiveTask`,
   set when `runClaude` starts a capsule call and cleared in its
   `finally`; a new `pushAgentInput` method resolves a task's own live
   requestId and forwards to `CapsuleClient.pushInput`. Injection
   defaults to `shouldQuery: false` throughout (queue, don't interrupt -
   see Phase 0's corrected framing above). `piTimeoutMs` is now an idle
   timeout, not a hard wall-clock one: the deadline resets on every
   reported progress event (`ClaudeHarness.run`'s `armIdleTimeout`), and
   `runtimeBudgetInstruction`'s wording was corrected to stop telling the
   model something no longer true. Regression-tested directly: a run
   whose total duration exceeds `piTimeoutMs` but keeps reporting
   progress inside the idle window still completes rather than timing
   out.
4. **No change needed**, confirmed by reading the code: `src/controller.
   ts`'s `handle()` (not `start()` - the ROADMAP text above had this
   slightly wrong) already tries `runner.followUp()` first and only
   falls back to `state.pending` when it returns `false`. The GAB-15
   guard (`execute()`'s tail) is untouched and still correctly handles
   the fallback case.
5. **Done, 2026-08-24.** System prompt (mirrored verbatim in both
   `claude-capsule/agent-request.mjs`'s systemPrompt array and
   `src/prompts.ts`'s `claudeInitialPrompt`, matching how the rest of
   the decision-model text is already duplicated across both): a live
   message now appears as an ordinary new message once the current tool
   call finishes, not flagged as urgent, and is routed through the same
   escalate-vs-decide checklist rather than assumed to mean stop
   everything.

All five phases landed in one pass rather than five separate check-ins,
per an explicit "do all steps and push em so i can run another test" -
each phase's tests (173/173 `bun run check`, up from 168; 29/29
`test:capsule`, up from 28) were still run and verified individually
before moving to the next. An advisor review (the same one that caught
Phase 1's hang) ran again before this landed and found three more
things, all addressed:

- **Token identity across the broker boundary - checked, not a bug.**
  The advisor asked whether the task container's `PI_RUNNER_TOKEN` (used
  as `ClaudeHarness`'s bearer token when it calls the broker's new
  `/v1/agent/input`) actually matches the `ActiveTask.token`
  `taskForToken` compares against - if they diverged, every live push
  would silently degrade to `{accepted:false, reason:"not_running"}`,
  indistinguishable from "no run in flight." Traced it in
  `workbench.ts`: one `token` local (line ~279) is passed to both
  `taskContainerSpec` (becomes `PI_RUNNER_TOKEN`) and the `ActiveTask`
  literal (`token,`) - the literal same value, not two secrets that
  happen to agree. Confirmed safe.
- **Missing observability - fixed.** Neither `pushAgentInput` nor
  `followUp` logged anything, so on the live test "my reply didn't
  reach the agent" would have given zero signal about which of five
  hops dropped it. Both now log accept/reject with a reason.
- **"Accepted" can still mean "never delivered" - partially mitigated,
  not fully closed, and said so rather than left silent.**
  `createInjector` returns `{accepted:true}` the moment a message is
  queued, but if the model reaches a blocking `request_attention`
  before that message is actually incorporated into a turn,
  `inputQueue.close()` discards it - and unlike the old always-`false`
  `followUp`, which meant the controller always fell back to
  `state.pending`, an `accepted:true` response today does *not* set
  `state.pending`, so the content can be silently lost with Linear
  showing it as received. This is exactly the GAB-15 failure shape this
  whole slice exists to close, one layer further in. Added
  `createInputQueue.pendingCount()` and a `console.warn` in `runAgent`'s
  `finally` when it's nonzero - this reliably catches the narrow case
  where our own generator was never even pulled from before the turn
  ended. It does **not** catch the likely-more-common case where the
  SDK already pulled the message into its own internal buffering without
  ever presenting it to the model in a completed turn - that isn't
  observable at this API surface with anything currently known about
  the SDK. Closing this fully needs a real delivery-acknowledgment
  protocol threaded from `agent-request.mjs`'s result back through
  `CapsuleAgentResult` / `PiResult` to the controller, correlated with
  the specific follow-up payload, so it can be reissued through the
  existing cold-queue path on non-confirmation - not attempted here;
  logged as a genuine gap, not deferred as a vague TODO.

Nothing here has been exercised against a real deployed capsule/runner/
controller yet - that's the live test this unblocks.

**Deferred, explicitly:** a signal arriving while a blocking Steering/QA
is already open (the human is actively sitting on it) still goes through
today's queue-and-cold-resume path under this plan - making *that* live
too is Approach A's territory, not B's, and stays out of scope unless A
gets revisited later. Phase 0 settled `priority`'s and `shouldQuery`'s
practical semantics (interrupt-and-cancel vs. queue-and-batch, see
above) - injection in step 1 should default to `shouldQuery: false`
unless a signal is itself an explicit interrupt request (e.g. a human
reply to an already-open Steering/QA, which today's design routes
through the cold-resume path anyway, not this one). Still unverified:
whether `interrupt()`'s `still_queued` receipt needs explicit handling -
not exercised by this spike, since nothing called `interrupt()`.

## Slice 20 — durable narration without a paid tool call

Status: done, 2026-08-25.

Origin: the first live GAB-16 test run (the one Slice 19 was built to
support) showed the exact symptom reported earlier this session and
never actually fixed - "I see permanent tool calls, but the messages
history in the agent session is still completely blank." Root-caused
against the real session transcript (fetched from the capsule
container's own `~/.claude/projects/-workspace/<id>.jsonl` while the
container was still up, not guessed at): across a 50-minute, 253-tool-
call run, the model produced 63 separate plain-text narration blocks
between tool calls - "Now let's set up the plan...", "All 13 tests
pass, including the axe accessibility check...", "Committed locally on
`agent/gab-16`. Now let's publish the screenshots..." - genuinely
substantive, exactly the "what is it doing" content Gaby wants to see.
It called `linear_activity` (the durable journal tool) exactly once in
that entire run, plus one Signal and one QA at the very end.

**The streaming mechanism already exists - it's just marked
ephemeral.** `createProgressProjector` (`agent-request.mjs`) already
turns every `text_delta` stream event into a `{type:"thought", body}`
progress event, debounced (160 chars or 750ms). `ClaudeHarness.run()`
reports it with `ephemeral: !completedAction` - since a thought is
never a completed action, every one of those 63 narration blocks *was*
sent to Linear, as an `ephemeral: true` activity. `controller.ts`
posts ephemeral activities best-effort, no retry, and by design they
are transient status, superseded and gone rather than retained - a
"still typing" indicator, not a scrollback entry. That is exactly why
someone watching live would catch flickers of real narration while
someone checking in later sees nothing between the tool-call log and
the final QA: the content was never missing, it was never meant to
persist.

Gaby's own framing cuts to the actual fix: "perhaps we should rely on
a tool call, which the model will intrinsically consider expensive -
maybe we can just stream the messages from the agent as it is
naturally working?" The transcript confirms the "expensive tool call"
half of that directly - `linear_activity` competes with the model's
own judgment about whether narrating is worth a deliberate action, and
across a real run it decided no, 62 times out of 63. The plain-text
stream costs the model nothing extra (it's already producing this
content as normal reasoning) and is already flowing through the
system today; it just dead-ends at "ephemeral."

**Decided: B, not A - "flooding" was the wrong frame.** Two shapes were
on the table: (A) a harness-driven periodic digest promoting rollups of
recent thought content, keeping the live stream ephemeral; (B) simply
stop marking the thought stream ephemeral. The initial worry about B -
63 posts over 50 minutes reading as flooding - assumed a durable
"thought" activity would clutter the issue's own comment thread, the
same surface Signal/Steering/QA comments live on. Gaby's correction:
that's not the right mental model. Verified directly against
`src/linear.ts`: `createActivity` calls `agentActivityCreate`, targeting
`agentSessionId` - a completely different mutation and target than
`createIssueComment`'s `commentCreate`, which targets `issueId`. A
durable "thought" activity only ever persists in the Agent Session's
own activity timeline; it can never become an issue comment. That
timeline *is* the "what has the agent been doing" log, distinct from
the human-facing comment thread, and is exactly where dense narration
belongs - not somewhere it needs to be rationed. Option B shipped:
`ClaudeHarness.run()` (`src/claude.ts`) now reports thought progress
with `ephemeral: false` unconditionally; only an in-flight (no-result-
yet) action stays ephemeral, discarded once superseded by its own
completed version, unchanged from before.

One real trade-off named and deliberately not pre-solved: durable
activity delivery is retried inline and awaited, serialized per
session (up to `DURABLE_ACTIVITY_MAX_ATTEMPTS`, ~46s worst case per
failed post) to keep the permanent record chronological, unlike
ephemeral's fire-and-forget-no-retry. At the observed volume (63
posts/run) that's not extreme, but a sustained Linear outage mid-run
could now queue up meaningfully more retry-blocked durable posts than
before, and they share the same per-session FIFO as Signal/QA/Steering
posts. Not mitigated now - watching for it to actually happen (same
discipline as the Slice 19 delivery-ack gap) before adding a
retry-skipping "durable but best-effort" tier specifically for thought
content.

**Separately, done in the same pass:** ~13 minutes of that run
(22:19-22:32) went into fighting to wire the repository's own
`vitest.visual.config.ts`/`playwright-core` visual-regression test
infrastructure into the isolated `manage_service` browser - version
mismatches, swapping `node_modules/playwright-core` aside and back,
before abandoning it for the simple, already-documented path
(`manage_service`'s browser, direct navigation and screenshot).
`src/prompts.ts`'s browser-testing instruction now says
`manage_service`'s browser is a standalone mechanism independent of
whatever visual-testing setup a repository happens to already have.

## Slice 21 — push and go green before QA

Status: done, 2026-08-26.

Origin: Gaby asked, from the same GAB-16 run Slice 20 investigated,
whether the agent knows its workspace is ephemeral and is expected to
push its branch and get CI green before requesting QA - flagged as
generic engineering hygiene, not Carbonfact-specific. Confirmed against
the transcript rather than assumed: 253 `mcp__straylight__bash` calls,
zero `git push`, zero `gh pr create`/`gh pr edit`. The QA request itself
made the failure mode explicit -
`"Review the diff on local branch agent/gab-16 (not pushed - no explicit
go-ahead to push/open a PR yet)."` The agent was following
`src/prompts.ts`'s and `agent-request.mjs`'s existing rule ("do not
push... unless the Linear request explicitly authorizes it") correctly;
the rule itself pointed at a dead end, since the container that branch
lives on is destroyed once the turn ends.

Fixed as a carve-out to the existing sentence, not a competing new one -
appending a "push before QA" instruction on top of an unqualified
"do not push" would have left two standing rules disagreeing at
runtime. Both files now read: pushing the task's own feature branch and
opening/updating its pull request is expected by default, no
authorization needed; push-to-shared/default-branch, merge, deploy, and
third-party messaging still require the Linear request to explicitly
authorize them. Added a standing "this container is destroyed once the
turn ends" statement to both system prompts (previously this fact only
appeared on the resumed-mention path, scoped to explaining why prior-
turn file/branch state doesn't exist - now it is a general reason to
push before ending a turn on a code change, not just a resume-specific
aside). `request_attention`'s QA description now also says not to
request QA while the pushed PR's checks are still red or pending.

Also corrected in the same pass: Slice 6's status line claimed a
cost-aware model picker was "implemented locally" - false since Slice 17
deleted `src/model-policy.ts` and the rest of the Pi allowlist/picker
machinery. Model selection today is a hardcoded `"sonnet"` literal.
Marked Slice 6 superseded rather than rewritten, so a future read of
this roadmap doesn't repeat the same stale claim.

## Slice 22 — a cheap per-task cost receipt

Status: done, 2026-08-26.

Origin: after Slice 21 landed, Gaby asked about token/cost logging and
benchmarking, and explicitly scoped it down when the conversation
started drifting toward Sentry/PostHog integration and org-wide
advocacy: "is there a cheap trick in the middle where we just store
cost per task and usage metrics in the code / on the containers,
perhaps if Linear offers some place where we can publish it as well?"
Deliberately not a telemetry platform - one JSONL row per completed
turn, plus one Linear activity mirroring it. No aggregator, no query
CLI, no cost-budget enforcement.

Two sinks, both best-effort and independent of each other:

- A durable JSONL row appended to `usage.jsonl` in `WorkbenchHarness`'s
  own volume-mounted data directory (`PI_WORKBENCH_DATA_DIR`, already
  bind-mounted host-side for `tasks/<key>` data) - not the per-task
  container's `/workspace`, which is this long-lived process's own
  disk and survives container churn.
- A one-line "Turn cost: ..." Linear activity (`type: "thought"`,
  Slice 20's background-record channel) - but only when the turn ended
  *without* leaving a blocking Steering/QA attention open. Linear
  renders session status from whichever Agent Session activity landed
  last, not whichever was requested last (confirmed live, see
  RESEARCH.md 2026-08-24); posting anything after an open elicitation
  risks burying its buttons, so the receipt is skipped - JSONL-only -
  whenever the result's `awaitingInput` is true. Fire-and-forget, not
  awaited: a slow or wedged controller must never hold up the turn's
  own result.

Plumbing: `agent-request.mjs`'s `runAgent` already read
`result.usage.*`/`result.total_cost_usd` for its own console logging -
it just never returned them. Added a `usage` field to the "ok" variant
of `CapsuleAgentResult` (`src/capsule-client.ts`) and populated it on
return. `WorkbenchHarness.runClaude` (the one process in the chain
that's both long-lived and already knows the completed result's
`sessionId`/`awaitingInput`) writes the JSONL row and, when safe, posts
the receipt right after `runAgent` resolves - no changes needed to
`PiResult`/`ClaudeHarness`/the controller. The receipt posts through a
raw internal request to the controller's existing
`/internal/linear-session` route rather than through
`WorkbenchHarness.collaborateLinear` - that method re-validates the
task is still active/unaborted under the task's own bearer token, a
check meant for an untrusted in-container caller, not for an internal
post firing after the task's own bookkeeping may have already moved on.

Two things named but not yet resolved, both flagged for the first live
run to settle empirically rather than guessed at now:

- Whether `result.usage` (the SDK's own per-turn accounting) reports
  the same thing as this harness's own `observedUsage` accumulator
  across a multi-turn streaming-input session (Slice 19) - both are
  logged side by side for comparison; drop whichever is redundant
  once observed.
- `total_cost_usd` is renamed `sdkReportedCostUsd` and the receipt
  text says "subscription-notional, not billed spend" - under
  subscription auth this is very likely an API-equivalent notional
  price, not money actually spent, and mislabeling it would put
  Gaby's requested benchmarking on a number that doesn't mean what it
  says.

Not done, and correctly stale as of Slice 17: no `reasoningTier` or
per-model routing dimension - `src/model-policy.ts` doesn't exist
(see Slice 6's superseded note above), so `model` is always the
literal `"sonnet"` for now. Reviving cost-aware model selection would
make this receipt immediately more useful, but is a separate,
larger piece of work.

## Slice 23 — centralized PR/CI/review watcher

Status: done, 2026-08-26.

Origin: Slice 21 made agents responsible for pushing their own branch
and not requesting QA on red/pending CI, but the "wait for green"
half is pure prompt instruction with zero harness enforcement - the
agent has to manually poll `gh pr checks` and might just not bother.
Gaby: "this feels like a mechanical bit we should have the harness
support to pull some weight off of the agents' shoulders. maybe we
should do a centralized PR-in-progress record with a single watcher
and something to dispatch incoming reviews or CI status down to
implementing agents." Scoped explicitly to CI checks *and* human PR
reviews (not checks-only), dispatched via live-inject with cold-resume
fallback - reusing Slice 19's mechanism rather than inventing a second
one.

**Revised same day: no webhook, of any shape.** The first version of
this plan (a GitHub webhook receiver) required a manual prerequisite
outside this repo before any of the code could even be tested - first
written as "register a GitHub App," corrected mid-session to "a
lighter repo-level webhook plus a scope refresh" once `gh auth status`
was actually checked live, but even that lighter version is still
webhook setup. Gaby: "I think polling is acceptable IF we centralize
it and control it somehow at the cloud host (here: straylight) level
or in a separate container/service instead of letting each and every
agent stay alive and do their own polling. Otherwise, maybe Linear
actually offers some kind of PR monitoring hooks for us? but i doubt
it." Checked rather than assumed: Linear's own webhook docs
(`linear.app/developers/webhooks`, `agent-interaction`,
`agent-best-practices`) show `AgentSessionEvent` fires only on session
lifecycle (mention/delegation/prompted) and `AppUserNotification` only
on issue-level events (mention, reaction, status change, etc.) -
nothing GitHub-shaped in either. Linear's GitHub integration
(`linear.app/integrations/github`) does sync live PR/CI status, but
only into Linear's own UI for a human looking at the issue's
attachment - it doesn't push anything to a third party. Doubt
confirmed: nothing native exists.

**Chosen approach: the controller polls, but it doesn't reinvent
polling.** Gaby's own follow-up named the actual fix: "if the github
CLI has some dedicated watch mode, we should use that instead of
polling the github API ourselves directly. Lets them do any kind of
optimizations they want without us getting in the way and hammering
traffic needlessly." Checked live (`gh pr checks --help`, `gh run
watch --help`): `gh pr checks <number|url> --watch --fail-fast --json
bucket,name,link,workflow,state` is a real, purpose-built primitive -
blocks until every check resolves (or exits early on the first
failure with `--fail-fast`), with GitHub's own client owning the
refresh cadence (`--interval`, default 10s) and whatever backoff it
chooses to apply. Spawning this as a child process is a "run it and
read the exit code + JSON," not a poll loop we author and maintain.
No equivalent exists for PR reviews - `gh pr view --help` has no
watch flag, and neither does anything else in the CLI - so that half
still needs an actual interval poll against
`gh api repos/{owner}/{repo}/pulls/{number}/reviews`, diffed against
last-seen state.

**Centralization, stated explicitly since it was the load-bearing part
of Gaby's ask:** every watcher lives in one long-lived process, never
in a per-task container - those are ephemeral and gone the moment
their own turn ends, exactly why Gaby's worry ("each and every agent
stay alive and do their own polling") was correct to raise. It just
isn't the controller doing the watching, which the plan initially
assumed without checking - see below.

**A wrong assumption caught before it shaped the build: the controller
doesn't have `gh`.** `docker exec linear-agent-controller which gh`
came back empty; `docker exec linear-agent-runner which gh` returned
`/usr/bin/gh` with `GH_CONFIG_DIR=/tool-profile/gh` already set at the
compose level (`docker-compose.yml:302`, same credential the ephemeral
task containers use). Only the runner (`WorkbenchHarness`,
`linear-agent-runner`) can actually run `gh` - the controller only
talks to it over HTTP. Split accordingly: the **controller** owns the
PR registry, session/attention state, and all dispatch decisions (it
already has the Linear API token and every other piece of session
lifecycle); the **runner** just executes `gh` commands on request and
reports back, the same shape as its existing `followUp`/`abort`/
`repositories` RPCs. This is a smaller change to the plan than it
sounds - it re-centralizes on a *different* already-long-lived process
than assumed, not a new one, and needs zero Dockerfile/compose changes
since the runner already has everything it needs.

Net effect versus the original webhook plan still held: **zero new
credentials, zero scope changes, zero public-ingress changes.** The
existing `gh` login's `repo` scope already covers reading checks and
reviews.

What actually shipped:

- **The registry.** `ControllerSessionRecord`/`SessionState` gained a
  `pullRequest: {url, owner, repo, number, lastKnownReviewAt}` field
  (`src/controller-state.ts`, `src/controller.ts`), captured at both
  existing PR-URL sites - the rich `linkGitHubPullRequestAttachment`
  publish path (gated on `richness === "github_pr"`) and the
  `githubPullRequestUrl` scrape of the final run summary in `finish()`.
  Persisted the same way every other live session field is; `save()`'s
  liveness filter (which previously dropped a session with nothing
  else keeping it alive) gained `Boolean(record.pullRequest)` so a
  dormant session whose only remaining state is "waiting on CI" isn't
  silently garbage-collected on the next restart.
- **CI checks: a runner-held `gh pr checks --watch` child, exactly
  Gaby's own suggestion.** `WorkbenchHarness.watchPullRequestChecks`
  spawns `gh pr checks <url> --watch --fail-fast --json
  bucket,name,link,workflow,state` via the existing `captureCommand`
  utility (`src/runtime.ts`, already used for `git` in the same file -
  no new subprocess plumbing), tracked per-session so a second watch
  for the same session aborts and replaces the first rather than
  racing it. GitHub's own client owns the refresh cadence for the
  whole wait; this codebase never picks one for checks. Once the child
  exits, the runner posts the result to a new controller-side internal
  route, `POST /internal/pull-request-checks`
  (`src/server.ts`/`AgentController.reportPullRequestChecks`) -
  same bearer-token pattern as every other `/internal/*` route,
  network-isolated rather than publicly reachable.
- **Reviews: the one place this codebase picks its own cadence, since
  no CLI primitive exists for it.** A single global interval on the
  controller (`ensurePullRequestReviewPolling`/`pollPullRequestReviews`,
  lazily started on the first registered PR so a controller that never
  sees one - most of the test suite - never runs a live interval at
  all) walks every tracked PR each tick and asks the runner's
  `checkPullRequestReviews` (a plain `gh api .../reviews` call) for the
  current list. Chosen over a per-PR timer (Slice 24's auto-resume
  precedent for the latter) specifically to match Gaby's own framing -
  "a centralized record with a single watcher" - and keep total load
  auditable in one place.
- **Dispatch reuses `handle()` directly, not a hand-rolled live-vs-cold
  branch.** Both `reportPullRequestChecks` and `pollPullRequestReviews`
  synthesize a `prompted`-shaped webhook and call `this.handle(...)` -
  the exact pattern Slice 24's `runScheduledResume` already
  established. `handle()` itself already knows whether to live-inject
  (`followUp`, if the session is mid-turn) or cold-resume
  (`start()`, if dormant); there was never a separate branch to author
  here, and an earlier draft of this plan that assumed a
  `pushAgentInput` call from the controller was wrong - the controller
  has no such method, and never needed one.

Three real bugs an advisor review caught before this shipped, none of
which the first pass of tests exposed:

1. **Would have clobbered an open QA/Steering attention.** `handle()`'s
   `prompted`-with-open-`attention` branch treats *any* prompted
   payload as if it were the human's own reply - clearing the wait,
   restoring issue state, resuming the run. A CI report or review
   landing while QA is open (the *normal* case under Slice 21's
   push-then-request-QA order, not an edge case) would have done
   exactly that with no human involved. Fixed by checking
   `state.attention.length` before dispatching in both
   `reportPullRequestChecks` and `pollPullRequestReviews` - and, for
   reviews specifically, before marking anything "seen," so a review
   arriving mid-wait is retried on a later poll once attention clears
   rather than lost. `dispatchExternalUpdate` carries the same guard
   again as defense in depth.
2. **A PR was only ever watched once.** `registerPullRequestWatch`'s
   original dedupe (`if (state.pullRequest?.url === url) return`)
   treated a same-URL re-registration as a no-op - but the runner's
   watch is one-shot and already exited by the time a fix gets pushed,
   so "red CI → push a fix → new CI run" left that new run silently
   unwatched. The runner's own `watchPullRequestChecks` already
   replaces (aborts + restarts) any existing watch for a session, so
   the fix was to remove the controller-side dedupe entirely and
   always re-arm - the existing capture call sites, which already fire
   on every turn that touches the PR, become the re-arm points for
   free.
3. **The first review poll would have dumped a PR's entire pre-existing
   review history as "new."** `lastKnownReviewAt` started as
   `undefined`, and the filter (`!lastKnownReviewAt || submittedAt >
   lastKnownReviewAt`) treats "no baseline" as "everything is fresh."
   Fixed by seeding it from wall-clock at registration time instead of
   leaving it unset - a review submitted before the agent even pushed
   is never treated as new. (Not paginated - `gh api .../reviews`
   returns only GitHub's default first page; unlikely to matter at
   this pilot's realistic review volume, revisit with `gh api
   --paginate` if it ever does.)

Open questions still not pre-decided:

- **Check-name filtering.** Still dispatching on any status change and
  trusting the agent's own judgment (Slice 21's "wait for green, name
  a known-flaky failure otherwise") rather than hardcoding which
  checks matter.
- **Debouncing a multi-job rollup.** `--fail-fast` mitigates this some
  (the watch exits on the first failure rather than waiting out every
  job), but a large all-green suite still reports as one summarized
  post per PR, not per job - not revisited further since the volume
  question this was meant to address hasn't been observed live yet.
- **Review content.** Bounded via `progressText` (the same untrusted-
  external-text treatment used elsewhere), not forwarded verbatim.

## Slice 24 — honest failure and auto-resume on a mid-turn usage limit

Status: done, 2026-08-26.

Origin: a live GAB-16 run hit "Claude subscription limit reached...
You've hit your individual spend limit" mid-turn and surfaced as
`"Error from straylight: Claude ended without a structured work
disposition. Run failed in 10m 24s."` - an opaque failure with no
path back to the work. Gaby: "interesting things happened in the last
test run as claude ran out of usage mid-turn. I think we should
handle that smoothly and nicely." Scoped via `AskUserQuestion` to
"honest failure + auto-resume" plus a prompt nudge, both accepted;
explicitly deprioritized behind finishing the Slice 23 write-up first
(already done by the time the question was asked, so this went ahead
immediately after).

The SDK's `rate_limit_event` (`sdk.d.ts:4406-4438`) distinguishes two
genuinely different failure modes, and the fix treats them
differently rather than uniformly:

- **A timed window** (`five_hour`/`seven_day`/... with a `resetsAt`) -
  nothing a human needs to act on, just time. Synthesized as a
  `blocked_external` disposition (the existing "non-human dependency
  with a concrete retry condition" type, reused rather than extended)
  carrying a machine-parseable `nextAction: "auto-resume-at:<ISO>"`
  marker - no network call, no Steering ask.
- **`errorCode: "credits_required"`** - a human must actually do
  something (add credits/change plan). This one does post a real
  blocking Steering elicitation, same as any other human-owned
  blocker.

`synthesizeRateLimitDisposition` (`claude-capsule/agent-request.mjs`)
makes this call from a `lastRejectedRateLimit` flag captured while
streaming SDK messages - **sticky once set, never cleared by a later
event**. The SDK streams these continuously as usage climbs (90%,
91%, ..., "reached"), so an initial version that just mirrored "latest
status" got overwritten back to non-rejected by a trailing
`allowed_warning` arriving after the real rejection, silently
reproducing the exact opaque failure this was meant to fix - caught by
review before it shipped, not by the test suite (which only exercised
the isolated function, one event at a time).

Auto-resume: `scheduleAutoResumeIfMarked`/`runScheduledResume`
(`src/controller.ts`), hooked into `finish()` right where the existing
`blocked_external` disposition already lands. An `unref()`'d
`setTimeout` (clamped to `MAX_AUTO_RESUME_DELAY_MS`, a day past the
longest real window) fires a synthesized `prompted`-shaped webhook
payload through the existing `handle()` path - `followUp`'s only
other caller. Deliberately not persisted across controller restarts;
a rarely-restarted single-host pilot loses a scheduled resume on
restart the same way any other `blocked_external` session already
sits dormant until a human notices - documented as an accepted
tradeoff, not a hidden gap. Before firing, re-checks the session isn't
already running/attention-open, then re-verifies against Linear's own
live status via `agentSessionSnapshot` - a human may have closed the
issue, or a fresh mention may have already restarted it. That check
**fails closed**: if the snapshot call itself errors, the resume is
skipped rather than proceeding blind, since a wrong auto-resume starts
a container and burns usage while a missed one only costs a manual
mention.

Prompt nudge (both `agent-request.mjs` and `src/prompts.ts`): tells
the model that once a usage-limit warning's utilization keeps climbing
toward 100%, wrapping up and requesting attention now beats a hard cutoff
mid-tool-call - explicitly framed as the graceful path, with the fact
that the harness handles a hard cutoff too so momentum isn't the only
reason to stop early.

Credits-required's Steering post goes through the same
`request_attention`-style relay the model's own tool call uses
(`proxy(...)` to the controller's internal route, awaited before
`runAgent` returns) - not verified against a live credits-exhausted
run, since that requires actually exhausting billing credits to
trigger. Reasoned from the fact that this is structurally the same
call `request_attention` already makes today, proven live - not a new
path. Worth a deliberate check the first time this branch actually
fires in production, rather than continuing to assume the analogy
holds.

## Slice 25 — the model's own words are a message, not a note

Status: done, 2026-08-26.

Origin: Gaby, reacting to the "durable narration" explanation above -
"My educated guess would be that I see no reason for these to be
'thought-type' messages. We want real fucking messages." Slice 20 made
narration durable (persists after reload) but never questioned its
`content.type` - narration has posted as `type: "thought"` since this
system's earliest experiments, unquestioned since. Gaby's read: fixing
persistence didn't necessarily fix the actual complaint, which was
never really about durability.

Checked against Linear's own type reference
(`linear.app/developers/agent-interaction`) rather than guessed at:
Linear defines exactly five allowed activity content types, each with
distinct documented semantics - `thought` ("A thought or internal
note"), `action`, `elicitation`, `response` ("Indicates work has been
completed or a final result is available"), `error`. `thought`/`action`
are the only types Linear allows to be marked ephemeral at all -
`response` is durable by construction, a firmer schema-level
commitment than a type choice alone.

**A wrong citation almost shaped this decision, worth recording so it
doesn't happen again.** Mid-investigation, a search surfaced a
RESEARCH.md line reading "Comments notify by default and carry real UI
weight; an Agent Activity does not" and it was initially treated as
still-current fact - implying a `thought`→`response` swap might stay
inside a uniformly low-weight surface and not visibly fix anything.
Checking the line's actual origin caught the mistake before it shaped
the fix: it's from `RESEARCH.md`'s "Current experiment" section,
predating Slice 13 entirely - written when Steering/QA still worked by
spawning a child issue with two labels, a mechanism Slice 13 replaced
outright. In today's architecture, blocking Steering/QA already ships
as `type: "elicitation"` Agent Activities, direct on the session, and
demonstrably do reach a human (live-tested this session, repeatedly) -
so "an Agent Activity does not carry real UI weight" is false for the
current system on its face; the quote describes an abandoned
mechanism, not the current one. Retracted rather than left standing
uncorrected once identified.

**Change shipped:** in `createProgressProjector`
(`claude-capsule/agent-request.mjs`), the two paths carrying the
model's own composed text - the debounced `text_delta` stream and the
final-turn `assistant`-message flush - now post `type: "response"`
instead of `type: "thought"`. Left as `thought`, deliberately:
genuine `thinking_delta` content (prefixed `"Thinking: "` - actual
chain-of-thought, which fits Linear's own "internal note" framing
much more literally than composed narration ever did) and every
harness/system-generated status ping (session start, compaction,
retry, rate-limit warnings) - these are the harness talking about the
run, not the model talking to the human, so the `thought`/`response`
line is drawn at "who is speaking," not at "is this interesting."
Two new tests cover both changed paths
(`claude-capsule/agent-request.test.mjs`); one pre-existing test's
inline expectation for the streamed-text case was updated in place.

Not verified live yet - whether `response` actually reads differently
from `thought` in Linear's rendered UI (as opposed to just being a
different value in the schema) is still unconfirmed, same caveat as
the durability question Slice 20 shipped without live confirmation.
Worth a look on the next real test run.

## Slice 26 — resolve tracked comment threads once their decision lands (GAB-22)

Status: done, 2026-08-26.

Origin: Gaby, GAB-22 - "It would be cool if the agent was able to
automatically properly 'resolve' threads in Linear when decisions have
been made and they are not relevant anymore," illustrated with a
screenshot of the native comment "..." menu's "Resolve thread" action
being used right after a Steering reply landed.

Claude already had `manage_linear`'s generic `comment`/`resolve` and
`/unresolve` operations (`LinearClient.manage`'s `commentResolve`
mutation), so the primitive existed - but nothing made using it
*automatic* for the threads the controller itself opens and already
knows the full lifecycle of: the real, tracked issue comment posted
alongside a blocking Steering/QA elicitation (`ActiveAttention.commentId`,
Slice 13/19-era work), and a non-blocking "ask" (`OpenAsk.commentId`,
Slice 18). Leaving that to Claude's own judgment mid-turn is exactly the
kind of thing worth making deterministic instead: the controller
unambiguously knows the moment a reply lands on one of these and gets
processed - that's the paper-trail equivalent of a human clicking
"Resolve thread" themselves.

**Change shipped:** a new `LinearClient.resolveComment(commentId)` calls
`commentResolve` directly (`src/linear.ts`), and `src/controller.ts` calls
it, best-effort (`.catch(() => undefined)`, matching the existing
`reactToComment` convention - never lets a resolve failure block the
actual resume), at every point a tracked thread's question has been
answered and acted on:

- `routeTrackedCommentReply`'s ask branch, right after the reply's own
  checkmark reaction - the ask's own `commentId`.
- `handle()`'s `"prompted" && state.attention.length` branch (covers both
  a native elicitation reply and a routed tracked-comment reply, since
  the latter calls into the former) - `attention.commentId`, whether the
  reply approved QA, gave a non-approving Steering answer, or anything
  else that isn't itself another parentless follow-up.
- `approveQa`, now taking an optional `attentionCommentId` parameter -
  covers both ways a QA gets approved (replying with the exact approve
  text, and `handleQaReactionApproval`'s checkmark-reaction path), since
  both routes call through this one shared completion function.

Deliberately resolves on "answered," not "issue closed": a non-approving
Steering reply (`"Keep the old writer, but add a rollback plan."`) still
resolves that thread, since the specific question it asked was answered
and the answer's now been acted on - reopening a fresh Steering/QA later
opens a brand-new tracked comment with its own thread, so nothing is lost
by closing this one out.

Twelve tests updated/added: three in `test/ask-tier.test.ts` now assert
`resolveComment` is actually called with the right tracked comment id (the
ask-reply case, the QA-approval case, and the non-approving-Steering-reply
case); six `test/controller-recovery.test.ts` fakes and `test/ask-tier.test.ts`'s
shared `baseLinear` helper gained a `resolveComment` stub so every fake
`LinearClient` stays complete. `bun run check` (typecheck + all 201 tests)
passes.

## Slice 27 — subissue tracking hygiene and no re-litigating resolved threads (GAB-25)

Status: done, 2026-08-26.

Origin: Gaby, GAB-25 - "Investigate weird behaviour around pending decisions
and sub-issues," two symptoms observed on GAB-21's own session:

1. GAB-21 spawned a follow-up subissue, GAB-23, that ended up assigned to
   Gaby (the human) rather than left unassigned or picked up by an Agent
   Session. GAB-23 never received a single comment after creation and sat
   at "In Progress" while the work it described (reading Linear project/
   team context at boot, plus the repository-hoisting follow-up) actually
   shipped later under a *different* PR (#4, e86b33e) whose commit message
   only said "Refs GAB-23" - not a closing keyword - so the ticket never
   closed and kept claiming to track work that had already landed.
2. When reaching later QA milestones in the same conversation, the agent
   re-stated an already-resolved Steering thread's question/context in
   full, twice, instead of pointing back to it in passing.

Investigation (no repro logs were needed - the evidence was in Linear and
in this repo's own history): GAB-23's description doesn't match
`renderDeferredItem`'s template ("## Deferred follow-up:" / "**What**" /
"**Why this isn't the current task's job**" / "**What re-surfaces it**"),
so it wasn't created through `defer_followup`'s justification-gated path -
it was a direct `manage_linear` `subissue`/`create` call, which passes
through whatever `fields` (including `assigneeId`) the model supplies with
no default (`LinearClient.manageSubissue`, `src/linear.ts`). Nothing in the
prompt said a freshly created tracking subissue starts with no Agent
Session attached and nobody automatically working it, nor that assigning
it to a human is a real decision rather than a reflex. Separately, for
symptom 2: `renderOpenAsksSection`'s "Still waiting on:" list (the one
deterministic, code-owned surface for a QA request restating prior
questions) already only lists genuinely unresolved `state.openAsks` -
confirmed correct, not the source. Since the Claude Agent SDK conversation
is resumed in place (`resume` in `src/claude.ts`) rather than reconstructed
per turn, symptom 2 is Claude's own drafting choice mid-conversation with
nothing to tell it not to - there's no code-level dedup to add for content
the model itself composes.

**Change shipped:** two new bullets in `claudeInitialPrompt`
(`src/prompts.ts`), next to the existing `defer_followup` and
Steering/QA-reply guidance they extend: (1) a tracking subissue - through
`defer_followup` or a direct `manage_linear` subissue create - is inert
the moment it's created, so leave it unassigned unless a human genuinely
needs to decide something on it, and close the loop yourself if its work
lands under a different session rather than trusting a bare "Refs GAB-N"
mention to do it; (2) once a Steering/QA reply has resolved a thread,
mention it once in passing with a link on any later checkpoint or QA
request instead of restating the original question, options, or reasoning.

Two new `assert.match` assertions added to `test/behavior.test.ts`'s
existing initial-prompt test per new bullet. `bun run check` (typecheck +
all 207 tests) passes.

Follow-up, same day: Gaby asked whether this should also be mechanically
hardened rather than left to instructions alone. Recommended a narrow,
surgical guardrail instead of a blanket block - `manage_linear`'s
`assigneeId` is a normal field on plain `issue` update (reassigning an
existing issue is completely ordinary), so removing it there would cost
real capability, not just close the hole. What's cheap and structurally
checkable without cost: `LinearClient.manageSubissue`'s `create` branch
(`src/linear.ts`) now validates against a dedicated `SUBISSUE_CREATE_FIELDS`
set - `ISSUE_CREATE_FIELDS` minus `assigneeId`/`delegateId` - so creating a
subissue always starts unassigned; a human can still be assigned afterward
through a deliberate `issue`/update. `manage_linear`'s own tool description
(`claude-capsule/agent-request.mjs`) now says so up front instead of only
surfacing it as a runtime rejection. One new test in `test/linear.test.ts`
exercises the real `manage()` path against a fake GraphQL server (rejects
both `assigneeId` and `delegateId` on subissue create, still creates one
without them); one new test in `claude-capsule/agent-request.test.mjs`
checks the updated tool description. `bun run check` (208 tests) and
`node --test claude-capsule/agent-request.test.mjs` (40 tests) both pass.

## Later hardening

- Stream safe Claude Agent SDK partial text, tool progress, retry/rate-limit
  state, and aggregate usage through the existing subscription-authenticated
  capsule. Replace synthetic proof-of-life with semantic activity when available
  while keeping a transport-only heartbeat for truly silent intervals.
- Move from shared-kernel Docker isolation to gVisor, Kata, or a microVM backend
  if hostile repository code becomes an explicit threat model.
- Split `/tool-profile` into typed, short-lived capabilities if the pilot grows
  beyond one trusted engineer.
