#!/bin/bash
# Get current workspace
current_workspace=$(aerospace list-workspaces --focused)
# Move sticky windows to current workspace
aerospace list-windows --all | grep -E "(Sunsama Focus Bar)" | awk '{print $1}' | while read window_id; do
    if [ -n "$window_id" ]; then
        aerospace move-node-to-workspace --window-id "$window_id" "$current_workspace"
    fi
done
