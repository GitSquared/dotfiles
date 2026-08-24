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

Status: allowlist, classifier, picker, and one-tier agent-requested escalation
are implemented locally. Deployed account/model acceptance and outcome/cost
telemetry remain.

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
1. `claude-capsule/agent-request.mjs`: `runAgent` takes an injectable
   queue - an async generator yields the initial `SDKUserMessage`, then
   awaits further pushes. Return the `Query` handle (for `interrupt`/
   `close`). Reject injection outright while `context.awaitingInput` is
   set, so a signal can never wake the model onto its own blocking
   elicitation and hit `assertAgentMayAct`'s rejection - the GAB-15
   failure shape, one scope tighter, closed structurally rather than
   patched.
2. `claude-capsule/server.mjs`: keep the existing ndjson response; key a
   live-push channel off the existing `requestId` (`POST
   /v1/agent/:requestId/input`), not the container's `taskToken`.
3. `src/claude.ts` / `src/workbench.ts` / `src/runner-server.ts`:
   `ClaudeHarness.followUp()` stops being a stub and posts to the live
   run, returning `false` only on an `awaitingInput` rejection (the
   existing cold-queue path stays as the fallback). Convert
   `piTimeoutMs`'s hard wall-clock abort to an idle timeout (no progress
   for N minutes), since more live pings otherwise mean hitting a budget
   the model was never told accounts for interruptions.
4. `src/controller.ts`: `start()` tries `runner.followUp()` first, falls
   back to `state.pending` only when that's rejected. The GAB-15 guard
   (execute()'s tail, added tonight) stays exactly as-is - it's what
   correctly handles the fallback case.
5. System prompt: an inbound live ping runs through the same
   escalate-vs-decide altitude filter Slice 18 already ships - a
   non-product-level ping resolves to a react or nothing; a mid-flight
   reply is one tool call, not a new turn.

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

## Later hardening

- Stream safe Claude Agent SDK partial text, tool progress, retry/rate-limit
  state, and aggregate usage through the existing subscription-authenticated
  capsule. Replace synthetic proof-of-life with semantic activity when available
  while keeping a transport-only heartbeat for truly silent intervals.
- Move from shared-kernel Docker isolation to gVisor, Kata, or a microVM backend
  if hostile repository code becomes an explicit threat model.
- Split `/tool-profile` into typed, short-lived capabilities if the pilot grows
  beyond one trusted engineer.
