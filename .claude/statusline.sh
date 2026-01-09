#!/bin/bash

# Kanagawa-inspired colors (dimmed for status line)
WAVE_BLUE=$'\033[38;5;68m'      # Blue for directories
CRYSTAL_BLUE=$'\033[38;5;109m'  # Light blue for git
AUTUMN_RED=$'\033[38;5;167m'    # Red for dirty indicator
SPRING_GREEN=$'\033[38;5;107m'  # Green for model
BOAT_YELLOW=$'\033[38;5;179m'   # Yellow for context
FUJI_GRAY=$'\033[38;5;102m'     # Gray for separators
RESET=$'\033[0m'

# Read JSON input from stdin
input=$(cat)

# Extract data from JSON
cwd=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name')

# Shorten pwd (replace home with ~)
pwd_display="$cwd"
if [[ "$cwd" == "$HOME"* ]]; then
    pwd_display="~${cwd#$HOME}"
fi

# Get just the last 2 path components for brevity (like Tide)
short_pwd=$(echo "$pwd_display" | awk -F/ '{
    if (NF <= 2) print $0
    else printf ".../%s/%s", $(NF-1), $NF
}')

# Git branch and dirty status
branch=""
is_dirty=false
if [ -d "$cwd/.git" ] || git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(cd "$cwd" 2>/dev/null && git branch --show-current 2>/dev/null)
    if [ -z "$branch" ]; then
        branch=$(cd "$cwd" 2>/dev/null && git rev-parse --short HEAD 2>/dev/null)
    fi
    if [ -n "$branch" ]; then
        if cd "$cwd" 2>/dev/null && (! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null); then
            is_dirty=true
        fi
    fi
fi

# Context window usage
pct=""
usage=$(echo "$input" | jq '.context_window.current_usage // empty')
if [ -n "$usage" ]; then
    current=$(echo "$input" | jq '.context_window.current_usage | .input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
    size=$(echo "$input" | jq '.context_window.context_window_size')
    if [ "$size" != "null" ] && [ "$size" -gt 0 ] 2>/dev/null; then
        pct=$((current * 100 / size))
    fi
fi

# Build status line (Tide-style: pwd git | model context)
printf "%s%s%s" "$WAVE_BLUE" "$short_pwd" "$RESET"

if [ -n "$branch" ]; then
    printf " %s%s%s" "$CRYSTAL_BLUE" "$branch" "$RESET"
    if [ "$is_dirty" = true ]; then
        printf "%s*%s" "$AUTUMN_RED" "$RESET"
    fi
fi

printf " %s|%s %s%s%s" "$FUJI_GRAY" "$RESET" "$SPRING_GREEN" "$model" "$RESET"

if [ -n "$pct" ]; then
    printf " %s%s%%%s" "$BOAT_YELLOW" "$pct" "$RESET"
fi

printf "\n"
