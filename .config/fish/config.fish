nvm use lts > /dev/null

alias clemence="echo '❤️'"

alias full_upgrade='paru; paru -c; sudo fwupdmgr refresh; rustup update stable; cargo install-update -a; npm update -g; fish_update_completions; ncu -g; sudo fwupdmgr get-updates; fisher update; tldr --update;nvim -c "PlugUpgrade|PlugUpdate|CocUpdateSync|qa"'
alias empty_swap='sudo swapoff -a; sudo swapon -a'
alias empty_ram='sudo sysctl -w vm.drop_caches=3'
alias restart_kwin='DISPLAY=:0 kwin_x11 --replace &; disown'
alias restart_plasma='kquitapp5 plasmashell; kstart5 plasmashell'
alias restart_latte='latte-dock --replace &; disown'
alias weather='curl wttr.in'

alias powertop='sudo powertop'
alias bandwhich='sudo bandwhich'

alias ls='exa -l --git --group-directories-first --time-style=iso --icons'
alias tree='exa -T --git-ignore -I "**/node_modules" --icons --group-directories-first'
alias cat='bat'
alias icat='kitty +kitten icat'
alias open='xdg-open'

fish_add_path ~/.cargo/bin ~/.local/bin

kitty + complete setup fish | source
fish_vi_key_bindings
source ~/.config/fish/colors/fish_tokyonight_night.fish

set --global tide_left_prompt_items pwd git newline prompt_char
set --global tide_right_prompt_items status cmd_duration context jobs virtual_env rust time

set -x EDITOR nvim
set -x NODE_ENV development
set -x THEFUCK_OVERRIDEN_ALIASES 'systemctl,powertop,bandwhich,ls,tree,cat,icat,git,open'

# Export gpg-agent auth socket for authenticating to SSH servers with GPG keys
set -x SSH_AUTH_SOCK (gpgconf --list-dirs agent-ssh-socket)
# This is respected by most NPM packages postinstall scripts
set -x ADBLOCK 1

function fish_greeting
	fortune -s songs-poems
end
