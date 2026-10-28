# Straylight fish configuration.
#
# Mirrors the Neuromancer prompt and key bindings without the macOS-only
# tooling (Homebrew, pyenv, rbenv, nvm, the Android SDK, and the Aikido
# certificate overrides) or the ls/cat replacement aliases. Bootstrap makes
# fish the login shell, so an SSH session starts here.

if not status is-interactive
    exit
end

if command -q zoxide
    zoxide init fish | source
end

# $PATH setup
fish_add_path ~/.local/bin

# ANSI colors follow the terminal in both light and dark mode.
fish_config theme choose 'fish default'

# Keep Tide's layout, but let terminal colors replace its RGB defaults.
for name in (set --names | string match -r '^tide_.*color.*$')
    switch $name
        # These are separator text, despite having "color" in their names.
        case 'tide_left_prompt_separator_*_color' 'tide_right_prompt_separator_*_color'
            continue
        case '*bg_color*' '*separator*' '*frame*'
            set -g $name normal
        case '*failure*' '*conflicted*' '*urgent*' '*operation*'
            set -g $name red
        case '*dirty*' '*untracked*'
            set -g $name yellow
        case '*staged*' '*stash*' '*upstream*' 'tide_character_color'
            set -g $name green
        case '*branch*' '*anchors*'
            set -g $name blue
        case '*truncated*'
            set -g $name brblack
        case '*dirs*'
            set -g $name cyan
        case '*vi_mode*'
            set -g $name magenta
        case '*'
            set -g $name normal
    end
end

# Prompt layout. These are globals so this file stays authoritative: Tide
# keeps its configuration in universal variables otherwise, which a rebuild
# would silently leave behind.
set -g tide_left_prompt_items pwd git newline character
set -g tide_right_prompt_items status cmd_duration context jobs bun node python rustc java ruby go gcloud kubectl terraform
set -g _tide_left_items $tide_left_prompt_items
set -g _tide_right_items $tide_right_prompt_items
set -g tide_prompt_add_newline_before true
set -g tide_prompt_min_cols 34
set -g tide_prompt_transient_enabled false
set -g tide_left_prompt_frame_enabled false
set -g tide_right_prompt_frame_enabled false
set -g tide_prompt_pad_items false

# Prompt config
fish_vi_key_bindings

# Keep the cursor blinking in every vi mode (fish's vi-cursor hook otherwise
# re-asserts a steady shape on every prompt/mode change, overriding terminal config)
set -g fish_cursor_default block blink
set -g fish_cursor_insert line blink
set -g fish_cursor_replace_one underscore blink
set -g fish_cursor_visual block blink
