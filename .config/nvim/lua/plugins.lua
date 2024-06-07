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
					"bash",
					"css",
					"c"
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
			local venv_path = os.getenv('VIRTUAL_ENV')
			local py_path = nil
			-- decide which python executable to use for mypy
			if venv_path ~= nil then
				py_path = venv_path .. "/bin/python3"
			else
				py_path = vim.g.python3_host_prog
			end
			require('lsp-setup').setup({
				default_mappings = false, -- cf ../shortcuts.vim
				servers = {
					bashls = {},
					cssls = {},
					biome = {
						autostart = true
					},
					-- eslint = { using eslint_d through none-ls instead
					html = {},
					jsonls = {},
					tsserver = {
						autostart = true,
					},
					tailwindcss = {},
					prismals = {},
					vimls = {},
					yamlls = {},
					pylsp = {
						autostart = true,
						settings = {
							pylsp = {
								plugins = {
									pycodestyle = { enabled = false },
									black = {
										enabled = true,
										cache_config = true,
									},
									pylsp_mypy = {
										enabled = true,
										live_mode = true,
										dmypy = true,
										report_progress = true,
										overrides = { "--python-executable", py_path, true },
									},
									isort = {
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
					}
				},
				flags = {
					debounce_text_changes = 200,
				},
				on_attach = function(client, bufnr)
					-- Highlight the current variable and its usages in the buffer.
					if client.server_capabilities.documentHighlightProvider then
						vim.cmd([[
							hi! link LspReferenceRead Visual
							hi! link LspReferenceText Visual
							hi! link LspReferenceWrite Visual
						]])

						local gid = vim.api.nvim_create_augroup("lsp_document_highlight", { clear = true })
						vim.api.nvim_create_autocmd("CursorHold", {
							group = gid,
							buffer = bufnr,
							callback = function()
								vim.lsp.buf.document_highlight()
							end
						})

						vim.api.nvim_create_autocmd("CursorMoved", {
							group = gid,
							buffer = bufnr,
							callback = function()
								vim.lsp.buf.clear_references()
							end
						})
					end
				end,
				capabilities = require('cmp_nvim_lsp').default_capabilities()
			})
		end
	},

	{
		'nvimtools/none-ls.nvim', -- inject some non-LSP diags through builtin LSP
		dependencies = {
			'nvim-lua/plenary.nvim',
			'nvimtools/none-ls-extras.nvim',
		},
		config = function()
			local null_ls = require('null-ls')

			null_ls.setup({
				sources = {
					null_ls.builtins.code_actions.gitsigns,
					null_ls.builtins.diagnostics.todo_comments,
				}
			})

			-- Function to check if an ESLint configuration file exists
			local function eslint_config_exists()
				local configs = { ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.yaml", ".eslintrc.yml" }
				local current_dir = vim.fn.expand("%:p:h") -- Get the directory of the current buffer

				while current_dir do
					for _, config in ipairs(configs) do
						if vim.fn.glob(current_dir .. "/" .. config) ~= "" then
							return true
						end
					end
					-- Move to the parent directory
					local parent_dir = current_dir:match("(.*/)[^/]+/?$")
					if parent_dir == current_dir then
						break
					end
					current_dir = parent_dir
				end

				return false
			end

			-- Bind null-ls eslint_d sources on buffers with an ESLint config nearby
			vim.api.nvim_create_autocmd("BufEnter", {
				callback = function()
					if eslint_config_exists() then
						null_ls.register(require('none-ls.code_actions.eslint_d'))
						null_ls.register(require('none-ls.diagnostics.eslint_d'))
						null_ls.register(require('none-ls.formatting.eslint_d'))
					else
						null_ls.deregister(require('none-ls.code_actions.eslint_d'))
						null_ls.deregister(require('none-ls.diagnostics.eslint_d'))
						null_ls.deregister(require('none-ls.formatting.eslint_d'))
					end
				end,
			})
		end
	},

	'onsails/lspkind-nvim', -- icons in autocompletion window

	{
		'hrsh7th/nvim-cmp',  -- autocompletion engine
		dependencies = {
			'L3MON4D3/LuaSnip', -- to store snippets
			-- autocompletion engine completion sources:
			'hrsh7th/cmp-nvim-lsp', -- LSP clients
			'hrsh7th/cmp-path', -- paths on local file system
			'hrsh7th/cmp-cmdline', -- command line completion
		},
		config = function()
			local cmp = require('cmp')
			local luasnip = require('luasnip')
			local lspkind = require('lspkind')

			cmp.setup({
				snippet = {
					expand = function(args)
						luasnip.lsp_expand(args.body) -- bind to snippet plugin
					end
				},
				sources = cmp.config.sources({
					{ name = 'luasnip' },
					{ name = 'nvim_lsp' },
				}),
				mapping = {
					-- key mappings for autocompletion window
					['<C-Space>'] = cmp.mapping(cmp.mapping.complete(), { 'i', 'c' }),
					['<S-Esc>'] = cmp.mapping({
						i = cmp.mapping.abort(),
						c = cmp.mapping.close(),
					}),
					['<CR>'] = cmp.mapping.confirm({ select = false }),
					-- use tab and shift-tab to browse completion list displayed by luasnip
					["<Tab>"] = cmp.mapping(function(fallback)
						local has_words_before = function()
							local line, col = unpack(vim.api.nvim_win_get_cursor(0))
							return col ~= 0 and
								 vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
						end
						if cmp.visible() then
							cmp.select_next_item()
						elseif luasnip.expand_or_jumpable() then
							luasnip.expand_or_jump()
						elseif has_words_before() then
							cmp.complete()
						else
							fallback()
						end
					end, { "i", "s" }),
					["<S-Tab>"] = cmp.mapping(function(fallback)
						if cmp.visible() then
							cmp.select_prev_item()
						elseif luasnip.jumpable(-1) then
							luasnip.jump(-1)
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

	-- ************
	-- UI
	-- ************
	{
		'nyoom-engineering/oxocarbon.nvim', -- theme/colorscheme
		name = 'oxocarbon',
		config = function()
			vim.cmd([[colorscheme oxocarbon]])
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
					theme = 'oxocarbon',
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
						color = { fg = "#ff9e64" },
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
					visual = '#be95ff',
					insert = '#ff7eb6',
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
			require('gitsigns').setup({
				yadm = {
					enable = true
				}
			})
		end
	},

	{
		'karb94/neoscroll.nvim', -- smooth scrolling
		config = function()
			require('neoscroll').setup()
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
			theme = 'catppuccin'
		}
	},

	{
		'SmiteshP/nvim-navbuddy', -- navigate LSP symbols in a ranger-like view
		dependencies = {
			'neovim/nvim-lspconfig',
			'SmiteshP/nvim-navic',
			'MunifTanjim/nui.nvim',
			'numToStr/Comment.nvim',  -- Optional
			'nvim-telescope/telescope.nvim' -- Optional
		},
		config = function()
			require('nvim-navbuddy').setup({
				lsp = {
					auto_attach = true
				}
			})
		end
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
		'ruifm/gitlinker.nvim', -- copy link to code on GitHub
		dependencies = { 'nvim-lua/plenary.nvim' },
		config = function()
			require("gitlinker").setup()
			vim.api.nvim_set_keymap('n', '<leader>gY', '<cmd>lua require"gitlinker".get_repo_url()<cr>', { silent = true })
			vim.api.nvim_set_keymap('n', '<leader>gB',
				'<cmd>lua require"gitlinker".get_repo_url({action_callback = require"gitlinker.actions".open_in_browser})<cr>',
				{ silent = true })
		end
	},

	{
		'kevinhwang91/nvim-ufo', -- modern folding mechanisms
		dependencies = { 'kevinhwang91/promise-async', 'nvim-treesitter/nvim-treesitter' },
		config = function()
			vim.o.foldcolumn = '1'
			vim.o.foldlevel = 99
			vim.o.foldlevelstart = 99
			vim.o.foldenable = true
			vim.o.fillchars = [[eob: ,fold: ,foldopen:,foldsep: ,foldclose:]]

			-- Using ufo provider need remap `zR` and `zM`. If Neovim is 0.6.1, remap yourself
			vim.keymap.set('n', 'zR', require('ufo').openAllFolds)
			vim.keymap.set('n', 'zM', require('ufo').closeAllFolds)

			-- display count of folded lines in virtual text
			local handler = function(virtText, lnum, endLnum, width, truncate)
				local newVirtText = {}
				local suffix = (' 󰁂 %d lines folded '):format(endLnum - lnum)
				local sufWidth = vim.fn.strdisplaywidth(suffix)
				local targetWidth = width - sufWidth
				local curWidth = 0
				for _, chunk in ipairs(virtText) do
					local chunkText = chunk[1]
					local chunkWidth = vim.fn.strdisplaywidth(chunkText)
					if targetWidth > curWidth + chunkWidth then
						table.insert(newVirtText, chunk)
					else
						chunkText = truncate(chunkText, targetWidth - curWidth)
						local hlGroup = chunk[2]
						table.insert(newVirtText, { chunkText, hlGroup })
						chunkWidth = vim.fn.strdisplaywidth(chunkText)
						-- str width returned from truncate() may less than 2nd argument, need padding
						if curWidth + chunkWidth < targetWidth then
							suffix = suffix .. (' '):rep(targetWidth - curWidth - chunkWidth)
						end
						break
					end
					curWidth = curWidth + chunkWidth
				end
				table.insert(newVirtText, { suffix, 'MoreMsg' })
				return newVirtText
			end

			-- Only depend on `nvim-treesitter/queries/filetype/folds.scm`,
			-- performance and stability are better than `foldmethod=nvim_treesitter#foldexpr()`
			require('ufo').setup({
				provider_selector = function(bufnr, filetype, buftype)
					return { 'treesitter', 'indent' }
				end,
				fold_virt_text_handler = handler
			})
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
