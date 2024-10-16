if not status is-interactive
	exit
end
pyenv init - | source
source (rbenv init -|psub)
zoxide init fish | source

alias pinentry='pinentry-mac'
alias full_upgrade='brew update; brew upgrade --greedy; npm update -g; fish_update_completions; fisher update; tldr --update;nvim --headless -c "Lazy! sync" -c "TSUpdateSync" +qa'
alias weather='curl wttr.in'

alias ranger='ranger-cd' # with fish integration via fisher plugin

alias ls='eza -l --git --group-directories-first --time-style=iso --icons'
alias tree='eza -T --git-ignore -I "**/node_modules" --icons --group-directories-first'
alias cat='bat'
alias icat='kitty +kitten icat'
alias lg='lazygit'

fish_add_path /opt/homebrew/bin
fish_add_path ~/.cargo/bin
fish_add_path ~/.local/bin

set -x ANDROID_SDK_ROOT $HOME/Library/Android/sdk
fish_add_path $ANDROID_SDK_ROOT/emulator
fish_add_path $ANDROID_SDK_ROOT/platform-tools
fish_add_path /opt/homebrew/opt/openjdk/bin

fish_vi_key_bindings

set --global tide_left_prompt_items pwd git newline character
set --global tide_right_prompt_items status cmd_duration context jobs virtual_env time

set -x EDITOR nvim
set -x NODE_ENV development
set -x HOMEBREW_NO_ENV_HINTS 1

# This is respected by most NPM packages postinstall scripts
set -x ADBLOCK 1

function fish_greeting
	fortune -s
end
