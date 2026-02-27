#!/bin/bash
# Fake sticky behavior for Sunsama Focus Bar
# Moves the Focus Bar to the current workspace and pins it to the top-right corner

# Get current workspace
current_workspace=$(aerospace list-workspaces --focused)

# Move sticky windows to current workspace
aerospace list-windows --all | grep -E "(Sunsama Focus Bar)" | awk '{print $1}' | while read window_id; do
    if [ -n "$window_id" ]; then
        aerospace move-node-to-workspace --window-id "$window_id" "$current_workspace"
    fi
done

# Pin the Focus Bar to the top-right corner of the screen
osascript -e '
tell application "System Events"
    tell (first process whose name contains "Sunsama")
        repeat with w in every window
            if name of w contains "Focus Bar" then
                -- Get screen dimensions from the desktop
                set screenSize to {2560, 1440}
                try
                    tell application "Finder"
                        set screenSize to bounds of window of desktop
                    end tell
                    -- bounds returns {0, 0, width, height}
                    set screenW to item 3 of screenSize
                    set screenH to item 4 of screenSize
                on error
                    set screenW to 2560
                    set screenH to 1440
                end try

                set wSize to size of w
                set winW to item 1 of wSize

                -- Position: top-right with a small margin
                -- X = screen width - window width - margin
                -- Y = just below menu bar
                set margin to 10
                set menuBarHeight to 25
                set position of w to {screenW - winW - margin, menuBarHeight + margin}
                exit repeat
            end if
        end repeat
    end tell
end tell
' &>/dev/null &
