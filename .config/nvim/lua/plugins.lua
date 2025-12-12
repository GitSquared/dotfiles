local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"

if not vim.loop.fs_stat(lazypath) then
	vim.fn.system({
		"git",
		"clone",
		"--filter=blob:none",
		"https://github.com/folke/lazy.nvim.git",
		"--branch=stable", -- latest stable release
		lazypath,
	})
end
vim.opt.rtp:prepend(lazypath)

return require('lazy').setup({
	-- ************
	-- SYSTEM / IDE
	-- ************
	'tpope/vim-sensible', -- sensible default config

	{
		'nvim-treesitter/nvim-treesitter', -- syntax highlighting and general language understanding facilities
		run = ':TSUpdate',
		config = function()
			require('nvim-treesitter.configs').setup({
				ensure_installed = {
					"vim",
					"lua",
					"sql",
					"rust",
					"regex",
					"typescript",
					"tsx",
					"javascript",
					"scss",
					"yaml",
					"python",
					"toml",
					"latex",
					"html",
					"json",
					"http",
					"graphql",
					"fish",
					"dockerfile",
					"terraform",
					"bash",
					"css"
				},
				highlight = {
					enable = true,
				},
			})
		end
	},

	{
		'junnplus/lsp-setup.nvim', -- manage lsp installation and config in one place
		dependencies = {
			'neovim/nvim-lspconfig',
			'williamboman/mason.nvim',
			'williamboman/mason-lspconfig.nvim',
			'saghen/blink.cmp', -- load lsp setup when autocompletion engine is ready to integrate
		},
		opts = {
			default_mappings = false, -- cf ../shortcuts.vim
			servers = {
				bashls = {},
				cssls = {},
				biome = {},
				eslint = {},
				html = {},
				jsonls = {},
				ts_ls = {},
				tailwindcss = {},
				prismals = {},
				vimls = {},
				yamlls = {},
				terraformls = {},
				rust_analyzer = {},
				copilot = {},
				pylsp = {
					settings = {
						pylsp = {
							plugins = {
								pycodestyle = { enabled = false },
								black = { enabled = false },
								pylsp_mypy = { enabled = false },
								isort = { enabled = false },
								ruff = { enabled = true },
								jedi_completion = { fuzzy = true },
							}
						}
					},
				},
				lua_ls = {
					settings = {
						Lua = {
							diagnostics = {
								-- recognize the `vim` global
								globals = { 'vim' }
							},
							workspace = {
								-- recognize vim api
								library = vim.api.nvim_get_runtime_file("", true)
							}
						},
					}
				},
				jinja_lsp = {}
			},
			on_attach = function()
			end,
		},
		config = function(_, opts)
			require('lsp-setup').setup(opts)

			vim.api.nvim_create_autocmd("LspAttach", {
				callback = function(args)
					local client = vim.lsp.get_client_by_id(args.data.client_id)
					if not client or client.name ~= "pylsp" then
						return
					end

					local root_dir = client.config.root_dir
					if not root_dir then
						return
					end

					local venv_path = root_dir .. "/.venv"
					if vim.fn.isdirectory(venv_path) ~= 1 then
						return
					end

					local venv_pylsp = venv_path .. "/bin/pylsp"

					-- Auto-install pylsp if .venv exists but pylsp is not installed
					if vim.fn.executable(venv_pylsp) ~= 1 then
						vim.notify("Installing python-lsp-server in .venv...", vim.log.levels.INFO)
						local install_cmd = vim.fn.executable("uv") == 1
							 and string.format("cd %s && uv pip install 'python-lsp-server[all]'", vim.fn.shellescape(root_dir))
							 or string.format("%s/bin/pip install 'python-lsp-server[all]'", vim.fn.shellescape(venv_path))

						vim.fn.jobstart(install_cmd, {
							on_exit = function(_, exit_code)
								if exit_code == 0 then
									vim.notify("python-lsp-server installed! Restarting LSP...", vim.log.levels.INFO)
									vim.schedule(function()
										vim.lsp.stop_client(client.id, true)
										vim.schedule(function()
											vim.lsp.start({
												name = "pylsp",
												cmd = { venv_pylsp },
												root_dir = root_dir,
												settings = opts.servers.pylsp.settings,
											})
										end)
									end)
								else
									vim.notify("Failed to install python-lsp-server", vim.log.levels.ERROR)
								end
							end
						})
						return
					end

					-- Switch to project-local pylsp if not already using it
					local cmd_path = client.config.cmd[1]
					if cmd_path ~= venv_pylsp then
						vim.lsp.stop_client(client.id, true)
						vim.schedule(function()
							vim.lsp.start({
								name = "pylsp",
								cmd = { venv_pylsp },
								root_dir = root_dir,
								settings = opts.servers.pylsp.settings,
							})
						end)
					end
				end,
			})

			-- Configure diagnostics
			vim.diagnostic.config({
				virtual_text = true,
				virtual_lines = false,
				underline = true,
				update_in_insert = false,
				severity_sort = true,
				float = {
					focusable = false,
					style = "minimal",
					border = "rounded",
					source = "always",
				},
			})

			vim.api.nvim_create_autocmd('LspAttach', {
				callback = function(args)
					local client = vim.lsp.get_client_by_id(args.data.client_id)
					local bufnr = args.buf
					if client == nil then
						return
					end

					-- Highlight the current variable and its usages in the buffer.
					if client.supports_method('textDocument/documentHighlight') then
						vim.cmd [[
							hi! link LspReferenceRead Visual
							hi! link LspReferenceText Visual
							hi! link LspReferenceWrite Visual
						]]

						vim.api.nvim_create_augroup('lsp_document_highlight', {
							clear = false
						})
						vim.api.nvim_clear_autocmds({
							buffer = bufnr,
							group = 'lsp_document_highlight',
						})
						vim.api.nvim_create_autocmd({ 'CursorHold', 'CursorHoldI' }, {
							group = 'lsp_document_highlight',
							buffer = bufnr,
							callback = vim.lsp.buf.document_highlight,
						})
						vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI' }, {
							group = 'lsp_document_highlight',
							buffer = bufnr,
							callback = vim.lsp.buf.clear_references,
						})
					end
				end
			})
		end
	},

	{
		'HiPhish/jinja.vim', -- Jinja template syntax support
		config = function()
			-- Configure filetype detection for .sql.jinja files
			vim.filetype.add({
				extension = {
					['sql.jinja'] = 'sql.jinja',
				},
				pattern = {
					['.*%.sql%.jinja'] = 'sql.jinja',
				},
			})

			-- Additional autocmd to ensure proper filetype detection
			vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
				pattern = "*.sql.jinja",
				callback = function()
					vim.bo.filetype = "sql.jinja"
				end,
			})
		end
	},

	{
		"stevearc/conform.nvim", -- Foramt code while preserving marks and folds
		event = { "BufWritePre" },
		cmd = { "ConformInfo" },
		-- This will provide type hinting with LuaLS
		---@module "conform"
		---@type conform.setupOpts
		opts = {
			default_format_opts = {
				lsp_format = "fallback",
			},
			formatters_by_ft = {
				lua = { "stylua" },
				python = { "ruff_fix", "ruff_format" },
				javascript = { "biome", "biome-check", "biome-organize-imports", "eslint_d" },
				javascriptreact = { "biome", "biome-check", "biome-organize-imports", "eslint_d" },
				typescript = { "biome", "biome-check", "biome-organize-imports", "eslint_d" },
				typescriptreact = { "biome", "biome-check", "biome-organize-imports", "eslint_d" },
				json = { "biome", "biome-check" },
				sql = { 'sqruff' },
				["sql.jinja"] = { 'sqruff' },
				terraform = { 'terraform_fmt' },
				rust = { "rustfmt" },
			},
			format_on_save = { timeout_ms = 500 },
			formatters = {
				-- additional options here
			},
		},
		init = function()
			-- Allows using native neovim formatting utils like gq
			vim.o.formatexpr = "v:lua.require'conform'.formatexpr()"
		end,
	},

	'onsails/lspkind-nvim', -- icons in autocompletion window

	{
		'saghen/blink.cmp', -- autocompletion engine
		version = '1.*',
		dependencies = {
			'xzbdmw/colorful-menu.nvim', -- Treesitter syntax highlighting in completions
		},
		---
		---@module 'blink.cmp'
		---@type blink.cmp.Config
		opts = {
			-- 'default' (recommended) for mappings similar to built-in completions (C-y to accept)
			-- 'super-tab' for mappings similar to vscode (tab to accept)
			-- 'enter' for enter to accept
			-- 'none' for no mappings
			--
			-- All presets have the following mappings:
			-- C-space: Open menu or open docs if already open
			-- C-n/C-p or Up/Down: Select next/previous item
			-- C-e: Hide menu
			-- C-k: Toggle signature help (if signature.enabled = true)
			--
			-- See :h blink-cmp-config-keymap for defining your own keymap
			keymap = {
				preset = 'enter',
				['<Tab>'] = {
					function()
						return require('sidekick').nes_jump_or_apply()
					end,
					'select_next',
					'fallback'
				},
				['<S-Tab>'] = { 'select_prev', 'fallback' },
			},
			signature = { enabled = true },
			completion = {
				keyword = { range = 'full' },
				ghost_text = {
					enabled = false
				},
				list = {
					selection = {
						preselect = false,
						auto_insert = true
					}
				},
				documentation = {
					auto_show = true,
					auto_show_delay_ms = 500
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
					}
				}
			},
			sources = {
				default = { 'lsp', 'path', 'snippets', 'buffer' },
			},
			appearance = {
				nerd_font_variant = 'mono',
				-- Blink does not expose its default kind icons so you must copy them all
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

	{
		'chentoast/marks.nvim', -- Better marks keybind and support
		event = 'VeryLazy',
		opts = {},
	},

	-- AI
	{
		'folke/sidekick.nvim', -- AI CLIs integration
		opts = {}
	},

	{
		'zbirenbaum/copilot.lua', -- GitHub Copilot
		cmd = 'Copilot',
		event = 'InsertEnter',
		config = function()
			require("copilot").setup({
				suggestion = {
					enabled = true,
					auto_trigger = true,
					keymap = {
						accept = "<A-Tab>",
					}
				},
				panel = { enabled = false },
			})
		end,
	},


	-- ************
	-- UI
	-- ************
	{
		'rebelot/kanagawa.nvim', -- theme/colorscheme
		config = function()
			require('kanagawa').setup({
				compile = false,
				undercurl = true,
				commentStyle = { italic = true },
				functionStyle = {},
				keywordStyle = { italic = true },
				statementStyle = { bold = true },
				typeStyle = {},
				transparent = false,
				dimInactive = true,
				terminalColors = true,
				colors = {
					palette = {},
					theme = {
						wave = {},
						lotus = {},
						dragon = {},
						all = {
							ui = {
								bg_gutter = "none"
							}
						}
					}
				},
				overrides = function(colors)
					local theme = colors.theme
					local makeDiagnosticColor = function(color)
						local c = require("kanagawa.lib.color")
						return { fg = color, bg = c(color):blend(theme.ui.bg, 0.95):to_hex() }
					end

					return {
						DiagnosticVirtualTextHint  = makeDiagnosticColor(theme.diag.hint),
						DiagnosticVirtualTextInfo  = makeDiagnosticColor(theme.diag.info),
						DiagnosticVirtualTextWarn  = makeDiagnosticColor(theme.diag.warning),
						DiagnosticVirtualTextError = makeDiagnosticColor(theme.diag.error),

						Pmenu                      = { fg = theme.ui.shade0, bg = theme.ui.bg_p1 }, -- add `blend = vim.o.pumblend` to enable transparency
						PmenuSel                   = { fg = "NONE", bg = theme.ui.bg_p2 },
						PmenuSbar                  = { bg = theme.ui.bg_m1 },
						PmenuThumb                 = { bg = theme.ui.bg_p2 },
					}
				end,
				theme = "wave",
				background = {
					dark = "wave",
					light = "lotus"
				},
			})
			vim.cmd('colorscheme kanagawa')

			vim.api.nvim_set_hl(0, 'WinBar', { bg = 'NONE' })
			vim.api.nvim_set_hl(0, 'WinBarNC', { bg = 'NONE' })
			vim.api.nvim_set_hl(0, 'CursorLine', { bg = '#2A2A37' })
			vim.api.nvim_set_hl(0, "ZenBg", { bg = '#1f1f28' })
		end
	},

	{
		"nvimdev/dashboard-nvim", -- start screen
		dependencies = { { "nvim-tree/nvim-web-devicons" } },
		event = "VimEnter",
		config = function()
			require("dashboard").setup({
				theme = 'hyper',
				shortcut_type = 'number',
				change_to_vcs_root = true,
				config = {
					header = {
						'                            ..-        ',
						'          +###.           .-.          ',
						'         .###+.         -+#++.         ',
						'         .###-.         -###++         ',
						'         +--.             ##-.++ - .   ',
						'       +##++++-            #+###+---   ',
						'       ######+-.          #+####+-.    ',
						'      +#######-+           #####+----  ',
						'      #########++         +####+#-+-   ',
						'      ###########++     ####+##+#+     ',
						'      ##########. +##+###.+#######+    ',
						'      #####+++##           #####+##    ',
						'      ######++#+-          ########    ',
						'        #####++++            ###-+     ',
						'        ######+              ##+-+     ',
						'        #####++              ###-      ',
						'        ###++++              +##+      ',
						'       .#####++               ###+     ',
						'       ######++               -###+    ',
						'       ###.###+               -###++.  ',
						'       ### +##+               -####+-  ',
						'      #### ####               ######+  ',
						'++++++#########+++++++++++++.+.-##-++  ',
						'                                       ',
						'                                       ',
					},
					shortcut = {
						{ desc = ' plugins', group = '@property', action = 'Lazy', key = 'p' },
						{
							desc = ' lsp servers',
							group = 'Label',
							action = 'Mason',
							key = 'l',
						},
						{
							desc = '⚙ config',
							group = 'Number',
							action = 'edit ~/.config/nvim/lua/plugins.lua',
							key = 'c',
						},
					},
					footer = {}
				},
				hide = {
					statusline = true,
					tabline = true,
					winbar = true,
				},
			})
		end,
	},

	{
		'romgrk/barbar.nvim', -- buffers management (="tab bar")
		dependencies = { 'nvim-tree/nvim-web-devicons' },
		opts = {
			clickable = false,
			icons = {
				-- Configure the base icons on the bufferline.
				-- Valid options to display the buffer index and -number are `true`, 'superscript' and 'subscript'
				buffer_index = false,
				buffer_number = false,
				button = '',
				-- Enables / disables diagnostic symbols
				diagnostics = {
					[vim.diagnostic.severity.ERROR] = { enabled = true, icon = '' },
					[vim.diagnostic.severity.WARN] = { enabled = true, icon = '' },
					[vim.diagnostic.severity.HINT] = { enabled = true, icon = '' },
					[vim.diagnostic.severity.INFO] = { enabled = true, icon = '' },
				},
				filetype = {
					-- Sets the icon's highlight group.
					-- If false, will use nvim-web-devicons colors
					custom_colors = false,

					-- Requires `nvim-web-devicons` if `true`
					enabled = true,
				},
				separator = { left = '▎', right = '' },

				-- If true, add an additional separator at the end of the buffer list
				separator_at_end = true,

				-- Configure the icons on the bufferline when modified or pinned.
				-- Supports all the base icon options.
				modified = { button = '●' },
				pinned = { button = '', filename = true },

				-- Use a preconfigured buffer appearance— can be 'default', 'powerline', or 'slanted'
				preset = 'default',

				-- Configure the icons on the bufferline based on the visibility of a buffer.
				-- Supports all the base icon options, plus `modified` and `pinned`.
				alternate = { filetype = { enabled = false }, button = '' },
				current = { button = '' },
				inactive = { button = '' },
				visible = { modified = { buffer_number = false }, button = '' },
			},
			highlight_visible = true,
			semantic_letters = true,
		},
	},

	{
		'mikavilpas/yazi.nvim', -- open yazi terminal file manager in a floating window
		event = 'VeryLazy',
		dependencies = { 'folke/snacks.nvim', lazy = true },
		opts = {}
	},

	{
		'nvim-lualine/lualine.nvim', -- fancy status line with mode indicator and cursor position
		dependencies = { 'nvim-tree/nvim-web-devicons', 'AndreM222/copilot-lualine' },
		config = function()
			require('lualine').setup({
				options = {
					theme = 'kanagawa',
					icons_enabled = true,
					section_separators = { left = '', right = '' },
					component_separators = { left = '', right = '' }
				},
				sections = {
					lualine_a = { { 'mode', separator = { left = '' }, right_padding = 2 } },
					lualine_b = { 'filename', 'diff' },
					lualine_c = { {
						'branch',
						fmt = function(s)
							if string.len(s) > 26 then
								return string.sub(s, 0, 26) .. '...'
							else
								return s
							end
						end
					} },
					lualine_x = { {
						-- Show msg_showmode notifications like recording macros
						-- cf https://github.com/folke/noice.nvim/wiki/A-Guide-to-Messages#showmode
						function()
							local msg = require("noice").api.statusline.mode.get()
							if msg == nil
								 -- Skip the INSERT mode message as it's redundant with section a
								 or msg == "-- INSERT --" then
								return ""
							end
							return msg
						end,
						cond = require("noice").api.statusline.mode.has,
						color = { fg = "#E6E1CF" },
					}, 'copilot', 'diagnostics' },
					lualine_y = { 'filetype' },
					lualine_z = { { 'location', separator = { right = '' }, left_padding = 2 } },
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
		end
	},

	{
		'stevearc/dressing.nvim', -- better UI for vim.input, vim.select...
		opts = {
			select = {
				backend = { 'fzf_lua', 'builtin' } -- prefer fuzzy finder for select
			}
		},
	},

	{
		'rcarriga/nvim-notify', -- pop-up notifications, replaces vim.notify
		config = function()
			require('notify').setup({
				top_down = false,
				render = 'wrapped-compact',
				stages = 'fade_in_slide_out',
				timeout = 3000,
			})
		end
	},

	{
		'folke/noice.nvim', -- better UI for cmdline and popupmenu, binds messages to nvim-notify
		event = 'VeryLazy',
		dependencies = {
			'MunifTanjim/nui.nvim',
			'rcarriga/nvim-notify',
		},
		opts = {
			lsp = {
				-- override markdown rendering so that **cmp** and other plugins use **Treesitter**
				override = {
					["vim.lsp.util.convert_input_to_markdown_lines"] = true,
					["vim.lsp.util.stylize_markdown"] = true,
				},
			},
			presets = {
				command_palette = true, -- position the cmdline and popupmenu together
				long_message_to_split = true, -- long messages will be sent to a split
				inc_rename = true,    -- enables an input dialog for inc-rename.nvim
				lsp_doc_border = true, -- add a border to hover docs and signature help
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
		'kdheepak/lazygit.nvim', -- lazygit integration
		cmd = {
			'LazyGit',
			'LazyGitConfig',
			'LazyGitCurrentFile',
			'LazyGitFilter',
			'LazyGitFilterCurrentFile',
		},
		-- optional for floating window border decoration
		dependencies = {
			'nvim-lua/plenary.nvim',
		},
		config = function()
			vim.g.lazygit_floating_window_winblend = 0   -- transparency of floating window. 0 to 100 range
			vim.g.lazygit_floating_window_scaling_factor = 0.9 -- scaling factor for floating window
		end
	},

	{
		'nvim-tree/nvim-tree.lua', -- sidebar tree view file explorer, for when Ranger pop-up isn't enough
		dependencies = { 'nvim-tree/nvim-web-devicons' },
		config = function()
			require('nvim-tree').setup()
		end
	},

	{
		'lukas-reineke/indent-blankline.nvim', -- indentation guides
		main = "ibl",
		opts = {
			indent = {
				char = '▏',
				tab_char = '▏',
			},
			exclude = {
				filetypes = {
					'dashboard',
					'lspinfo',
					'packer',
					'checkhealth',
					'help',
					'man',
					'NvimTree'
				}
			}
		}
	},

	{
		'mvllow/modes.nvim', -- change line background color to reflect current mode
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
		end
	},

	{
		'folke/todo-comments.nvim',
		dependencies = { 'nvim-lua/plenary.nvim' },
		config = function()
			require('todo-comments').setup({})
		end
	},

	'jeffkreeftmeijer/vim-numbertoggle', -- automatically switch numbers to absolute instead of relative when buffers are inactive

	{
		'norcalli/nvim-colorizer.lua', -- highlight color strings with the color they represent
		config = function()
			require('colorizer').setup({ '*' }, {
				RGB = true,
				RRGGBB = true,
				names = true,
				RRGGBBAA = true,
				rgb_fn = true,
				hsl_fn = true,
			})
		end
	},

	{
		'lewis6991/gitsigns.nvim', -- shows git added/removed lines to the left of the line numbers
		dependencies = {
			'nvim-lua/plenary.nvim'
		},
		config = function()
			require('gitsigns').setup()
		end
	},

	{
		'karb94/neoscroll.nvim', -- smooth scrolling
		config = function()
			require('neoscroll').setup({
				easing = 'quadratic'
			})
		end
	},

	{
		'folke/twilight.nvim', -- hide unfocused blocks while in zen mode
		opts = {
			dimming = {
				alpha = 0.35
			}
		}
	},

	{
		'folke/zen-mode.nvim', -- zen mode for deep focus on complex algos
		config = function()
			require('zen-mode').setup({
				window = {
					backdrop = 1, -- shade the backdrop of the Zen window. Set to 1 to keep the same as Normal
					-- height and width can be:
					-- * an absolute number of cells when > 1
					-- * a percentage of the width / height of the editor when <= 1
					-- * a function that returns the width or the height
					width = 120, -- width of the Zen window
					height = 1, -- height of the Zen window
					-- by default, no options are changed for the Zen window
					-- uncomment any of the options below, or add other vim.wo options you want to apply
					options = {
						signcolumn = "no", -- disable signcolumn
						number = false, -- disable number column
						relativenumber = false, -- disable relative numbers
						cursorline = false, -- disable cursorline
						cursorcolumn = false, -- disable cursor column
						foldcolumn = "0", -- disable fold column
					},
				},
				plugins = {
					-- disable some global vim options (vim.o...)
					options = {
						enabled = true,
						ruler = false,    -- disables the ruler text in the cmd line area
						showcmd = false,  -- disables the command in the last line of the screen
					},
					twilight = { enabled = true }, -- enable to start Twilight when zen mode opens
					gitsigns = { enabled = true }, -- disables git signs
				},
				-- callback where you can add custom code when the Zen window opens
				on_open = function()
					vim.cmd('Copilot disable') -- prevent focus loss by looking at AI autocompletions :)
				end,
				-- callback where you can add custom code when the Zen window closes
				on_close = function()
					vim.cmd('Copilot enable')
				end,
			})
		end
	},

	-- ************
	-- Commands, utils & tools
	-- ************

	{
		'ibhagwan/fzf-lua', -- fuzzy finder
		dependencies = { 'nvim-lua/plenary.nvim',
			'nvim-tree/nvim-web-devicons',
		},
		opts = {}
	},

	{
		'voldikss/vim-floaterm', -- terminal windows management
		config = function()
			vim.g.floaterm_autoclose = true
			vim.g.floaterm_opener = 'edit'
			vim.g.floaterm_rootmarkers = { '.project', '.git', '.hg', '.svn', '.root', '.gitignore' }
			vim.g.floaterm_width = 0.8
			vim.g.floaterm_shell = vim.o.shell
			vim.cmd([[
				function s:floatermSettings()
					" setlocal notermguicolors
				endfunction
				autocmd FileType floaterm call s:floatermSettings()
			]])
		end
	},

	{
		'folke/trouble.nvim', -- list lsp diagnostics
		dependencies = { 'nvim-tree/nvim-web-devicons' },
		opts = {
			mode = "document_diagnostics",
		},
		config = function()
			-- redefine the signs used by nvim's LSP to show diagnotics in the statuscolumn
			local signs = {
				Error = "",
				Warn = "",
				Hint = "",
				Info = "",
			}

			for type, icon in pairs(signs) do
				local hl = "DiagnosticSign" .. type
				vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = "" })
			end
		end
	},

	{
		'dnlhc/glance.nvim', -- glance at LSP definitions and references without opening a full-blown window
		cmd = 'Glance',
		config = function()
			require('glance').setup({
				border = {
					enable = true,
					top_char = '─',
					bottom_char = '─',
				},
			})
		end
	},

	{
		'utilyre/barbecue.nvim', -- show lsp symbols breadcrumbs in winbar
		version = "*",
		dependencies = {
			'SmiteshP/nvim-navic',
			'nvim-tree/nvim-web-devicons', -- optional dependency
		},
		opts = {
			theme = {
				normal = { bg = 'NONE' },
				dirname = { bg = 'NONE' },
				basename = { bg = 'NONE' },
				context = { bg = 'NONE' },
			}
		}
	},

	{
		'hedyhli/outline.nvim',
		lazy = true,
		cmd = { 'Outline', 'OutlineOpen' },
		opts = {},
	},

	'tpope/vim-surround', -- commands for working with {surrounding} marks

	{
		"folke/flash.nvim", -- quickly jump around in current buffer
		event = "VeryLazy",
		---@type Flash.Config
		opts = {},
		-- stylua: ignore
		keys = {
			-- Disabled, see shortcuts.vim for config
			{ "s",     mode = { "n", "x", "o" }, function() require("flash").jump() end,              desc = "Flash" },
			{ "S",     mode = { "n", "o" },      function() require("flash").treesitter() end,        desc = "Flash Treesitter" },
			{ "r",     mode = "o",               function() require("flash").remote() end,            desc = "Remote Flash" },
			{ "R",     mode = { "o", "x" },      function() require("flash").treesitter_search() end, desc = "Treesitter Search" },
			{ "<c-s>", mode = { "c" },           function() require("flash").toggle() end,            desc = "Toggle Flash Search" },
		},
	},

	{
		"sustech-data/wildfire.nvim", -- quickly expand selection based on treesitter nodes
		event = "VeryLazy",
		dependencies = { "nvim-treesitter/nvim-treesitter" },
		config = function()
			require("wildfire").setup()
		end,
	},

	{
		'Raimondi/delimitMate', -- automatic closing of surroundings in insert mode
		config = function()
			vim.g.delimitMate_expand_cr = 2
			vim.g.delimitMate_expand_space = true
			vim.g.delimitMate_matchpairs = "(:),[:],{:},<:>"
			vim.cmd([[au FileType html,xml let b:delimitMate_matchpairs = "(:),[:],{:}"]])
		end
	},

	{
		'ciaranm/detectindent', -- auto detect indent style and update settings accordingly
		config = function()
			vim.cmd([[au BufReadPost * :DetectIndent]])
		end
	},

	{
		'linrongbin16/gitlinker.nvim', -- copy link to code on GitHub
		cmd = 'GitLink',
		opts = {}
	},

	{
		'pwntester/octo.nvim',
		requires = {
			'nvim-lua/plenary.nvim',
			'ibhagwan/fzf-lua',
			'nvim-tree/nvim-web-devicons',
		},
		config = function()
			require('octo').setup({
				use_local_fs = true,
				picker = 'fzf-lua',
				default_merge_method = 'squash',
				default_delete_branch = true,
			})
			-- # and @ completion for github
			vim.keymap.set("i", "@", "@<C-x><C-o>", { silent = true, buffer = true })
			vim.keymap.set("i", "#", "#<C-x><C-o>", { silent = true, buffer = true })
		end
	},

	{
		'luukvbaal/statuscol.nvim', -- customize the status column to remove the fold depth count
		config = function()
			local builtin = require('statuscol.builtin')
			require('statuscol').setup(
				{
					relculright = true,
					segments = {
						{ text = { '%s' },             click = 'v:lua.ScSa' },
						{ text = { builtin.foldfunc }, click = 'v:lua.ScFa' },
						{
							text = { builtin.lnumfunc, ' ' },
							condition = { true, builtin.not_empty },
							click = 'v:lua.ScLa',
						}
					}
				}
			)
		end
	},

	{
		'MeanderingProgrammer/render-markdown.nvim', -- better markdown rendering
		opts = {},
		dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' },
	},

	{
		"m4xshen/hardtime.nvim", -- educate my dumb ape brain
		dependencies = { "MunifTanjim/nui.nvim", "nvim-lua/plenary.nvim" },
		opts = {
			disable_mouse = false,
			disabled_keys = {
				-- arrow keys used to move between windows
				["<Up>"] = {},
				["<Down>"] = {},
				["<Left>"] = {},
				["<Right>"] = {},
			},
			restricted_keys = {
				-- let me move around while thinking, ffs
				["h"] = {},
				["j"] = {},
				["k"] = {},
				["l"] = {},
			}
		}
	}
})
