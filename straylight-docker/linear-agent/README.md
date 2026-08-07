# Straylight Linear agent

This is Straylight's owned Linear-to-Pi bridge. It contains no source or build
dependency on `hiasinho/linear-pi-agent`; that project was a behavioral reference
for the first OAuth, Agent Session, progress, follow-up, and cancellation loop.

## Boundary

The Docker container binds only to `127.0.0.1:8787` on Straylight. The existing
host Tailscale daemon owns the public identity and persists a Funnel mapping for
`/linear` to that loopback port. Linear webhooks are accepted only after HMAC
verification and a 60-second timestamp check.

The pilot persists Linear OAuth tokens and Pi session files, but active execution
and follow-up ownership remain in memory. It is deliberately one container and
must not be horizontally replicated yet.

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
install -d -m 0755 \
  linear-agent/workspace \
  linear-agent/workspace/repos \
  linear-agent/workspace/runs
docker compose build linear-agent
```

Then authenticate Pi directly into its persistent mounted configuration:

```sh
docker compose run --rm --no-deps \
  --workdir /home/node/.pi/agent \
  --entrypoint /app/node_modules/.bin/pi-ai \
  linear-agent login openai-codex
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
already connected to Tailscale, and checks that the public URL matches its
MagicDNS identity.

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

Approve the app, then assign a small read-only issue to the agent. Confirm an
initial activity appears quickly, a Pi result returns, a follow-up stays in the
same Agent Session, and `stop` cancels an active run.

Useful host checks:

```sh
docker compose --project-directory /home/gaby/straylight-docker logs -f linear-agent
curl http://127.0.0.1:8787/healthz
sudo tailscale funnel status
```

Do not mount the host Docker socket or general-purpose SSH credentials into this
container. A stronger per-run workbench is intentionally deferred until the
Linear-to-Pi bridge is proven.
