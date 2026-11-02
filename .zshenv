. "$HOME/.cargo/env"

# Agent-driven shells have no TTY; any command that opens an editor would block
# forever instead. GIT_EDITOR only affects git, so interactive commits keep nvim.
if [ -n "$PI_CODING_AGENT" ] || [ -n "$CLAUDECODE" ]; then
  export GIT_EDITOR=true
fi
