#!/bin/bash
set -euo pipefail

echo "=== Media backup started: $(date) ==="

rclone sync /mnt/mergerfs s3-storage-crypt: --transfers 4 --config /home/gaby/.config/rclone/rclone.conf --verbose --stats 5m --exclude "TimeMachine/**"

echo "=== Media backup finished: $(date) ==="
