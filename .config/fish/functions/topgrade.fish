function topgrade --description 'Upgrade tools with Homebrew confirmations accepted'
    command topgrade --yes brew_formula brew_cask $argv
end
