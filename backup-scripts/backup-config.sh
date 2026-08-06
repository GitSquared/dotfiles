#!/bin/bash
set -euo pipefail

RCLONE_CONFIG="/home/gaby/.config/rclone/rclone.conf"

echo "=== Config backup started: $(date) ==="

# /etc - all system configs
rclone sync /etc s3-config-crypt:etc/ --skip-links --config "$RCLONE_CONFIG" --verbose --stats 1m

# Docker stack (excluding cache and live runtime files)
# AdGuard rewrites this query log while running, which can make rclone fail
# integrity checks because the source changes during upload.
# qBittorrent's ipc-socket is a Unix socket, not a regular file, so rclone
# cannot transfer it as backup content.
rclone sync /home/gaby/straylight-docker s3-config-crypt:docker/ \
  --exclude "jellyfin/cache/**" \
  --exclude "adguard/work/data/querylog.json" \
  --exclude "qbittorrent/config/ipc-socket" \
  --config "$RCLONE_CONFIG" --verbose --stats 1m

# rclone config (important!)
rclone copy /home/gaby/.config/rclone/rclone.conf s3-config-crypt:rclone/ --config "$RCLONE_CONFIG" --verbose --stats 1m

# the script itself (meta!)
rclone copy /home/gaby/backup-scripts s3-config-crypt:backup-scripts/ --config "$RCLONE_CONFIG" --verbose --stats 1m

echo "=== Config backup finished: $(date) ==="
