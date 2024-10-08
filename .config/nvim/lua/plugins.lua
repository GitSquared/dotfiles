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
		},
		config = function()
			require('lsp-setup').setup({
				default_mappings = false, -- cf ../shortcuts.vim
				servers = {
					bashls = {},
					cssls = {},
					biome = {},
					eslint = {},
					html = {},
					jsonls = {},
					vtsls = { -- faster drop-in replacement for tsserver
						on_attach = function(client)
							-- Don't use tsserver for formatting, use eslint or biome instead
							client.server_capabilities.documentFormattingProvider = false
						end,
					},
					tailwindcss = {},
					prismals = {},
					vimls = {},
					yamlls = {},
					terraformls = {},
					pylsp = {
						autostart = true,
						settings = {
							pylsp = {
								plugins = {
									pycodestyle = { enabled = false },
									black = {
										enabled = false,
										cache_config = true,
									},
									pylsp_mypy = {
										enabled = false,
										live_mode = true,
										dmypy = true,
										report_progress = true,
									},
									isort = {
										enabled = false,
									},
									ruff = {
										enabled = true,
									},
									jedi_completion = { fuzzy = true },
									-- to install plugins:
									-- :PylspInstall pylsp-mypy
									-- :PylspInstall pyls-isort
									-- :PylspInstall python-lsp-black
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
				flags = {
					debounce_text_changes = 200,
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

					-- Format on save
					if client.supports_method('textDocument/format') then
						vim.cmd [[
							augroup format_on_save
								au!
								autocmd BufWritePre <buffer> lua vim.lsp.buf.format()
							augroup END
						]]
					end
				end
			})
		end
	},

	'HiPhish/jinja.vim',  -- Jinja template syntax support

	'onsails/lspkind-nvim', -- icons in autocompletion window

	{
		'hrsh7th/nvim-cmp', -- autocompletion engine
		dependencies = {
			-- autocompletion engine completion sources:
			'hrsh7th/cmp-nvim-lsp', -- LSP clients
			'hrsh7th/cmp-path', -- paths on local file system
			'hrsh7th/cmp-cmdline', -- command line completion
		},
		config = function()
			local cmp = require('cmp')
			local lspkind = require('lspkind')

			cmp.setup({
				sources = cmp.config.sources({
					{ name = 'nvim_lsp' },
					{ name = 'otter' }
				}),
				mapping = {
					-- key mappings for autocompletion window
					['<C-Space>'] = cmp.mapping(cmp.mapping.complete(), { 'i', 'c' }),
					['<S-Esc>'] = cmp.mapping({
						i = cmp.mapping.abort(),
						c = cmp.mapping.close(),
					}),
					['<CR>'] = cmp.mapping.confirm({ select = false }),
					["<Tab>"] = cmp.mapping(function(fallback)
						local has_words_before = function()
							local line, col = unpack(vim.api.nvim_win_get_cursor(0))
							return col ~= 0 and
								 vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
						end
						if cmp.visible() then
							cmp.select_next_item()
						elseif has_words_before() then
							cmp.complete()
						else
							fallback()
						end
					end, { "i", "s" }),
					["<S-Tab>"] = cmp.mapping(function(fallback)
						if cmp.visible() then
							cmp.select_prev_item()
						else
							fallback()
						end
					end, { "i", "s" }),
					-- mapping to scroll docs
					['<C-j>'] = cmp.mapping(cmp.mapping.scroll_docs(4), { 'i', 'c' }),
					['<C-k>'] = cmp.mapping(cmp.mapping.scroll_docs(-4), { 'i', 'c' })
				},
				formatting = {
					format = lspkind.cmp_format({
						mode = 'symbol_text',
						maxwidth = 50,
						ellipsis_char = '…',
					})
				},
			})

			-- Use buffer source for `/` and `?` (if you enabled `native_menu`, this won't work anymore).
			cmp.setup.cmdline({ '/', '?' }, {
				mapping = cmp.mapping.preset.cmdline(),
				sources = {
					{ name = 'buffer' }
				}
			})

			-- Use cmdline & path source for ':' (if you enabled `native_menu`, this won't work anymore).
			cmp.setup.cmdline(':', {
				mapping = cmp.mapping.preset.cmdline(),
				sources = cmp.config.sources({
					{ name = 'path' }
				}, {
					{ name = 'cmdline' }
				}),
				matching = { disallow_symbol_nonprefix_matching = false },
				formatting = {
					format = lspkind.cmp_format({ mode = 'symbol' })
				},
			})
		end
	},

	{
		'github/copilot.vim', -- codex-based autocompletion neural network frontend
		config = function()
			vim.g.copilot_no_tab_map = true
		end
	},

	{
		'benlubas/molten-nvim', -- jupyter notebook support
		build = ":UpdateRemotePlugins",
		dependencies = {
			{
				'GCBallesteros/jupytext.nvim', -- to automatically convert .ipynb notebook files to markdown/python that nvim can work with
				-- to install jupytext dependency: pipx install jupytext
				config = function()
					require('jupytext').setup({
						-- force jupytext to convert notebooks to Quarto format, see below
						custom_language_formatting = {
							python = {
								extension = 'qmd',
								style = 'quarto',
								force_ft = 'quarto'
							}
						}
					})
				end
			},
			{
				'quarto-dev/quarto-nvim', -- to render Quarto files, and handle LSP in cells and utilities to run cells with Molten
				dependencies = { 'jmbuhr/otter.nvim', 'nvim-treesitter/nvim-treesitter' },
				config = function()
					require('quarto').setup({
						lspFeatures = {
							languages = { "python", "rust" },
							chunks = "all",
							diagnostics = {
								enabled = true,
								triggers = { "BufWritePost" },
							},
							completion = {
								enabled = true,
							},
						},
						codeRunner = {
							enabled = true,
							default_method = "molten",
						},
					})
				end
			}
		},
		init = function()
			-- Reuse the python venv from jupyterlab
			vim.g.python3_host_prog = vim.fn.expand("~/Library/jupyterlab-desktop/jlab_server/bin/python3")
			-- To setup the venv:
			-- - open a bash shell in ~/Library/jupyterlab-desktop/jlab_server
			-- - run `source ./bin/activate`
			-- - install dependencies with pip: `pip install pynvim jupyter_client pyperclip plotly cairosvg kaleido pnglatex`
			vim.api.nvim_create_autocmd("FileType", {
				pattern = "quarto",
				callback = function(args)
					local bufnr = args.buf
					vim.cmd [[ MoltenInit ]]
					vim.cmd [[ QuartoActivate ]]

					vim.api.nvim_buf_set_keymap(bufnr, 'n', '<C-CR>', ':QuartoSend<CR>',
						{ noremap = true, silent = true })
					vim.api.nvim_buf_set_keymap(bufnr, 'n', '<S-CR>', ':noautocmd MoltenEnterOutput<CR>',
						{ noremap = true, silent = true })
				end
			})
			-- Provide a command to create a blank new Python notebook
			local default_notebook = [[
				{
				  "cells": [
					 {
						"cell_type": "markdown",
						"metadata": {},
						"source": [
						  ""
						]
					 }
				  ],
				  "metadata": {
					 "kernelspec": {
						"display_name": "Python 3",
						"language": "python",
						"name": "python3"
					 },
					 "language_info": {
						"codemirror_mode": {
						  "name": "ipython"
						},
						"file_extension": ".py",
						"mimetype": "text/x-python",
						"name": "python",
						"nbconvert_exporter": "python",
						"pygments_lexer": "ipython3"
					 }
				  },
				  "nbformat": 4,
				  "nbformat_minor": 5
				}
			]]

			local function new_notebook(filename)
				local path = filename .. ".ipynb"
				local file = io.open(path, "w")
				if file then
					file:write(default_notebook)
					file:close()
					vim.cmd("edit " .. path)
				else
					print("Error: Could not open new notebook file for writing.")
				end
			end

			vim.api.nvim_create_user_command('NewNotebook', function(opts)
				new_notebook(opts.args)
			end, {
				nargs = 1,
				complete = 'file'
			})
		end,
	},

	-- ************
	-- UI
	-- ************
	{
		'ayu-theme/ayu-vim', -- theme/colorscheme
		name = 'ayu',
		config = function()
			vim.g.ayucolor = 'dark'
			vim.cmd([[colorscheme ayu]])
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
						'                                       ',
						'        .n.                     |      ',
						'       /___\\          _.---.  \\ _ /    ',
						'       [|||]         (_._ ) )--;_) =-  ',
						'       [___]           \'---\'.__,\' \\    ',
						'       }-=-{                    |      ',
						'       |-" |                           ',
						'       |.-"|                p          ',
						'~^=~^~-|_.-|~^-~^~ ~^~ -^~^~|\\ ~^-~^~- ',
						'^   .=.| _.|__  ^       ~  /| \\        ',
						' ~ /:. \\" _|_/\\    ~      /_|__\\  ^    ',
						'.-/::.  |   |""|-._    ^   ~~~~        ',
						'  `===-\'-----\'""`  \'-.             ~   ',
						'                 __.-\'      ^          ',
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
		config = function()
			require('bufferline').setup({
				icons = {
					inactive = { button = '' },
					current = { button = '' },
					visible = { button = '' },
				}
			})
		end
	},

	{
		'nvim-lualine/lualine.nvim', -- fancy status line with mode indicator and cursor position
		dependencies = { 'nvim-tree/nvim-web-devicons' },
		config = function()
			require('lualine').setup({
				options = {
					theme = 'ayu',
					icons_enabled = true,
					section_separators = { left = '', right = '' },
					component_separators = { left = '╱', right = '╱' }
				},
				sections = {
					lualine_a = { 'mode' },
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
					}, 'diagnostics' },
					lualine_y = { 'filetype' },
					lualine_z = { 'location' },
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
				backend = { 'fzf', 'telescope', 'builtin' } -- prefer fuzzy finder for select
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
					["cmp.entry.get_documentation"] = true, -- requires hrsh7th/nvim-cmp
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
			vim.g.lazygit_floating_window_winblend = 15  -- transparency of floating window. 0 to 100 range
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
		'nvim-treesitter/nvim-treesitter-context', -- show nest/indent context at top of file, leveraging treesitter
		config = function()
			require('treesitter-context').setup({
				enable = false, -- disable by default, toggle with shortcut
			})
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
					visual = '#FFEE99',
					insert = '#B8CC51',
				},
				set_cursor = true,
				set_cursorline = true,
				set_number = false,
				line_opacity = 0.5,
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

	'folke/twilight.nvim', -- hide unfocused blocks while in zen mode

	{
		'folke/zen-mode.nvim', -- zen mode for deep focus on complex algos
		config = function()
			require('zen-mode').setup({
				window = {
					backdrop = 0.95, -- shade the backdrop of the Zen window. Set to 1 to keep the same as Normal
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
						-- number = false, -- disable number column
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
					-- this will change the font size on kitty when in zen mode
					-- to make this work, you need to set the following kitty options:
					-- - allow_remote_control socket-only
					-- - listen_on unix:/tmp/kitty
					kitty = {
						enabled = true,
						font = "+2", -- font size increment
					},
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
		'nvim-telescope/telescope.nvim', -- fuzzy finder
		dependencies = { 'nvim-lua/plenary.nvim',
			{
				'nvim-telescope/telescope-fzf-native.nvim', -- native fzf sorter for Telescope, faster
				build = 'make'
			},
			'danielfalk/smart-open.nvim', -- better fuzzy file finder for telescope
			'kkharji/sqlite.lua',   -- required by smart-open
		},
		config = function()
			require('telescope').setup({
				extensions = {
					smart_open = {
						match_algorithm = "fzf",
					}
				}
			})
			require('telescope').load_extension('fzf')
			require("telescope").load_extension("smart_open")
		end
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
		'utilyre/barbecue.nvim', -- show lsp symbols breadcrumbs in winbar
		version = "*",
		dependencies = {
			'SmiteshP/nvim-navic',
			'nvim-tree/nvim-web-devicons', -- optional dependency
		},
		opts = {
			theme = 'ayu'
		}
	},

	{
		'hedyhli/outline.nvim',
		lazy = true,
		cmd = { 'Outline', 'OutlineOpen' },
		opts = {
		},
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
			-- { "s",     mode = { "n", "x", "o" }, function() require("flash").jump() end,              desc = "Flash" },
			-- { "S",     mode = { "n", "x", "o" }, function() require("flash").treesitter() end,        desc = "Flash Treesitter" },
			{ "r",     mode = "o",          function() require("flash").remote() end,            desc = "Remote Flash" },
			{ "R",     mode = { "o", "x" }, function() require("flash").treesitter_search() end, desc = "Treesitter Search" },
			{ "<c-s>", mode = { "c" },      function() require("flash").toggle() end,            desc = "Toggle Flash Search" },
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
	},

	'sophacles/vim-processing', -- make art not war
})
