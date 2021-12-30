status is-interactive; and pyenv init --path | source
source (rbenv init -|psub)
pyenv init - | source
zoxide init fish | source
direnv hook fish | source
thefuck --alias | source
nvm use default --silent

alias full_upgrade='brew update; brew upgrade; npm update -g; fish_update_completions; ncu -g; fisher update; tldr --update;nvim --headless -c "autocmd User PackerComplete quitall" -c "PackerSync"'
alias weather='curl wttr.in'

alias ls='exa -l --git --group-directories-first --time-style=iso --icons'
alias tree='exa -T --git-ignore -I "**/node_modules" --icons --group-directories-first'
alias cat='bat'
alias icat='kitty +kitten icat'
alias lg='lazygit'
alias tf='terraform'

fish_add_path $PYENV_ROOT/bin
fish_add_path $HOME/.local/bin

kitty + complete setup fish | source
fish_vi_key_bindings
source ~/.config/fish/colors/rose_pine.fish

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
