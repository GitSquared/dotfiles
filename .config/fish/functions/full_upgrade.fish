function full_upgrade
    brew update; and brew upgrade --greedy

    mprocs \
        "npm update -g" \
        "npx skills update -g" \
        "fish -c 'fisher update'" \
        "fish -c 'fish_update_completions'" \
        "nvim --headless -c 'Lazy! sync' +qa" \
        "ya pkg upgrade"
end
