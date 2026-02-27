# oc - opencode wrapper that tints the input box per worktree
#
# Hashes the current directory basename to deterministically pick a hue,
# then tints the kanagawa theme's backgroundElement and borderActive
# before launching opencode. Same directory = same tint.

function oc
    set wt (basename (pwd))

    # deterministic hue from directory name (0-360)
    set hash (echo -n $wt | md5 -q | string sub -l 4)
    set hue (math "0x$hash % 360")

    # generate tinted colors:
    #   bg_element: very subtle tint on dark background (low sat, low lightness)
    #   border_active: visible but not loud accent border
    set colors (python3 -c "
import colorsys
h = $hue / 360
# subtle background tint - keep it dark, just enough color to notice
r,g,b = colorsys.hls_to_rgb(h, 0.22, 0.20)
print(f'#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}')
# border accent - more visible
r,g,b = colorsys.hls_to_rgb(h, 0.55, 0.45)
print(f'#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}')
")

    set bg_hex $colors[1]
    set border_hex $colors[2]

    # patch the worktree theme
    set theme_file ~/.config/opencode/themes/_wt.json
    if test -f $theme_file
        sed -i '' "s/\"wtBgElement\": \"#[0-9a-fA-F]\\{6\\}\"/\"wtBgElement\": \"$bg_hex\"/" $theme_file
        sed -i '' "s/\"wtBorderActive\": \"#[0-9a-fA-F]\\{6\\}\"/\"wtBorderActive\": \"$border_hex\"/" $theme_file
    end

    opencode $argv
end
