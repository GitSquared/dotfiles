if not status is-interactive
  exit
end

# Initialization
function fish_greeting
  fortune -s
end
pyenv init - | source
source (rbenv init -|psub)
zoxide init fish | source

# $PATH setup
fish_add_path /opt/homebrew/bin
fish_add_path ~/.cargo/bin
fish_add_path ~/.local/bin
set -x ANDROID_SDK_ROOT $HOME/Library/Android/sdk
fish_add_path $ANDROID_SDK_ROOT/emulator
fish_add_path $ANDROID_SDK_ROOT/platform-tools
fish_add_path /opt/homebrew/opt/openjdk/bin

# Default ENV
set -x EDITOR nvim
set -x NODE_ENV development
set -x HOMEBREW_NO_ENV_HINTS 1

# Prompt config
fish_vi_key_bindings

# Aliases
alias full_upgrade='brew update; brew upgrade --greedy; npm update -g; fish_update_completions; fisher update; tldr --update;nvim --headless -c "Lazy! sync" -c "TSUpdateSync" +qa'

alias ls='eza -l --git --group-directories-first --time-style=iso --icons'
alias tree='eza -T --git-ignore -I "**/node_modules" --icons --group-directories-first'
alias cat='bat'
alias icat='kitty +kitten icat'
alias lg='lazygit'
alias pinentry='pinentry-mac'
alias ranger='echo "use yazi instead!"' # retrain my muscle memory

# Automatically switch node version based on .nvmrc
function nvm_use_on_dir --on-variable PWD
  if status is-interactive
    if test -e ./.nvmrc || test -e ../.nvmrc || test -e ../../.nvmrc || test -e ../../../.nvmrc
      nvm use --silent
    else
      nvm use system --silent
    end
  end
end
