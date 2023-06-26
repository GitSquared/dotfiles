hs.ipc.cliInstall("/opt/homebrew")

stackline = require("stackline")
stackline:init()

stackline.config:set("paths.yabai", "/opt/homebrew/bin/yabai")
stackline.config:set("appearance.showIcons", false)
stackline.config:set("appearance.offset.x", 3)
stackline.config:set("appearance.offset.y", 10)
