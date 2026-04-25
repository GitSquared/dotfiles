return {
	{
		'rebelot/kanagawa.nvim',
		config = function()
			require('kanagawa').setup({
				compile = false,
				undercurl = true,
				commentStyle = { italic = true },
				functionStyle = {},
				keywordStyle = { italic = true },
				statementStyle = { bold = true },
				typeStyle = {},
				transparent = true,
				dimInactive = true,
				terminalColors = true,
				colors = {
					palette = {},
					theme = {
						wave = {},
						lotus = {},
						dragon = {},
						all = { ui = { bg_gutter = 'none' } },
					},
				},
				overrides = function(colors)
					local theme = colors.theme
					local makeDiagnosticColor = function(color)
						local c = require('kanagawa.lib.color')
						return { fg = color, bg = c(color):blend(theme.ui.bg, 0.95):to_hex() }
					end
					return {
						DiagnosticVirtualTextHint  = makeDiagnosticColor(theme.diag.hint),
						DiagnosticVirtualTextInfo  = makeDiagnosticColor(theme.diag.info),
						DiagnosticVirtualTextWarn  = makeDiagnosticColor(theme.diag.warning),
						DiagnosticVirtualTextError = makeDiagnosticColor(theme.diag.error),
						Pmenu                      = { fg = theme.ui.shade0, bg = theme.ui.bg_p1 },
						PmenuSel                   = { fg = 'NONE', bg = theme.ui.bg_p2 },
						PmenuSbar                  = { bg = theme.ui.bg_m1 },
						PmenuThumb                 = { bg = theme.ui.bg_p2 },
					}
				end,
				theme = 'wave',
				background = { dark = 'wave', light = 'lotus' },
			})
			vim.cmd('colorscheme kanagawa')
			vim.api.nvim_set_hl(0, 'WinBar', { bg = 'NONE' })
			vim.api.nvim_set_hl(0, 'WinBarNC', { bg = 'NONE' })
			vim.api.nvim_set_hl(0, 'CursorLine', { bg = '#2A2A37' })
			vim.api.nvim_set_hl(0, 'ZenBg', { bg = '#1f1f28' })
		end,
	},

	{
		'nvimdev/dashboard-nvim',
		dependencies = { 'nvim-tree/nvim-web-devicons',
		'amansingh-afk/milli.nvim'
	},
		event = 'VimEnter',
		opts = function()
			local splash = require('milli').load({ splash = 'lights' })
			return {
				theme = 'hyper',
				shortcut_type = 'number',
				change_to_vcs_root = true,
				config = {
					header = splash.frames[1],
					shortcut = {
						{ desc = '󰏖 plugins', group = '@property', action = 'Lazy', key = 'p' },
						{ desc = '󰗊 lsp servers', group = 'Label', action = 'Mason', key = 'l' },
						{ desc = '⚙ config', group = 'Number', action = 'edit ~/.config/nvim', key = 'c' },
					},
					footer = {},
				},
				hide = { statusline = true, tabline = true, winbar = true },
			}
		end,
		config = function(_, opts)
			require('dashboard').setup(opts)
			require('milli').dashboard({ splash = 'lights', loop = true })
		end
	},

	{
		'romgrk/barbar.nvim',
		dependencies = { 'nvim-tree/nvim-web-devicons' },
		opts = {
			clickable = false,
			icons = {
				buffer_index     = false,
				buffer_number    = false,
				button           = '',
				diagnostics      = {
					[vim.diagnostic.severity.ERROR] = { enabled = true, icon = '' },
					[vim.diagnostic.severity.WARN]  = { enabled = true, icon = '' },
					[vim.diagnostic.severity.HINT]  = { enabled = true, icon = '' },
					[vim.diagnostic.severity.INFO]  = { enabled = true, icon = '' },
				},
				filetype         = { custom_colors = false, enabled = true },
				separator        = { left = '▎', right = '' },
				separator_at_end = true,
				modified         = { button = '●' },
				pinned           = { button = '', filename = true },
				preset           = 'default',
				alternate        = { filetype = { enabled = false }, button = '' },
				current          = { button = '' },
				inactive         = { button = '' },
				visible          = { modified = { buffer_number = false }, button = '' },
			},
			highlight_visible = true,
			semantic_letters = true,
		},
	},

	{
		'nvim-lualine/lualine.nvim',
		dependencies = { 'nvim-tree/nvim-web-devicons', 'AndreM222/copilot-lualine' },
		config = function()
			require('lualine').setup({
				options = {
					theme = 'kanagawa',
					icons_enabled = true,
					section_separators = { left = '', right = '' },
					component_separators = { left = '', right = '' },
				},
				sections = {
					lualine_a = { { 'mode', separator = { left = '' }, right_padding = 2 } },
					lualine_b = { 'filename', 'diff' },
					lualine_c = { {
						'branch',
						fmt = function(s)
							if string.len(s) > 26 then
								return string.sub(s, 0, 26) .. '...'
							end
							return s
						end,
					} },
					lualine_x = { {
						function()
							local msg = require('noice').api.statusline.mode.get()
							if msg == nil or msg == '-- INSERT --' then return '' end
							return msg
						end,
						cond = require('noice').api.statusline.mode.has,
						color = { fg = '#E6E1CF' },
					}, 'copilot', 'diagnostics' },
					lualine_y = { 'filetype' },
					lualine_z = { { 'location', separator = { right = '' }, left_padding = 2 } },
				},
				inactive_sections = {
					lualine_a = { 'filename' },
					lualine_b = {},
					lualine_c = {},
					lualine_x = {},
					lualine_y = { 'diagnostics' },
					lualine_z = { 'filetype' },
				},
			})
		end,
	},

	{
		'stevearc/dressing.nvim',
		opts = {
			select = { backend = { 'fzf_lua', 'builtin' } },
		},
	},

	{
		'rcarriga/nvim-notify',
		config = function()
			require('notify').setup({
				top_down = false,
				render = 'wrapped-compact',
				stages = 'fade_in_slide_out',
				timeout = 3000,
			})
		end,
	},

	{
		'folke/noice.nvim',
		event = 'VeryLazy',
		dependencies = { 'MunifTanjim/nui.nvim', 'rcarriga/nvim-notify' },
		opts = {
			lsp = {
				override = {
					['vim.lsp.util.convert_input_to_markdown_lines'] = true,
					['vim.lsp.util.stylize_markdown'] = true,
				},
			},
			presets = {
				command_palette = true,
				long_message_to_split = true,
				inc_rename = true,
				lsp_doc_border = true,
			},
		},
	},

	{
		'smjonas/inc-rename.nvim',
		config = function()
			require('inc_rename').setup()
		end,
	},

	{
		'lukas-reineke/indent-blankline.nvim',
		main = 'ibl',
		opts = {
			indent = { char = '▏', tab_char = '▏' },
			exclude = {
				filetypes = { 'dashboard', 'lspinfo', 'packer', 'checkhealth', 'help', 'man', 'NvimTree' },
			},
		},
	},

	{
		'mvllow/modes.nvim',
		config = function()
			require('modes').setup({
				colors = {
					bg = 'NONE',
					copy = '#E6C384',
					delete = '#E46876',
					change = '#FFA066',
					format = '#E6C384',
					insert = '#98BB6C',
					replace = '#98BB6C',
					select = '#957FB8',
					visual = '#957FB8',
				},
				set_cursor = true,
				set_cursorline = true,
				set_number = true,
				set_signcolumn = true,
				line_opacity = 0.4,
			})
		end,
	},

	{
		'folke/todo-comments.nvim',
		dependencies = { 'nvim-lua/plenary.nvim' },
		config = function()
			require('todo-comments').setup({})
		end,
	},

	'jeffkreeftmeijer/vim-numbertoggle',

	{
		'brenoprata10/nvim-highlight-colors',
		opts = {
			render = 'background',
			enable_named_colors = true,
			enable_tailwind = false,
		},
	},

	{
		'karb94/neoscroll.nvim',
		config = function()
			require('neoscroll').setup({ easing = 'quadratic' })
		end,
	},

	{
		'folke/twilight.nvim',
		opts = { dimming = { alpha = 0.35 } },
	},

	{
		'folke/zen-mode.nvim',
		config = function()
			require('zen-mode').setup({
				window = {
					backdrop = 1,
					width = 120,
					height = 1,
					options = {
						signcolumn = 'no',
						number = false,
						relativenumber = false,
						cursorline = false,
						cursorcolumn = false,
						foldcolumn = '0',
					},
				},
				plugins = {
					options = { enabled = true, ruler = false, showcmd = false },
					twilight = { enabled = true },
					gitsigns = { enabled = true },
				},
				on_open = function() vim.cmd('Copilot disable') end,
				on_close = function() vim.cmd('Copilot enable') end,
			})
		end,
	},

	{
		'chentoast/marks.nvim',
		event = 'VeryLazy',
		opts = {},
	},

	{
		'utilyre/barbecue.nvim',
		version = '*',
		dependencies = { 'SmiteshP/nvim-navic', 'nvim-tree/nvim-web-devicons' },
		opts = {
			theme = {
				normal   = { bg = 'NONE' },
				dirname  = { bg = 'NONE' },
				basename = { bg = 'NONE' },
				context  = { bg = 'NONE' },
			},
		},
	},

	{
		'hedyhli/outline.nvim',
		lazy = true,
		cmd = { 'Outline', 'OutlineOpen' },
		opts = {},
	},

	{
		'luukvbaal/statuscol.nvim',
		config = function()
			local builtin = require('statuscol.builtin')
			require('statuscol').setup({
				relculright = true,
				segments = {
					{ text = { '%s' },             click = 'v:lua.ScSa' },
					{ text = { builtin.foldfunc }, click = 'v:lua.ScFa' },
					{
						text = { builtin.lnumfunc, ' ' },
						condition = { true, builtin.not_empty },
						click = 'v:lua.ScLa',
					},
				},
			})
		end,
	},
}
