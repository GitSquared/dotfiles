# Straylight configuration

This is the public, declarative configuration for the Straylight home server.
The `straylight` yadm branch intentionally excludes credentials and mutable
application state. Encrypted rclone backups remain the recovery source for
databases, certificates, service state, and secrets.

## Public boundary

Never commit the real Docker `.env`, `rclone.conf`, Home Assistant secrets or
`.storage`, Caddy data, AdGuard state, qBittorrent state, *arr configuration or
databases, Jellyfin state, logs, caches, sockets, torrents, credentials, or
private keys. The root `.gitignore` and yadm `pre_commit` hook enforce this
boundary, but every staged diff must still be reviewed before publication.

The branch intentionally exposes the service list and versions, public domain
and email address, backup schedules, disk identifiers, mount topology, and the
audited Home Assistant automation logic.

## First installation

Install yadm, then fetch only the Straylight branch so another machine branch
is never checked out into this home directory:

```sh
sudo apt-get update
sudo apt-get install yadm
yadm init
yadm remote add origin https://github.com/GitSquared/dotfiles.git
yadm fetch origin straylight
yadm checkout -b straylight --track origin/straylight
```

Before bootstrap, securely provision:

- `/home/gaby/.config/rclone/rclone.conf`
- `/home/gaby/straylight-docker/.env`
- `/home/gaby/.ssh/id_ed25519` and its `.pub` file

Register the public SSH key with GitHub as both an authentication key and a
signing key. Bootstrap configures the local yadm repository to use the confirmed
`Gabriel Saillard <gabriel@saillard.dev>` identity and SSH-sign every commit.

Restore `s3-config-crypt:docker/` into `/home/gaby/straylight-docker/` before
starting the stack. Bootstrap refuses to start empty service instances when
the expected application-state sentinels are absent.

Review convergence without changing the machine:

```sh
STRAYLIGHT_DRY_RUN=1 yadm bootstrap
```

Apply full convergence:

```sh
yadm bootstrap
```

Bootstrap validates the host, secrets, state, disks, fstab, and Compose model;
installs packages and root-owned configuration; mounts storage; enables backup
timers; and reconciles the Docker Compose stack. Changed root files are copied
to `/var/backups/straylight-yadm/<timestamp>/` before replacement.

## Codex

The public desired state includes stable Codex preferences, the official OpenAI
developer-docs MCP endpoint, Straylight command rules, and the Sites and
Visualize plugins. On a fresh installation, bootstrap seeds `config.toml`. Once
Codex has generated marketplace metadata, bootstrap preserves that file and
reconciles MCP, marketplace, plugin, and rules state through supported commands.

Codex itself and its login are provisioned separately. Never commit
`~/.codex/auth.json`, sessions, archives, memories, goals, logs, databases,
installation IDs, caches, generated marketplace metadata, or plugin caches.

## Routine changes

Use explicit paths with `yadm add`, inspect `yadm diff --cached`, and keep each
commit focused. Never use force-add to bypass an ignore or hook rule. A second
bootstrap run should report no unnecessary file replacements or restarts.
