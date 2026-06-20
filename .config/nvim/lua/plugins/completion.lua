return {
	{
		'saghen/blink.cmp',
		version = '1.*',
		dependencies = {
			'xzbdmw/colorful-menu.nvim', -- treesitter syntax highlighting in completions
		},
		---@module 'blink.cmp'
		---@type blink.cmp.Config
		opts = {
			keymap = {
				preset = 'enter',
				['<Tab>'] = { 'select_next', 'fallback' },
				['<S-Tab>'] = { 'select_prev', 'fallback' },
			},
			signature = { enabled = true },
			completion = {
				keyword = { range = 'full' },
				ghost_text = { enabled = false },
				list = {
					selection = {
						preselect = false,
						auto_insert = true,
					},
				},
				documentation = {
					auto_show = true,
					auto_show_delay_ms = 500,
				},
				menu = {
					draw = {
						columns = { { 'kind_icon' }, { 'label', gap = 1 } },
						components = {
							label = {
								text = function(ctx)
									return require('colorful-menu').blink_components_text(ctx)
								end,
								highlight = function(ctx)
									return require('colorful-menu').blink_components_highlight(ctx)
								end,
							},
						},
					},
				},
			},
			sources = {
				default = { 'lsp', 'path', 'snippets', 'buffer' },
			},
			appearance = {
				nerd_font_variant = 'mono',
				kind_icons = {
					Text = '󰉿',
					Method = '󰊕',
					Function = '󰊕',
					Constructor = '󰒓',
					Field = '󰜢',
					Variable = '󰆦',
					Property = '󰖷',
					Class = '󱡠',
					Interface = '󱡠',
					Struct = '󱡠',
					Module = '󰅩',
					Unit = '󰪚',
					Value = '󰦨',
					Enum = '󰦨',
					EnumMember = '󰦨',
					Keyword = '󰻾',
					Constant = '󰏿',
					Snippet = '󱄽',
					Color = '󰏘',
					File = '󰈔',
					Reference = '󰬲',
					Folder = '󰉋',
					Event = '󱐋',
					Operator = '󰪚',
					TypeParameter = '󰬛',
				},
			},
		},
	},
}
