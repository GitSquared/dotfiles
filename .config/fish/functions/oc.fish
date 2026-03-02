# oc - opencode wrapper that shows the worktree name in the terminal title
#
# Disables opencode's own title-setting, sets the terminal title to the
# worktree/directory name, then launches opencode. The title persists
# for the entire session.

function oc
    set wt (basename (pwd))

    # set terminal title to worktree name (OSC 2)
    printf "\e]2;[%s] opencode\a" $wt

    # launch opencode with its title-setting disabled so it won't override ours
    OPENCODE_DISABLE_TERMINAL_TITLE=1 opencode $argv

    # restore default title behavior after exit
    printf "\e]2;%s\a" $wt
end
