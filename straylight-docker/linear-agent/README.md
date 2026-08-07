# Straylight Linear agent

This is Straylight's owned Linear-to-Pi bridge. It contains no source or build
dependency on `hiasinho/linear-pi-agent`; that project was only a behavioral
reference for the first OAuth and Agent Session loop.

## Architecture and trust boundary

There are three roles:

- `linear-agent` is the trusted controller. It owns Linear OAuth and webhook
  secrets, accepts Funnel traffic, and is the only component that calls Linear.
  It has no Pi configuration, repository, Docker socket, or task workspace.
- `linear-agent-runner` is a narrow workbench supervisor. It receives
  authenticated run/follow-up/abort requests from the controller and is the only
  component with the Docker socket. It never receives Linear credentials or the
  Linear token store.
- Every Linear Agent Session is executed by a fresh task container. The task has
  one private persistent `/workspace`, its own Pi history and copy of Pi auth,
  read-only repository sources at `/repositories`, and a one-time control token.
  It has no host port, Docker socket, SSH key, other task workspace, or
  `LINEAR_*` environment variable. The container is destroyed after each turn;
  the session workspace and history remain for native Linear follow-ups.

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
- evolving Agent Plans, with a safe fallback while the preview API changes
- native elicitation; Pi's `ask_linear` tool can include 2-12 options to render a
  Linear `select` signal while still accepting free-text replies
- structured human `stop` signals, with generation invalidation and hard task
  container cancellation so no later action is published
- active-turn follow-ups, queued follow-ups, and conversation history across
  disposable containers
- ranked repository context from Linear's repository-suggestions API
- automatic pull-request session links when Pi reports a GitHub PR URL
- human-delegated issues move to the team's first started state when the issue is
  actually delegated to the app user
- unassignment, terminal issue status, team-access removal, and OAuth revocation
  cancel affected work

The `auth` signal is represented by the internal protocol but is deliberately
not exposed as an arbitrary Pi tool. It needs a real trusted account-linking
provider and URL allowlist first; otherwise prompt-injected work could render a
convincing phishing button inside Linear.

## Host data layout

- `pi-config/auth.json` is the master Codex-subscription credential. A private
  copy is made for each task and a newer refreshed copy is atomically retained.
- `workspace/repos/<name>` contains local repository sources. They are mounted
  read-only and should have an `origin` remote so Linear can rank them.
- `workspace/runs/<session-hash>` is the persistent private workspace for one
  Linear Agent Session.
- `data/tasks/<session-hash>` contains the matching Pi history, Pi config, and a
  `session.json` mapping back to the Linear session and issue.

Existing shared `data/pi-sessions/<session-id>.jsonl` histories are copied into
the new per-session layout lazily on first use. Persistent task data is not
deleted automatically yet; that avoids surprising loss while the pilot is
young.

## One-time environment update

Keep the existing Linear values in `/home/gaby/straylight-docker/.env` and add:

- `LINEAR_AGENT_RUNNER_SECRET`: a new independent random value containing at
  least 32 characters. Generate one with `openssl rand -hex 32` and paste only
  the output into `.env`.
- `DOCKER_GID`: the numeric result of `getent group docker | cut -d: -f3` on
  Straylight. This lets the non-root workbench reach the mounted Docker socket.

Optional settings:

- `LINEAR_AGENT_MAX_CONCURRENT_TASKS=3`
- `LINEAR_AGENT_HOST_ROOT=/home/gaby/straylight-docker/linear-agent` if the
  Compose checkout ever moves elsewhere

Do not reuse the Linear client secret, webhook secret, or installation secret as
the runner secret.

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

Bootstrap validates the new secrets and Docker group, prepares the task state
directories, builds both owned image targets, reconciles the Compose stack, and
retains the existing Tailscale Funnel mapping.

## Verify

At rest, the controller and workbench should be healthy and no task container
should exist:

```sh
docker compose ps linear-agent linear-agent-runner
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

Logs:

```sh
docker compose logs -f linear-agent linear-agent-runner
```

## Remaining security boundary

This is a substantial isolation improvement, not a hostile-code microVM. Docker
containers share Straylight's kernel and task containers have outbound internet
access for Codex and development tools. Each task can also read its private copy
of the Codex OAuth credential while it runs. A future credential/model broker
would remove that reusable secret from task containers; gVisor, Kata, or a
microVM backend could strengthen kernel isolation without changing the Linear
controller contract.
