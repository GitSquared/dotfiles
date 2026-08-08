# Straylight Linear agent

This is Straylight's owned Linear-to-Pi bridge. It contains no source or build
dependency on `hiasinho/linear-pi-agent`; that project was only a behavioral
reference for the first OAuth and Agent Session loop.

The runtime uses mainline Pi from `earendil-works/pi`, published as
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
- Every Linear Agent Session is executed by a fresh task container. The task has
  one private persistent `/workspace`, its own Pi history and copy of Pi auth,
  read-only repository sources at `/repositories`, a shared single-engineer
  developer-tool profile at `/tool-profile`, and a one-time control token.
  It has no host port, Docker socket, SSH key, other task workspace, or
  `LINEAR_*` environment variable. The container is destroyed after each turn;
  the session workspace and history remain for native Linear follow-ups.
- Every active turn also gets a private auxiliary bridge network for supervised
  PostgreSQL and Playwright sidecars. The task joins it as `task`; sidecars have
  no host ports and cannot join another session's auxiliary network.
- `linear-agent-claude-capsule` is one engineer's persistent Claude Code identity and
  personal connection workbench. Its common image is stateless; Claude settings,
  connector approvals, and tokens live only in the named profile volume. Pi gets
  conversational `ask_claude` and generic `request_access` tools. Claude can use
  the engineer's existing claude.ai corporate integrations—including Slack,
  Notion, Google Drive, Gmail, and others—to retrieve context or carry out actions
  authorized by the Linear request. Task containers never mount or receive the
  capsule profile or its reusable control token.

The controller and task containers use separate Docker networks. The workbench
joins both but authenticates its controller API with
`LINEAR_AGENT_RUNNER_SECRET`; task containers receive different random tokens
that authenticate only their own short-lived runner API.

Task containers run as a non-root user with a read-only root filesystem, all
Linux capabilities dropped, privilege escalation disabled, bounded tmpfs, and
CPU, memory, and process limits. The workbench caps concurrent task containers
(three by default), queues excess sessions, removes orphaned task containers
after a restart, and stops a task if the controller disconnects.

The Docker socket is intentionally confined to the small workbench supervisor,
but possession of that socket is still host-root-equivalent. Treat the
workbench as trusted infrastructure, review its container-spec builder
carefully, and never expose its port outside the private Compose networks.

## Native Linear experience

The controller uses Linear's Agent Session primitives rather than plain issue
comments:

- immediate ephemeral thoughts so a new session is acknowledged within Linear's
  responsiveness window
- native action cards for Pi tool calls and isolated-workspace preparation
- durable task-specific Agent Plans managed with list/add/update/remove/replace
  verbs and reconstructed from Pi history across disposable containers
- one generic `linear` collaboration tool for native input requests, blockers,
  review notes, private file/image uploads, arbitrary session URLs, native
  review Documents, and rich issue attachments; input
  requests can include 2-12 options while still accepting free-text replies
- structured human `stop` signals, with generation invalidation and hard task
  container cancellation so no later action is published
- active-turn follow-ups, queued follow-ups, and conversation history across
  disposable containers
- ranked repository context from Linear's repository-suggestions API
- generic session URL attachment plus automatic pull-request discovery; GitHub
  PR URLs receive Linear's native enrichment without a PR-specific Pi tool
- human-delegated issues move to the team's first started state when the issue is
  actually delegated to the app user
- unassignment, terminal issue status, team-access removal, and OAuth revocation
  cancel affected work

Pi judges access failures itself. When a login, connection, approval, or
permission is missing, Pi calls `request_access` with a specific user-facing
explanation and selects either the Claude or developer-tool workbench. The
resulting `auth` signal always links to a matching first-party instructions page;
Pi cannot supply another URL.

## Host data layout

- `pi-config/` is Pi's persistent global profile. `auth.json` is the master
  Codex-subscription credential; global instructions and settings placed here
  are copied privately into every task.
- `workspace/repos/<name>` contains local repository sources. They are mounted
  read-only and should have an `origin` remote so Linear can rank them.
- `workspace/runs/<session-hash>` is the persistent private workspace for one
  Linear Agent Session.
- `tool-profile/` contains the single engineer's persistent GitHub CLI and Git
  credential-helper state plus an optional web-search provider configuration. It
  is mounted read-only into coding tasks and is not mounted into the controller
  or Claude capsule.
- `data/tasks/<session-hash>` contains the matching Pi history, Pi config, and a
  `session.json` mapping back to the Linear session and issue.
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

- `LINEAR_AGENT_MAX_CONCURRENT_TASKS=3`
- `LINEAR_AGENT_HOST_ROOT=/home/gaby/straylight-docker/linear-agent` if the
  Compose checkout ever moves elsewhere

Do not reuse the Linear client secret, webhook secret, or installation secret as
the runner secret. Do not add `DOCKER_GID` to `.env`: bootstrap derives it from
the live `/var/run/docker.sock`, exports it only for Compose, and stops safely
when the socket is absent or inaccessible.

## Pi authentication

The agent uses Pi's `openai-codex` provider with a ChatGPT Plus or Pro
subscription; API keys are not used. Existing `pi-config/auth.json` continues to
work. For a first login or reauthentication:

```sh
docker compose run --rm --no-deps \
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

## Persistent Pi instructions

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

## Connection capsule authentication

No Claude or Slack credential is present in an image, environment variable,
controller state, log, or task container. Claude and MCP credentials remain only
in the persistent per-engineer capsule profile. The named volume mounts all of
`/home/node`, so `.claude.json`, `.claude/`, connector approvals, and settings
created during an interactive SSH session survive image rebuilds and container
recreation. A separate generated 0600 token
file authorizes the workbench-to-capsule control channel and is never mounted in
a task jail.

Headless `ask_claude` calls run Claude on Sonnet in `auto` permission mode.
They use the connectors already visible in the engineer's claude.ai account; no
separate Slack MCP server or OAuth application is configured by this stack. The
connection-agent prompt permits retrieving context and performing actions within
Pi's concrete request. Corporate connectors are action-capable; local shell,
filesystem, web, and sub-agent tools remain denied because the capsule is a
corporate connection workbench rather than a second coding environment. The fixed
capsule API remains authenticated: a task jail uses its existing one-time runner
token to call the workbench, and the workbench uses the private capsule control
token. Neither reusable token nor the Claude profile enters a task jail.

If Pi judges from Claude's answer or error that a login, connector, approval, or
permission is missing, it sends a specific explanation to Linear and attaches the
generic instructions page. SSH into Straylight and launch the real interactive
workbench:

```sh
cd /home/gaby/straylight-docker
docker compose run --rm --no-deps --entrypoint claude \
  linear-agent-claude-capsule --permission-mode auto --model sonnet
```

Use Claude's normal interactive UI, including `/mcp`, to connect or approve the
needed service. Exit when finished, return to Linear, and reply `resume`. The
instructions are deliberately provider-neutral: Linear never receives an OAuth
code or provider credential. The prototype has no web terminal, callback broker,
second Linear app, durable OAuth ledger, or new queue.

Cancellation is propagated across the task request, workbench proxy, capsule HTTP
request, and Claude child process. A Linear stop or task disconnect therefore
terminates in-flight side-kick work instead of letting it run until the five-minute
capsule timeout.

## Developer-tool authentication

The runner image contains Node.js 24 LTS, Bun, Git, GitHub CLI, build tools,
Python, curl, jq, ripgrep, and fd. Pi is online and explicitly receives writable
filesystem and shell tools inside its bounded task jail.

GitHub CLI and Git use `/tool-profile` instead of the disposable home directory:

```sh
cd /home/gaby/straylight-docker
docker compose run --rm --no-deps --entrypoint gh \
  linear-agent-runner auth login --hostname github.com --git-protocol https --web --insecure-storage
docker compose run --rm --no-deps --entrypoint gh \
  linear-agent-runner auth setup-git
docker compose run --rm --no-deps --entrypoint gh \
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

## Web research

The runner pins `pi-web-access@0.18.0` and loads it explicitly rather than
allowing task repositories to select extensions. It provides generic search,
claim checking, readable/raw content fetching, and bounded retrieval of stored
results. The task configuration selects keyless Exa MCP search and disables the
interactive browser curator. An optional `exaApiKey` may be placed in
`tool-profile/web-search.json` if anonymous rate limits become material; the
workbench copies it privately into each task's Pi configuration.

## Development services

Pi's generic `service` tool supports `start`, `status`, `logs`, and `stop` for:

- PostgreSQL 17.10, disposable by default or retained under the session's
  `.services/postgres` workspace directory when `persistent` is explicitly set
- a Playwright 1.62 remote browser server for headless frontend QA

Docker stays entirely behind the trusted workbench. The tool returns connection
details rather than Docker identifiers. Project servers run in the task
container and must bind to `0.0.0.0`; the browser reaches them through the
private network host `task`. Sidecars have read-only roots, dropped capabilities,
no privilege escalation, CPU/memory/PID limits, no workspace mounts, and no host
ports. All sidecars and their private network are removed when the task ends;
only explicitly persistent PostgreSQL files remain.

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
prepares the task state directories, builds all owned image targets, reconciles the Compose stack, and
retains the existing Tailscale Funnel mapping.

## Verify

At rest, the controller and workbench should be healthy and no task container
should exist:

```sh
docker compose ps linear-agent-controller linear-agent-runner linear-agent-claude-capsule
curl -fsS http://127.0.0.1:8787/healthz | jq
docker ps --filter label=dev.straylight.linear-agent.task=true
sudo tailscale funnel status
```

The health response should report `mode: disposable-session-jails`, zero active
tasks, and the configured concurrency limit.

Then delegate a small issue. During the run, this should show one disposable
container with no published port:

```sh
docker ps --filter label=dev.straylight.linear-agent.task=true
```

Useful Linear smoke tests:

1. “Ask me to choose between alpha and beta before continuing.” Confirm native
   selection buttons appear and either a button or free text resumes the same
   session.
2. Start a longer command and choose **Send stop request**. Confirm the session
   reports that it stopped and the task container disappears.
3. Send a follow-up in the completed session. Confirm the prior Pi history and
   private workspace are reused through a new disposable container.
4. Put a Git repository with an `origin` under `workspace/repos`, delegate an
   issue naming it, and confirm Pi clones into its private workspace rather than
   editing the source.
5. Ask Pi to publish a screenshot or report from `/workspace`; confirm it is
   uploaded to Linear's private storage and rendered in the Agent Session.
6. Ask Pi to attach an HTTPS review URL, then a GitHub pull request URL; confirm
   both appear without invoking a PR-specific tool.
7. Create and mutate a plan, stop, resume, and confirm plan IDs and statuses are
   retained. Delegate a review helper and confirm stop terminates it too.
8. Ask Pi to search for a current fact and fetch one primary documentation page;
   confirm cited URLs are returned without requesting a credential.
9. Start disposable PostgreSQL, wait for healthy status, run a migration, and
   confirm the service and private session network disappear when the turn ends.
10. Start a project server on `0.0.0.0`, start the browser service, run a
    Playwright check through `task`, and publish its screenshot to Linear.
11. Publish a native review Document, update it using the returned document id,
    then publish a rich preview or pull-request attachment to the issue.

Logs:

```sh
docker compose logs -f linear-agent-controller linear-agent-runner linear-agent-claude-capsule
```

## Remaining security boundary

This is a substantial isolation improvement, not a hostile-code microVM. Docker
containers share Straylight's kernel and task containers have outbound internet
access for Codex and development tools. Each task can also read its private copy
of the Codex OAuth credential and the shared single-engineer GitHub tool profile
while it runs. The pinned web extension is third-party code running inside that
same task boundary, and the Playwright image is intended for development QA, not
as a hardened browser for hostile sites. A future credential/model broker
would remove that reusable secret from task containers; gVisor, Kata, or a
microVM backend could strengthen kernel isolation without changing the Linear
controller contract.
