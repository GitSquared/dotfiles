if not status is-interactive
	exit
end

pyenv init --path | source
source (rbenv init -|psub)
pyenv init - | source
zoxide init fish | source
direnv hook fish | source
thefuck --alias | source
nvm use default --silent

# Homebrew updates disabled here as they need to be one with the main user account
alias full_upgrade='npm update -g;pip list --user | tail -n +3 | awk "{print $1}" | xargs pip install --user -U; fish_update_completions; ncu -g; fisher update; tldr --update;nvim --headless -c "TSUpdateSync" -c "autocmd User PackerComplete quitall" -c "PackerSync"'
alias pinentry='pinentry-mac'
alias weather='curl wttr.in'

alias ranger='ranger-cd' # with fish integration via fisher plugin

alias ls='exa -l --git --group-directories-first --time-style=iso --icons'
alias tree='exa -T --git-ignore -I "**/node_modules" --icons --group-directories-first'
alias cat='bat'
alias icat='kitty +kitten icat'
alias lg='lazygit'
alias tf='terraform'

fish_add_path /opt/homebrew/bin
fish_add_path /opt/homebrew/sbin
fish_add_path /opt/homebrew/lib
fish_add_path $HOME/.cargo/bin
fish_add_path $PYENV_ROOT/bin
fish_add_path $HOME/.local/bin

fish_add_path /opt/homebrew/opt/postgresql@11/bin

set -x ANDROID_SDK_ROOT $HOME/Library/Android/sdk
fish_add_path $ANDROID_SDK_ROOT/emulator
fish_add_path $ANDROID_SDK_ROOT/platform-tools
fish_add_path /Applications/Android\ Studio.app/Contents/jre/Contents/Home/bin

fish_vi_key_bindings

set --global tide_left_prompt_items pwd git newline character
set --global tide_right_prompt_items status cmd_duration context jobs virtual_env time

set -x EDITOR nvim
set -x NODE_ENV development
set -x HOMEBREW_NO_ENV_HINTS 1

# This is respected by most NPM packages postinstall scripts
set -x ADBLOCK 1

# M1 + Alan
set -x CFLAGS "-I$(brew --prefix openssl)/include -I$(brew --prefix bzip2)/include -I$(brew --prefix readline)/include -I$(xcrun --show-sdk-path)/usr/include"
set -x LDFLAGS "-L$(brew --prefix openssl)/lib -L$(brew --prefix readline)/lib -L$(brew --prefix zlib)/lib -L$(brew --prefix bzip2)/lib"

function fish_greeting
	fortune -s
end
