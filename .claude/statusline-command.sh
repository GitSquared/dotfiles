#!/usr/bin/env bash
# Claude Code status line — merged: cwd/worktree/git + CO2/cost from claude-carbon

CARBON_DIR="${HOME}/git/claude-carbon"
FACTORS_FILE="${CARBON_DIR}/data/factors.json"

INPUT="$(cat)"

# — Workspace & git info —
CWD="$(echo "$INPUT" | jq -r '.cwd // .workspace.current_dir // ""')"
CWD_DISPLAY="${CWD/$HOME/\~}"

# Detect worktree
WORKTREE_PART=""
if [[ "$CWD" =~ \.claude/worktrees/([^/]+)(/|$) ]]; then
  WORKTREE_NAME="${BASH_REMATCH[1]}"
  WORKTREE_PART=" [wt: $WORKTREE_NAME]"
  REPO_ROOT="${CWD%/.claude/worktrees/${WORKTREE_NAME}*}"
  CWD_DISPLAY="${REPO_ROOT/$HOME/\~}"
fi

# Git branch
GIT_BRANCH=""
if git -C "$CWD" rev-parse --git-dir > /dev/null 2>&1; then
  BRANCH=$(git -C "$CWD" -c core.fsmonitor=false symbolic-ref --short HEAD 2>/dev/null \
    || git -C "$CWD" -c core.fsmonitor=false rev-parse --short HEAD 2>/dev/null)
  [ -n "$BRANCH" ] && GIT_BRANCH=" on $BRANCH"
fi

# — Model & context —
MODEL_ID="$(echo "$INPUT" | jq -r '.model.id // ""')"
DISPLAY_NAME="$(echo "$INPUT" | jq -r '.model.display_name // "Unknown"')"
USED_PCT="$(echo "$INPUT" | jq -r '.context_window.used_percentage // 0')"
INPUT_TOKENS="$(echo "$INPUT" | jq -r '.context_window.total_input_tokens // 0')"
OUTPUT_TOKENS="$(echo "$INPUT" | jq -r '.context_window.total_output_tokens // 0')"

# Progress bar (10 blocks)
FILLED=$(( USED_PCT * 10 / 100 ))
EMPTY=$(( 10 - FILLED ))
BAR=""
for ((i=0; i<FILLED; i++)); do BAR="${BAR}▓"; done
for ((i=0; i<EMPTY; i++)); do BAR="${BAR}░"; done

PCT_DISPLAY="${USED_PCT}%"
[ "${USED_PCT%.*}" -ge 80 ] 2>/dev/null && PCT_DISPLAY="COMPACT!"

# — CO2 (if factors file exists) —
CO2_PART=""
if [ -f "$FACTORS_FILE" ]; then
  MODEL_FAMILY="sonnet"
  echo "$MODEL_ID" | grep -qi "opus" && MODEL_FAMILY="opus"
  echo "$MODEL_ID" | grep -qi "haiku" && MODEL_FAMILY="haiku"

  FACTOR_IN="$(jq -r ".models.${MODEL_FAMILY}.input" "$FACTORS_FILE" 2>/dev/null)"
  FACTOR_OUT="$(jq -r ".models.${MODEL_FAMILY}.output" "$FACTORS_FILE" 2>/dev/null)"

  if [ -n "$FACTOR_IN" ] && [ -n "$FACTOR_OUT" ]; then
    CO2_G="$(echo "$INPUT_TOKENS $FACTOR_IN $OUTPUT_TOKENS $FACTOR_OUT" | LC_ALL=C awk '{printf "%.0f", ($1 * $2 + $3 * $4) / 1000000}')"
    if [ "$CO2_G" -ge 1000 ] 2>/dev/null; then
      CO2_PART=" | $(echo "$CO2_G" | LC_ALL=C awk '{printf "%.1fkg", $1/1000}') CO₂"
    else
      CO2_PART=" | ${CO2_G}g CO₂"
    fi
  fi
fi

echo "${CWD_DISPLAY}${WORKTREE_PART}${GIT_BRANCH} | ${DISPLAY_NAME} ${BAR} ${PCT_DISPLAY}${CO2_PART}"
