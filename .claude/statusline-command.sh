#!/usr/bin/env bash
# Claude Code status line script
# Receives JSON via stdin

input=$(cat)

cwd=$(echo "$input" | jq -r '.cwd // .workspace.current_dir // empty')
model=$(echo "$input" | jq -r '.model.display_name // empty')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Shorten home directory
cwd_display="${cwd/$HOME/\~}"

# Detect worktree: pattern is .claude/worktrees/<name> inside a repo
worktree_part=""
if [[ "$cwd" =~ \.claude/worktrees/([^/]+)(/|$) ]]; then
  worktree_name="${BASH_REMATCH[1]}"
  worktree_part=" [wt: $worktree_name]"
  # For display, show the repo root (parent of .claude/worktrees/<name>) shortened
  repo_root="${cwd%/.claude/worktrees/${worktree_name}*}"
  cwd_display="${repo_root/$HOME/\~}"
fi

# Git branch (skip optional lock to avoid hanging)
git_branch=""
if git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "$cwd" -c core.fsmonitor=false symbolic-ref --short HEAD 2>/dev/null || git -C "$cwd" -c core.fsmonitor=false rev-parse --short HEAD 2>/dev/null)
  [ -n "$branch" ] && git_branch=" on $branch"
fi

# Context usage indicator
ctx_part=""
if [ -n "$used_pct" ]; then
  used_int=${used_pct%.*}
  if [ "$used_int" -ge 80 ]; then
    ctx_indicator="!!"
  elif [ "$used_int" -ge 50 ]; then
    ctx_indicator="!"
  else
    ctx_indicator=""
  fi
  ctx_part=" [ctx: ${used_pct}%${ctx_indicator}]"
fi

# Model short name
model_part=""
[ -n "$model" ] && model_part=" | $model"

printf "\033[0;36m%s\033[0m\033[0;35m%s\033[0m\033[0;33m%s\033[0m\033[0;90m%s%s\033[0m" \
  "$cwd_display" \
  "$worktree_part" \
  "$git_branch" \
  "$model_part" \
  "$ctx_part"
