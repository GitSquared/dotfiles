return {
	{
		'kylesower/termcolors.nvim',
		lazy = false,
		priority = 1000,
		opts = { term_colors_only = false, color_adjust_amount = 0.04 },
		config = function(_, opts)
			-- Palette queries need a real terminal; keep headless jobs usable.
			if vim.fn.has('ttyin') == 0 or vim.fn.has('ttyout') == 0 then return end
			local theme = require('termcolors')
			theme.setup(opts)
			-- Notify UI plugins when automatic palette refreshes replace highlights.
			local load = theme.load
			theme.load = function()
				local previous = theme.colors
				load()
				if previous ~= theme.colors then
					-- Keep structural surfaces readable in both terminal appearances.
					local colors = theme.colors
					-- Semantic roles use the sampled ANSI slots, never fixed RGB colors.
					vim.api.nvim_set_hl(0, 'Statement', { fg = colors.values[5], bold = true })
					vim.api.nvim_set_hl(0, 'PreProc', { fg = colors.values[5] })
					vim.api.nvim_set_hl(0, 'Function', { fg = colors.values[7] })
					vim.api.nvim_set_hl(0, 'Special', { fg = colors.values[7] })
					vim.api.nvim_set_hl(0, 'Constant', { fg = colors.values[6] })
					vim.api.nvim_set_hl(0, 'String', { fg = colors.values[4] })
					vim.api.nvim_set_hl(0, '@constant.builtin', { link = 'Constant' })
					vim.api.nvim_set_hl(0, 'Operator', { fg = colors.fg })
					local panel = vim.api.nvim_get_hl(0, { name = 'CursorLine' }).bg
					for _, name in ipairs({ 'StatusLine', 'TabLineSel', 'Pmenu' }) do
						vim.api.nvim_set_hl(0, name, { fg = colors.fg, bg = panel })
					end
					for _, name in ipairs({ 'StatusLineNC', 'TabLine', 'TabLineFill' }) do
						vim.api.nvim_set_hl(0, name, { fg = colors.values[9], bg = colors.bg })
					end
					vim.api.nvim_set_hl(0, 'WinBar', { fg = colors.fg, bg = colors.bg })
					vim.api.nvim_set_hl(0, 'WinBarNC', { fg = colors.values[9], bg = colors.bg })
					vim.schedule(function()
						vim.api.nvim_exec_autocmds('ColorScheme', { pattern = 'termcolors' })
					end)
				end
			end
			vim.cmd.colorscheme('termcolors')
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
					icons_enabled = true,
					theme = 'auto',
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
					}, { 'copilot', show_colors = false }, 'diagnostics' },
					lualine_y = { 'filetype' },
					lualine_z = { { 'location', separator = { right = '' }, left_padding = 2 } },
				},
				inactive_sections = {
					lualine_a = { 'filename' },
					lualine_b = {},
					lualine_c = {},
					lualine_x = {},
					lualine_y = { { 'diagnostics', colored = false } },
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
				stages = 'static',
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
