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
- Move the runtime to Node.js 24 LTS, retain Bun, and add GitHub CLI.
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

- Create and update issue-backed native Linear Documents for substantial
  Markdown review artifacts.
- Create or refresh rich issue attachments for external reports, previews,
  deployments, and pull requests.
- Keep repository suggestions, private file/image upload, session URLs, native
  documents, and issue attachments behind the existing `linear` verbs.
- Keep these behind the existing generic `linear` verbs; do not add one tool per
  Linear mutation.

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

Status: design proposed; model list and routing thresholds need the engineer's
chosen providers and models before implementation.

- Store a small explicit allowlist in the persistent Pi configuration. Each
  entry names provider/model, cost class, context capability, and task classes;
  no task may select an unlisted model.
- Start with deterministic task signals (scope, ambiguity, security sensitivity,
  repository size, and requested work type) so routing itself has no model cost.
- Prefer the cheapest allowed model that satisfies the task class. Escalate one
  tier after a failed check, repeated tool loop, context pressure, or explicit
  uncertainty; never silently downgrade an active task.
- Surface the selected model and any escalation as a short ephemeral Linear
  activity, while keeping exact billing telemetry out of the prompt.

Open decision: choose the initial allowed model table and whether subagents may
route independently within the same ceiling or must inherit the main model.

## Slice 7 — Bun-native control layer

Status: queued immediately after Slice 5 is committed.

- Move the controller, workbench supervisor, task runner server, subprocesses,
  and tests to Bun and native Bun APIs where the required semantics are proven.
- Retain a small compatibility boundary for dependencies or Unix-socket Docker
  operations that Bun cannot yet replace safely.
- Keep protocol payloads and Linear UX unchanged so the runtime migration is a
  separately reviewable slice.

## Later hardening

- Replace the task's reusable Codex credential copy with a model broker.
- Move from shared-kernel Docker isolation to gVisor, Kata, or a microVM backend
  if hostile repository code becomes an explicit threat model.
- Split `/tool-profile` into typed, short-lived capabilities if the pilot grows
  beyond one trusted engineer.
