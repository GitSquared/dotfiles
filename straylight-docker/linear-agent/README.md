# Straylight Linear agent

This is Straylight's owned Linear-to-Pi bridge. It contains no source or build
dependency on `hiasinho/linear-pi-agent`; that project was a behavioral reference
for the first OAuth, Agent Session, progress, follow-up, and cancellation loop.

## Boundary

The service is split across two containers on a dedicated Docker network:

- `linear-agent` is the trusted controller. It owns Linear OAuth and webhook
  secrets, accepts Funnel traffic, and is the only component that calls Linear.
  It has no Pi configuration or workspace mount.
- `linear-agent-runner` owns Pi, Codex authentication, session histories, and
  `/workspace`. It receives a narrow task/follow-up/cancel protocol and streams
  structured activities back. It receives no Linear credentials or token store.

The controller binds only to `127.0.0.1:8787` on Straylight. The existing host
Tailscale daemon owns the public identity and persists a Funnel mapping for
`/linear` to that loopback port. Linear webhooks are accepted only after HMAC
verification and a 60-second timestamp check. The runner publishes no host port.

Both containers are non-root, drop all Linux capabilities, disallow privilege
escalation, use read-only root filesystems with bounded temporary storage, and
have CPU, memory, and process limits. Neither receives the host Docker socket or
general-purpose SSH credentials.

The pilot persists Linear OAuth tokens and Pi session files, but active execution
and follow-up ownership remain in memory. It must not be horizontally replicated
yet. Pi sessions still share one runner and workspace; disposable per-task
workers are the next isolation layer.

## Native Linear experience

The controller uses Linear's Agent Session primitives rather than posting plain
comments:

- ephemeral thoughts and native action cards for live work
- Agent Plans when the preview API is available, with a safe fallback
- native elicitations through Pi's `ask_linear` tool
- follow-ups and cancellation in the existing session
- automatic pull-request session links when Pi reports a GitHub PR URL

Pi also has an `update_linear_plan` tool for replacing the session checklist
with a task-specific plan. The generic three-stage plan remains as a fallback.

## Before bootstrap

Add these values to `/home/gaby/straylight-docker/.env`:

- `LINEAR_CLIENT_ID`
- `LINEAR_CLIENT_SECRET`
- `LINEAR_WEBHOOK_SECRET`
- `LINEAR_AGENT_INSTALL_SECRET` (at least 32 random characters)
- `LINEAR_AGENT_PUBLIC_URL` (`https://<Straylight MagicDNS name>`)

The agent uses Pi's `openai-codex` provider with a ChatGPT Plus or Pro
subscription. API keys are not used. After filling the Linear values, prepare
the mounted directories and build the image from `/home/gaby/straylight-docker`:

```sh
install -d -m 0700 linear-agent/data linear-agent/pi-config
install -d -m 0700 linear-agent/data/pi-sessions
install -d -m 0755 \
  linear-agent/workspace \
  linear-agent/workspace/repos \
  linear-agent/workspace/runs
docker compose build linear-agent linear-agent-runner
```

Then authenticate Pi directly into its persistent mounted configuration:

```sh
docker compose run --rm --no-deps \
  --workdir /home/node/.pi/agent \
  --entrypoint /app/node_modules/.bin/pi-ai \
  linear-agent-runner login openai-codex
```

Choose **Device code login (headless)**, open the URL Pi displays, and sign in
with the ChatGPT account that owns the Codex subscription. Pi writes a
refreshable OAuth credential to `linear-agent/pi-config/auth.json`; do not print,
copy from `~/.codex/auth.json`, or commit it. Confirm the result without exposing
its contents:

```sh
test -s linear-agent/pi-config/auth.json
test "$(stat -c '%a' linear-agent/pi-config/auth.json)" = 600
```

Bootstrap requires this user-owned `0600` file, verifies that the host is
already connected to Tailscale, checks that the public URL matches its MagicDNS
identity, and rebuilds both locally owned image targets before reconciling the
Compose stack.

Create a Linear OAuth application with:

- callback: `<LINEAR_AGENT_PUBLIC_URL>/linear/oauth/callback`
- webhook: `<LINEAR_AGENT_PUBLIC_URL>/linear/webhook`
- scopes: `read`, `write`, `app:assignable`, `app:mentionable`
- Agent Session events enabled

The first Funnel enablement may require approval in Tailscale's admin flow.

## Install and smoke-test

After `yadm bootstrap` reports a healthy Compose stack and Funnel, open:

```text
<LINEAR_AGENT_PUBLIC_URL>/linear/install?install_secret=<LINEAR_AGENT_INSTALL_SECRET>
```

Approve the app, then assign a small read-only issue to the agent. Confirm a
native plan and ephemeral activity appear quickly, Pi tool use renders as action
cards, a result returns, a follow-up stays in the same Agent Session, and `stop`
cancels an active run. A safe elicitation test is: "Ask me which of two names I
prefer before continuing." The session should wait for the reply.

Useful host checks:

```sh
docker compose --project-directory /home/gaby/straylight-docker logs -f linear-agent
docker compose --project-directory /home/gaby/straylight-docker logs -f linear-agent-runner
curl http://127.0.0.1:8787/healthz
sudo tailscale funnel status
```

The runner can still access its Codex OAuth material and every repository mounted
under `/workspace`; do not treat it as a hostile-code sandbox yet. The next
workbench stage is one disposable runner per issue, a single worktree mount, and
a credential broker that keeps Codex OAuth outside the task container.
