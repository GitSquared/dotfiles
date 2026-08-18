# Pi capability roadmap

This roadmap keeps Pi's interface small and semantic. Product-specific mechanics
belong in the trusted controller; Pi gets a few tools with verbs that remain
useful as Linear and the workbench evolve.

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

Status: implemented locally; deployed acceptance pending. This builds on native
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
- Make an explicit Document or Document-comment mention authoritative input to
  the matching Agent Session, including the current comment thread and bounded
  Document context. Treat ordinary edits, subscriptions, and unmentioned comments
  as context-only notifications so they do not synthesize new instructions.
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
- Because Linear delivers Document-comment mentions as Inbox notifications, the
  controller explicitly promotes the notification to an Agent Session on the
  root thread and preserves the mentioned child comment as the authoritative
  source. Ordinary Document comments remain context-only.
- Re-entry remains a compact behavioral contract over native lifecycle, plan,
  and one optional work-record Document. It is intentionally not a mandatory
  comment template or a second persisted state model.

Acceptance:

1. Pause a multi-step task, return later, and identify current state, required
   attention, evidence, and next action from Linear without reading the Pi
   transcript.
2. Close a task with partially completed scope and confirm every original plan
   item has an explicit disposition and customer-visible completion is honest.
3. Mention Straylight in a review comment on an existing Document; confirm Pi
   receives that comment as the current request, reads the relevant Document and
   thread, updates the same Document, and replies in the review surface.
4. Add an ordinary unmentioned Document comment or edit and confirm it remains
   context-only and does not start or redirect Pi work.
5. Submit several Document review comments and confirm Pi returns an auditable
   applied/declined/needs-decision disposition for each without creating a new
   Document.

## Slice 13 — rationalized attention requests

Status: implemented locally; deployed interaction and queue-pressure measurement
remain acceptance checks.

- Replace open-ended `request_input` with a dedicated semantic attention
  request. Every request is either Steering (new information questions the
  original intent) or QA (a checked artifact is ready for ownership), and is
  explicitly classified as an interruption or queued review.
- Materialize every request as a Linear child issue assigned to the sponsoring
  engineer. Use native priority for ordering and labels for Steering/QA plus
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
2. Request queued QA with a preview and screenshot, and confirm Linear creates a
   child issue assigned to the engineer with the requested priority, QA and FYI
   labels, and usable evidence.
3. Request blocking Steering with real options and confirm Linear creates its
   child Agent Session, renders a native select signal, and routes the reply back
   into the paused parent while still accepting free text.
4. Confirm controller health distinguishes queued QA, queued Steering, FYI,
   blocking, urgent, and true interruptions across simultaneous sessions.
5. Restart the controller while an attention request is pending; confirm it
   remains awaiting input and does not rerun tools or external actions.

## Later hardening

- Replace the Pi fallback task's reusable Codex credential copy with a model
  broker before broadening that route beyond the personal pilot.
- Move from shared-kernel Docker isolation to gVisor, Kata, or a microVM backend
  if hostile repository code becomes an explicit threat model.
- Split `/tool-profile` into typed, short-lived capabilities if the pilot grows
  beyond one trusted engineer.
