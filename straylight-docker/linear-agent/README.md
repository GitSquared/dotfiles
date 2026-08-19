# Straylight Linear agent

This is Straylight's owned Linear-to-agent bridge. Claude Code is the default
coding runner; Pi remains an explicit fallback while this pilot earns its shape.
It contains no source or build
dependency on `hiasinho/linear-pi-agent`; that project was only a behavioral
reference for the first OAuth and Agent Session loop.

The default path uses the official Claude Agent SDK and the engineer's persistent
Claude Code subscription session. The capsule image pins Claude Code `2.1.226`
and the matching Agent SDK `0.3.226`. It rejects provider override variables in
the deployment smoke test so an accidental API, Bedrock, Vertex, or Foundry
configuration cannot silently replace subscription-backed authentication.

The fallback path uses mainline Pi from `earendil-works/pi`, published as
`@earendil-works/pi-coding-agent`. This is the successor npm scope and GitHub
location for the original `@mariozechner/pi-coding-agent` / `badlogic/pi-mono`
project, not a Straylight or third-party fork. The runtime currently pins the
latest published mainline npm release, `0.84.0`, so upstream SDK changes are
upgraded and verified deliberately.

## Stack namespace

Owned services, containers, images, and networks use the `linear-agent-*` namespace.
The persistent per-engineer profile uses the `linear-agent-claude-profile`
volume by default. Source lives under `/home/gaby/straylight-docker/linear-agent`, with
the capsule at `linear-agent/claude-capsule`. The stable public route remains
`/linear`; names do not alter Linear OAuth or webhook URLs.

## Architecture and trust boundary

There are four roles:

- `linear-agent-controller` is the trusted controller. It owns Linear OAuth and webhook
  secrets, accepts Funnel traffic, and is the only component that calls Linear.
  It has no Pi configuration, repository, Docker socket, or task workspace.
- `linear-agent-runner` is a narrow workbench supervisor. It receives
  authenticated run/follow-up/abort requests from the controller and is the only
  component with the Docker socket. It never receives Linear credentials or the
  Linear token store.
- Every Linear Agent Session is executed in a private task container. The task has
  one private persistent `/workspace`, backend-specific conversation state,
  read-only, centrally refreshed repository caches at `/repositories`, a shared single-engineer
  developer-tool profile at `/tool-profile`, and a one-time control token.
  It has no host port, Docker socket, SSH key, other task workspace, or
  `LINEAR_*` environment variable. A successful container remains warm for ten
  minutes so follow-ups reuse the agent conversation, shell caches, and
  supervised services; the session workspace and history remain after it expires.
- Every active turn also gets a private auxiliary bridge network for supervised
  PostgreSQL and Playwright sidecars. The task joins it as `task`; sidecars have
  no host ports and cannot join another session's auxiliary network.
- `linear-agent-claude-capsule` is one engineer's persistent Claude Code identity and
  inference workbench. Its common image is stateless; Claude settings, connector
  approvals, and tokens live only in the named profile volume. Claude runs in
  the capsule but receives no task filesystem. A small in-process MCP server
  gives it semantic tools that proxy shell, artifact sharing, Linear, and
  development-service operations into the current task jail. Task containers
  never mount or receive the capsule profile or its reusable control token.
  The older conversational `ask_claude` route remains available to the Pi
  fallback for bounded corporate-context retrieval.

The controller and task containers use separate Docker networks. The workbench
joins both but authenticates its controller API with
`LINEAR_AGENT_RUNNER_SECRET`; task containers receive different random tokens
that authenticate only their own short-lived runner API.

Task containers run as a non-root user with a read-only root filesystem, all
Linux capabilities dropped, privilege escalation disabled, bounded tmpfs, and
CPU, memory, and process limits. The workbench starts with one runnable turn,
then samples VM CPU and available RAM every ten seconds. While demand is queued,
it opens one additional turn whenever the rolling ten-minute p75 remains below
75% and 80% respectively. Sustained pressure or lower demand closes spare
capacity gradually. There is no configured floor or arbitrary machine-size
ceiling.
The workbench removes orphaned resources after a restart and stops a task if the
controller disconnects.

The Docker socket is intentionally confined to the small workbench supervisor,
but possession of that socket is still host-root-equivalent. Treat the
workbench as trusted infrastructure, review its container-spec builder
carefully, and never expose its port outside the private Compose networks.

## Native Linear experience

The controller uses Linear's Agent Session primitives rather than plain issue
comments:

- immediate ephemeral thoughts so a new session is acknowledged within Linear's
  responsiveness window
- replacement-style live streaming of the agent's user-facing prose through ephemeral
  thoughts, followed by one durable final response; Linear currently exposes no
  public mutation for updating an existing Agent Activity in place
- native action cards for tool calls and isolated-workspace preparation
- durable task-specific Agent Plans managed with list/add/update/remove/replace
  verbs, plus an explicit closure reconciliation that dispositions every item
  before completion; plans are reconstructed from agent history whenever a warm
  container expires
- a rigid `request_attention` state machine that creates a real child issue
  assigned to the sponsoring engineer. Signal is always a queued nonblocking
  question or notification and work continues; Steering always pauses for a
  required answer; QA always pauses checked work for human approval and is
  refused without a reviewable HTTPS evidence URL. Native labels and priority
  make those states sortable. QA exposes standard **Approve and complete** and
  **Not approved** controls: approval completes the parent issue without another
  inference turn, while changes resume the same workspace and conversation
- one generic `linear` collaboration tool for blockers, review notes, private
  file/image uploads, arbitrary session URLs, native
  review Documents (including discovery, reading, updates, inline-comment
  discovery, thread replies, resolution, and reopening across sessions), rich
  issue attachments, issue properties, relationships, subissues, and projects
- every semantic Linear action uses an acknowledged controller broker, so the agent
  reports success only after Linear accepts it; only disposable live progress
  travels over the best-effort transcript stream
- file/image shares stay bounded and pass through the trusted controller, which
  prepares and consumes Linear's short-lived upload capability; the agent receives only
  the resulting private asset URL, so it can embed a newly uploaded image in a
  native Document without receiving Linear credentials or presigned storage access
- bounded inbound issue, comment, and Agent Session files from Linear's private
  `uploads.linear.app` storage; images become native model image parts when
  supported, and every accepted file is materialized under the session's
  private `/workspace/.linear-inputs/` tree for ordinary inspection tools
- structured human `stop` signals, with generation invalidation and hard task
  container cancellation so no later action is published
- active-turn follow-ups, queued follow-ups, and conversation history across
  warm or freshly reconstructed containers
- ranked repository context from Linear's repository-suggestions API
- generic session URL attachment plus automatic pull-request discovery; GitHub
  PR URLs receive Linear's native enrichment without a PR-specific tool
- human-delegated issues move to the team's first started state when the issue is
  actually delegated to the app user
- explicit notification policies: mentions and assignments defer to their
  authoritative Agent Session event, ordinary new comments remain context-only,
  reactions are acknowledgements, and only unassignment or a confirmed terminal
  status cancels affected work
- direct Document-comment mention notifications are promoted to an Agent Session
  anchored on that comment thread, then carry the exact source comment, selected
  text, thread, and bounded current Document Markdown into the agent; unmentioned
  Document edits and comments stay context-only
- compact re-entry guidance keeps native issue lifecycle and plan state primary,
  updates one issue-backed work-record Document only when richer orientation is
  useful, and avoids checkpoint spam or a rigid final-comment template
- a durable controller registry and webhook-delivery ledger under `state/`;
  after restart, Linear's current session status and latest durable Agent
  Activity decide whether interrupted work resumes, remains awaiting input, or
  is left terminal without replaying completed actions

The Pi fallback has a dedicated `request_access` flow for login, connection,
approval, or permission failures. It creates a blocking Steering child with the
trusted workbench link and a precise repair request. Default Claude runs use the
same child-issue transition for developer-access failures; capsule authentication
failures are repaired from the interactive workbench described below.

## Host data layout

- `pi-config/` is Pi's persistent global profile. `auth.json` is the master
  Codex-subscription credential; global instructions and settings placed here
  are copied privately into every task.
- `memory/` is the shared persistent Markdown notebook. Pi can write concise
  non-secret notes directly and search them with the generic qmd-backed `memory`
  tool across otherwise isolated Agent Sessions.
- `workspace/repos/<name>` contains the local repository cache. The trusted
  workbench refreshes remote branches at most once per configured TTL; task
  jails mount it read-only and clone the canonical HTTPS remote with the cache
  as an object reference. The source should have an `origin` so Linear can rank
  it and derive the canonical repository identity.
- `workspace/runs/<session-hash>` is the persistent private workspace for one
  Linear Agent Session.
- `tool-profile/` contains the single engineer's persistent GitHub CLI and Git
  credential-helper state plus an optional web-search provider configuration. It
  is mounted read-only into coding tasks and is not mounted into the controller
  or Claude capsule.
- `data/tasks/<session-hash>` contains backend conversation state, Pi fallback
  configuration, and a
  `session.json` mapping back to the Linear session and issue.
- `state/controller-sessions.json` retains only active, queued, or
  awaiting-input controller sessions, including the child issue id, kind,
  delivery, priority, blocking state, and request time for active attention
  items; aggregate queue pressure is exposed
  in controller health without copying request content into another database.
  `state/webhook-inbox.json` durably queues
  accepted webhook payloads before acknowledgement, retries transient handling
  failures, replays pending work after restart, and retains a bounded ten-minute
  completed ledger for deduplication. Permanent failures move into a bounded
  seven-day dead-letter summary containing only safe event metadata, not comment
  bodies. Both files are atomically replaced with mode `0600`.
- `${LINEAR_AGENT_CLAUDE_PROFILE_VOLUME:-linear-agent-claude-profile}` is the Docker
  volume containing one engineer's Claude Code home. Use a different volume name
  for each engineer when the prototype is expanded.

Existing shared `data/pi-sessions/<session-id>.jsonl` histories are copied into
the new per-session layout lazily on first use. Persistent task data is not
deleted automatically yet; that avoids surprising loss while the pilot is
young.

## One-time environment update

Keep the existing Linear values in `/home/gaby/straylight-docker/.env` and add:

- `LINEAR_AGENT_RUNNER_SECRET`: a new independent random value containing at
  least 32 characters. Generate one with `openssl rand -hex 32` and paste only
  the output into `.env`.
Optional settings:

- `LINEAR_AGENT_RUNNER_BACKEND=claude` selects the default subscription-backed
  Claude Code runner. Set it to `pi` only to exercise the fallback.
- `LINEAR_AGENT_MAX_WARM_SESSIONS=3`
- `LINEAR_AGENT_WARM_SESSION_TTL_MS=600000`
- `LINEAR_AGENT_REPOSITORY_REFRESH_TTL_MS=300000`
- `PI_PROGRESS_HEARTBEAT_MS=60000` controls the replacement-style visible
  "still working" activity for quiet agent turns. A separate internal 15-second
  transport heartbeat is always active and is not rendered in Linear.
- `LINEAR_AGENT_HOST_ROOT=/home/gaby/straylight-docker/linear-agent` if the
  Compose checkout ever moves elsewhere

Do not reuse the Linear client secret, webhook secret, or installation secret as
the runner secret. Do not add `DOCKER_GID` to `.env`: bootstrap derives it from
the live `/var/run/docker.sock`, exports it only for Compose, and stops safely
when the socket is absent or inaccessible.

For later interactive Compose commands, use `/home/gaby/straylight-docker/compose`.
The wrapper derives the live socket group for every invocation, so a fresh SSH
shell cannot accidentally pass an empty `group_add` value to Docker.

## Pi fallback authentication

Only the explicit `LINEAR_AGENT_RUNNER_BACKEND=pi` fallback uses Pi's
`openai-codex` provider with a ChatGPT Plus or Pro
subscription; API keys are not used. Existing `pi-config/auth.json` continues to
work. For a first login or reauthentication:

```sh
./compose run --rm --no-deps \
  --workdir /home/node/.pi/agent \
  --entrypoint /app/node_modules/.bin/pi-ai \
  linear-agent-runner login openai-codex
```

Choose **Device code login (headless)**, open the displayed URL, and sign in with
the ChatGPT account that owns the Codex subscription. Confirm the file exists
without printing it:

```sh
test -s linear-agent/pi-config/auth.json
test "$(stat -c '%a' linear-agent/pi-config/auth.json)" = 600
```

## Pi fallback model allowlist and provider administration

`linear-agent/pi-config/model-policy.json` is the reviewed, ordered allowlist.
New sessions first show **Setting up workspace**, then a low-effort classifier
chooses the cheapest suitable entry and publishes the choice to Linear. The
initial policy uses `openai-codex/gpt-5.6-luna:low`,
`openai-codex/gpt-5.6-terra:medium`, and
`openai-codex/gpt-5.6-sol:high`, with Terra as the fallback. Pi can move only to
the next stronger allowlisted entry via `escalate_intelligence`; it cannot pick
an unlisted provider or model.

For comment-created sessions, the controller resolves `sourceCommentId` before
classification. The classifier receives only that current directive (plus the
issue identifier), not an older root comment or issue description; Pi still
receives the broader thread and issue material as supporting execution context.

To inspect the models visible to the persistent Pi profile:

```sh
cd /home/gaby/straylight-docker
./compose run --rm --no-deps --entrypoint /app/node_modules/.bin/pi \
  linear-agent-runner --list-models
```

To add or refresh a provider, open Pi interactively in the same mounted profile,
run `/login`, select the provider, and complete its normal flow:

```sh
./compose run --rm --no-deps --entrypoint /app/node_modules/.bin/pi \
  linear-agent-runner
```

List models again, then add only verified provider/model IDs to
`linear-agent/pi-config/model-policy.json`. Keep entries in escalation order and
choose a supported reasoning level. New sessions pick up the new policy;
existing warm sessions retain their selected model.

## Persistent Pi fallback instructions

Pi loads global instructions from `~/.pi/agent/AGENTS.md` and appends them to
the `AGENTS.md` files found on the path to the active repository. In this stack,
the persistent host-side source for that global profile is
`linear-agent/pi-config/`. To add notes that should apply to every future Linear
Agent Session, SSH into Straylight and edit:

```sh
cd /home/gaby/straylight-docker
${EDITOR:-vi} linear-agent/pi-config/AGENTS.md
```

Each new task receives a private copy at `~/.pi/agent/AGENTS.md`, in addition to
the curated `/workspace/AGENTS.md` shipped by this repository. Existing active
tasks keep their current copy; start a new task to pick up changes.

For instructions that specifically need system-prompt priority without
replacing Pi's defaults, use `linear-agent/pi-config/APPEND_SYSTEM.md`. Pi also
supports `SYSTEM.md`, but that replaces its default coding-agent system prompt
and should be reserved for deliberate prompt development.

## Claude Code authentication and runner

No Claude or Slack credential is present in an image, environment variable,
controller state, log, or task container. Claude and MCP credentials remain only
in the persistent per-engineer capsule profile. The named volume mounts all of
`/home/node`, so `.claude.json`, `.claude/`, connector approvals, and settings
created during an interactive SSH session survive image rebuilds and container
recreation. A separate generated 0600 token
file authorizes the workbench-to-capsule control channel and is never mounted in
a task jail.

The default runner invokes the official Claude Agent SDK inside this authenticated
capsule and resumes its Claude session id from the task's private workspace. Its
built-in shell and filesystem tools are disabled. Instead, in-process Straylight
MCP tools cross the authenticated control channel and operate inside the current
  task jail: `bash`, `view_image`, `share_artifact`, `request_attention`, `finish_work`,
  `manage_linear`, `linear_activity`, and `manage_service`. The capsule therefore holds inference
identity but not source code; the task holds source code but not inference or
Linear credentials.

Neither the default Claude runner nor the Pi fallback can declare delegated work
complete. A normal turn must continue after a Signal, pause in Steering, or pause
in QA. `finish_work` exists only for a non-human external dependency with a
concrete retry condition or an explicitly authorized deferral. Claude's Stop hook
repairs one invalid transition. Pi runs one bounded repair turn, blocks later
tools after a terminal transition, and then fails closed. Both reject terminal
prose that still contains an informal request such as "let me know" outside the
attention state machine.

The controller-to-runner NDJSON response emits blank transport heartbeats every
15 seconds and disables Bun's native fetch timeout where supported. Quiet Claude
turns also replace their ephemeral Linear activity every configured progress
interval, so a long inference neither looks dead nor loses its control stream.
The authenticated capsule and both workbench hops use the same bounded NDJSON
protocol. Claude reasoning deltas, assistant text, tool starts and elapsed time,
compaction, retries, and subscription-limit warnings become inspectable
replacement-style Linear activity. Thinking-token estimates remain a fallback
when Claude exposes no reasoning text. Tool arguments are never serialized as
progress; all streamed text is bounded and recognized credentials are redacted
before Linear. The capsule logs request boundaries,
terminal disposition, tool names, estimated token usage, and SDK-estimated cost
without logging prompts or task tokens.

## Linear workflow setup

No additional Linear workflow status or board is required for the pilot. A
delegated parent moves into the team's first Started state, remains there while
working or awaiting Steering/QA, and moves to the team's first Completed state
only when the engineer chooses **Approve and complete** on the QA child. The
controller creates the `Attention / Signal`, `Attention / Steering`,
`Attention / QA`, `Attention / FYI`, and `Attention / Blocking` labels lazily.

An optional saved view can filter incomplete child issues assigned to the
engineer with an `Attention / ...` label, then sort by native priority. Keep this
as a view over Linear's issues rather than creating another board or workflow
state until the pilot shows a concrete need.

The older headless `ask_claude` route remains available to the Pi fallback for
connected corporate context. Corporate connectors are action-capable, but local
shell, filesystem, web, and sub-agent tools remain denied on that route. Both
routes use the same fixed authenticated capsule API: a task jail uses its
one-time runner token to call the workbench, and the workbench uses the private
capsule control token.

If Claude authentication or a connector approval is missing, SSH into Straylight
and launch the real interactive workbench:

```sh
cd /home/gaby/straylight-docker
./compose run --rm --no-deps --entrypoint claude \
  linear-agent-claude-capsule --permission-mode auto --model sonnet
```

Use Claude's normal interactive UI, including `/login` and `/mcp`, to authenticate,
connect, or approve the needed service. Exit when finished, return to Linear, and
reply `resume`. The
instructions are deliberately provider-neutral: Linear never receives an OAuth
code or provider credential. The prototype has no web terminal, callback broker,
second Linear app, durable OAuth ledger, or second queue/database outside Linear.

Cancellation is propagated across the task request, workbench proxy, capsule HTTP
request, and Claude child process. A Linear stop or task disconnect therefore
terminates in-flight agent work instead of leaving it detached from its Linear
session.

## Developer-tool authentication

The controller, workbench supervisor, and task runner execute on Bun 1.3. Bun
owns their HTTP servers, streaming responses, request cancellation, dependency
lock, tests, and captured subprocesses. The runner image also retains Node.js 24
as a compatibility layer for upstream Pi executables and qmd's native SQLite
module; Docker Engine calls retain `node:http` because they use a Unix socket,
and permission-sensitive filesystem operations retain Node's POSIX APIs.
Long-running Pi and broker routes disable Bun's per-request idle timeout after
validation; explicit task deadlines and cancellation remain authoritative.

The image also contains Git, GitHub CLI, qmd, RTK 0.45.0, build tools, Python,
curl, jq, ripgrep, and fd. Pi is online and explicitly receives writable
filesystem and shell tools inside its bounded task jail. TypeScript 7 checks the
source, while `bun test` exercises the TypeScript tests directly.

GitHub CLI and Git use `/tool-profile` instead of the disposable home directory:

```sh
cd /home/gaby/straylight-docker
./compose run --rm --no-deps --entrypoint gh \
  linear-agent-runner auth login --hostname github.com --git-protocol https --web --insecure-storage
./compose run --rm --no-deps --entrypoint gh \
  linear-agent-runner auth setup-git
./compose run --rm --no-deps --entrypoint gh \
  linear-agent-runner auth status
```

This deliberately gives one trusted engineer's task jails reusable GitHub access.
It is appropriate for the personal pilot, but it is not a multi-user capability
broker. Pi should call `request_access` with the developer-tools workspace when
the CLI reports missing or expired authentication; after SSH setup, reply
`resume` in Linear.

Pi can delegate bounded exploration, planning, review, and implementation tasks
to helper Pi processes. Helpers share `/workspace`, inherit cancellation and the
task jail, can use the same web-research extension, and cannot call the
controller-only Linear, Claude, or service-supervisor tools. Parallel
implementation should be reserved for edits that cannot overlap.

RTK's official Pi hook rewrites supported shell commands through the pinned,
checksum-verified binary and fails open if rewriting is unavailable. Use
`RTK_RAW=1 <command>` when exact unfiltered output is required. `rtk gain` shows
the estimated output savings.

## Web research

The runner pins `pi-web-access@0.18.0` and loads it explicitly rather than
allowing task repositories to select extensions. It provides generic search,
claim checking, readable/raw content fetching, and bounded retrieval of stored
results. The task configuration selects keyless Exa MCP search and disables the
interactive browser curator. An optional `exaApiKey` may be placed in
`tool-profile/web-search.json` if anonymous rate limits become material; the
workbench copies it privately into each task's Pi configuration.

The runner also pins `visual-explainer@0.8.1` and loads its single tool, skill,
and prompt set explicitly. Pi can turn architectures, schemas, plans, reviews,
and comparisons into self-contained HTML without another provider credential.
The package's fixed `~/.agent/diagrams` output is mounted onto the session's
writable `/workspace/.agent/diagrams` directory, so a generated page survives
warm follow-ups and can be shared through the existing Linear file surface.
Headless runs set `open: false`; browser QA and screenshots still use the owned
Playwright service. This is deterministic HTML/diagram generation, not a
general image-generation model.

## Persistent memory and task-local extensions

The host-owned `linear-agent/memory/` folder is mounted read-write at `/memory`
in every task. Pi writes ordinary Markdown and searches it with qmd BM25. The
index and qmd configuration are local to that folder and persistent; this basic
mode requires no API credential, embedding model, or semantic-model download.
Notes are context, not authority: Pi is instructed to verify drift-prone facts
and never store secrets, authentication codes, or raw private transcripts.

Pi loads the normal global extension directories plus the pinned web and visual
explanation extensions.
It may create task-local extensions under `/workspace/.pi/extensions` and call
`reload_resources`. Reload is deferred until the current model turn has ended,
is capped at three times per run, and reports extension diagnostics back to Pi.
Those extensions persist only with the matching session workspace; installing a
global extension for future sessions remains an explicit SSH/admin action.

## Development services

Pi's generic `service` tool supports `start`, `status`, `logs`, and `stop` for:

- PostgreSQL 17.10, disposable by default or retained under the session's
  `.services/postgres` workspace directory when `persistent` is explicitly set
- a Playwright 1.62 remote browser server for headless frontend QA, launched
  from the prebuilt `linear-agent-browser:local` image without runtime `npx`

Docker stays entirely behind the trusted workbench. The tool returns connection
details rather than Docker identifiers. Project servers run in the task
container and must bind to `0.0.0.0`; the browser reaches them through the
private network host `task`. Sidecars have read-only roots, dropped capabilities,
no privilege escalation, CPU/memory/PID limits, no workspace mounts, and no host
ports. Sidecars and their private network stay with a warm session for up to ten
minutes, then are removed together. Stop, cancellation, crashes, and warm-pool
eviction remove them immediately.
The Playwright launcher and browser binaries survive in reusable image layers,
and the runner pins the matching `playwright-core` client so tasks do not install
it on demand. Browser profiles, pages, and process state survive follow-ups only while
that warm lease remains alive. Only explicitly persistent PostgreSQL files
survive its removal.

The tracked capability slices and acceptance checks live in `ROADMAP.md`.

## Linear application configuration

The application should have:

- redirect URI: `<LINEAR_AGENT_PUBLIC_URL>/linear/oauth/callback`
- webhook URL: `<LINEAR_AGENT_PUBLIC_URL>/linear/webhook`
- scopes: `read`, `write`, `app:assignable`, `app:mentionable`
- webhook categories: **Agent session events**, **Inbox notifications**, and
  **Permission changes**

The new webhook categories do not require broader OAuth scopes. Saving the
application settings should be sufficient for the existing installation; if
Linear explicitly asks for reauthorization, use the protected install URL again.
Do not enable public distribution or client credentials for this personal pilot.

## Deploy

Deployments remain intentionally manual on Straylight:

```sh
cd /home/gaby/straylight-docker
yadm pull
yadm bootstrap
```

Bootstrap validates the new secrets, derives the live Docker socket group,
prepares task state and memory directories, builds the owned controller, runner,
Claude capsule, and Playwright images, reconciles the Compose stack, and retains
the existing Tailscale Funnel mapping.

## Verify

After the ten-minute warm lease expires, the controller and workbench should be
healthy and no task container should exist:

```sh
./compose ps linear-agent-controller linear-agent-runner linear-agent-claude-capsule
curl -fsS http://127.0.0.1:8787/healthz | jq
docker ps --filter label=dev.straylight.linear-agent.task=true
sudo tailscale funnel status
```

The health response reports controller session counts, whether native plans are
still enabled, notification dispositions, and the last registry recovery result
(`restored`, `resumed`, `skipped`, and `errors`), plus accepted/skipped inbound
file counts and bytes. `webhookInbox` reports pending/completed/dead-letter
deliveries, retry attempts, the next retry, and safe transient/permanent failure
summaries. Its workbench
snapshot includes `mode: warm-session-jails`, `runnerBackend`, active/warm/queued
tasks, actual task/service/network counts, the rolling ten-minute p75 CPU/RAM
sample and adaptive active limit, repository-cache refresh counts and the last
safe refresh result, the last safe task-failure diagnostic when present,
warm-session limits, and the installed RTK version. The model policy is
reported only when the Pi fallback is selected.
Immediately after a clean start it should show zero active tasks.

Then delegate a small issue. During the run and its warm lease, this should show
one session container with no published port:

```sh
docker ps --filter label=dev.straylight.linear-agent.task=true
```

Useful Linear smoke tests:

1. Delegate a tiny repository inspection and confirm the task uses
   `runnerBackend: claude`, reaches a QA child through the subscription-authenticated
   capsule, and leaves no Claude profile or Pi credential mount in the task.
2. Send a nonblocking Signal and confirm its queued FYI child remains for
   acknowledgement while the parent continues working.
3. “Ask me to choose between alpha and beta before continuing.” Confirm a
   Blocking Steering child issue is assigned to you with native priority and
   labels; either a button or free text in its Agent Session resumes the parent.
4. Finish a checked change and confirm QA contains evidence plus **Approve and
   complete** / **Not approved**. Approval completes parent and child without a
   new agent turn; free-text changes resume the parent and eventually return to QA.
5. Run a task with reasoning and a longer tool call. Confirm Linear replaces the
   activity with safe assistant text, thinking-token proof-of-life, and tool
   elapsed time; then keep Claude genuinely quiet longer than five minutes and
   confirm synthetic progress, no runner-stream timeout, and one eventual
   lifecycle transition.
6. Start a longer command and choose **Send stop request**. Confirm the session
   reports that it stopped and the task container disappears.
7. Send a follow-up within ten minutes. Confirm the same warm workspace,
   development processes, browser, and Claude conversation are reused without a
   new container; after ten minutes, confirm history and files reconstruct in a
   new container.
8. Put a Git repository with an `origin` under `workspace/repos`, delegate an
   issue naming it, and confirm the cache refreshes once, the agent clones into
   its private workspace using the cache, and its `origin` remains the canonical
   HTTPS GitHub URL.
9. Ask the agent to inspect and publish a screenshot or report from `/workspace`;
   confirm it is viewed before any visual claim, uploaded to Linear's private
   storage, and rendered in the Agent Session.
10. Ask the agent to attach an HTTPS review URL, then a GitHub pull request URL;
   confirm both appear without invoking a PR-specific tool.
11. Create and mutate a plan, stop, resume, and confirm plan IDs and statuses are
   retained. On the Pi fallback, delegate a review helper and confirm stop
   terminates it too.
12. Ask the agent to search for a current fact and fetch one primary
    documentation page; confirm cited URLs are returned without requesting a
    credential.
13. Start disposable PostgreSQL, wait for healthy status, run a migration, and
   confirm the service and private session network disappear when the turn ends.
14. Start a project server on `0.0.0.0`, start the browser service, run a
    Playwright check through `task`, and publish its screenshot to Linear.
15. Publish a native review Document, start a fresh Agent Session, list the
    issue's documents, read and update it by id, then upload a small image and
    embed the returned private asset URL in that document. Finally publish a rich
    preview or pull-request attachment to the issue.
16. Ask the agent to create a small issue, update one property, attach it as a
    subissue, add and remove a relationship, and create/update a test project.
    Confirm each result returns a native Linear id and URL where applicable.
17. Mention Straylight, add an ordinary issue comment, and react to an agent
    message. Confirm only the Agent Session mention starts work; the comment is
    context-only and the reaction is recorded as an acknowledgement in
    `/healthz`.
18. On the Pi fallback, delegate one routine and one deliberately hard issue.
    Confirm the classifier choice appears after workspace setup, then ask the
    hard run to size up and confirm it moves exactly one allowlisted tier without
    losing session history.
19. Give an issue an obsolete description, then mention Straylight in a new
    comment with a different request. Confirm the agent acts on the mention while
    retaining the issue description only as supporting context.
20. On the Pi fallback, run representative Git, search, and test commands,
    inspect `rtk gain`, then repeat one with `RTK_RAW=1` and confirm the raw
    escape is unfiltered.
21. Attach a PNG and a text or PDF file to the initial request, then attach
    another PNG in an active-session follow-up. Confirm the activity reports
    accepted inputs, Claude inspects the image through `view_image`, and all files appear
    only under the matching session's `.linear-inputs` directory. Try an
    oversized or unsupported file and confirm it is skipped without failing the
    run or sending Linear authorization to another host.
22. Start a multi-step plan, leave implementation complete but deployment
    pending, and ask the agent to close the turn. Confirm every plan item displays
    an explicit disposition, the deployment item names its owner and next
    action, and the final response does not claim customer-visible completion.
23. Link an existing Document from an issue-backed Agent Session and ask the
    agent to process its inline review threads. Confirm it receives the selected
    text plus bounded Document/thread context, revises the same Document id,
    replies `Applied`, `Declined`, or `Needs decision`, and resolves only fully
    answered threads. A direct mention inside a Document comment is currently
    rejected by Linear's Agent Session API; confirm it becomes one safe
    dead-letter entry rather than an indefinitely retried delivery.

Logs:

```sh
./compose logs -f linear-agent-controller linear-agent-runner linear-agent-claude-capsule
```

## Remaining security boundary

This is a substantial isolation improvement, not a hostile-code microVM. Docker
containers share Straylight's kernel and task containers have outbound internet
access for development tools. Every task can read the shared single-engineer
GitHub tool profile while it runs; only the explicit Pi fallback additionally
receives a private copy of the Codex OAuth credential and loads the pinned web
and visual-explainer extensions. The Playwright image is intended for development
QA, not as a hardened browser for hostile sites. A future credential/model broker
would remove the fallback's reusable secret; gVisor, Kata, or a
microVM backend could strengthen kernel isolation without changing the Linear
controller contract.
