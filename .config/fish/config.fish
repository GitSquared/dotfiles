status is-interactive; and pyenv init --path | source
source (rbenv init -|psub)
pyenv init - | source
zoxide init fish | source
direnv hook fish | source

alias full_upgrade='brew update; brew upgrade; curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash; npm update -g; fish_update_completions; ncu -g; fisher update; tldr --update;nvim -c "PlugUpgrade|PlugUpdate|CocUpdateSync|qa"'
alias weather='curl wttr.in'

alias ls='exa -l --git --group-directories-first --time-style=iso --icons'
alias tree='exa -T --git-ignore -I "**/node_modules" --icons --group-directories-first'
alias cat='bat'
alias icat='kitty +kitten icat'

fish_add_path $PYENV_ROOT/bin

kitty + complete setup fish | source
fish_vi_key_bindings
source ~/.config/fish/colors/fish_tokyonight_night.fish

set --global tide_left_prompt_items pwd git newline prompt_char
set --global tide_right_prompt_items status cmd_duration context jobs virtual_env time

set -x EDITOR nvim
set -x NODE_ENV development

# This is respected by most NPM packages postinstall scripts
set -x ADBLOCK 1

function fish_greeting
	fortune -s
end
