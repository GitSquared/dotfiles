-- Install packer
local install_path = vim.fn.stdpath 'data' .. '/site/pack/packer/start/packer.nvim'

if vim.fn.empty(vim.fn.glob(install_path)) > 0 then
	vim.fn.execute('!git clone https://github.com/wbthomason/packer.nvim ' .. install_path)
end

-- Auto recompile config when file is changed
vim.cmd([[
	augroup packer_user_config
		autocmd!
		autocmd BufWritePost plugins.lua source <afile> | PackerCompile
	augroup end
]])

return require('packer').startup(function(use)
	-- ************
	-- SYSTEM / IDE
	-- ************
	use 'wbthomason/packer.nvim' -- plugins manager
	use 'tpope/vim-sensible' -- sensible default config

	use {
		'nvim-treesitter/nvim-treesitter', -- syntax highlighting and general language understanding facilities
		run = ':TSUpdate',
		config = function()
			require('nvim-treesitter.configs').setup({
				ensure_installed = {
					"vim",
					"lua",
					"rust",
					"regex",
					"typescript",
					"tsx",
					"javascript",
					"ruby",
					"scss",
					"yaml",
					"python",
					"toml",
					"latex",
					"html",
					"json",
					"jsdoc",
					"http",
					"graphql",
					"go",
					"fish",
					"dockerfile",
					"bash",
					"css",
					"c"
				},
				highlight = {
					enable = true,
				},
				indent = {
					enable = false, -- see this issue: https://github.com/nvim-treesitter/nvim-treesitter/issues/1136
				}
			})
		end
	}

	use({
		'yioneko/nvim-yati', -- cf. above issue, better treesitter-based indentation config while the native one gets patched up.
		requires = 'nvim-treesitter/nvim-treesitter',
		config = function()
			require('nvim-treesitter.configs').setup({
				yati = { enable = true },
			})
		end
	})

	use 'neovim/nvim-lspconfig' -- helper configs for neovim built-in LSP client

	use {
		'j-hui/fidget.nvim', -- print status updates of LSP servers
		config = function()
			require('fidget').setup()
		end
	}

	use 'L3MON4D3/LuaSnip' -- snippet plugin (leveraged by autocompletion engine)

	use {
		'hrsh7th/nvim-cmp', -- autocompletion engine
		config = function()
			local cmp = require('cmp')
			local luasnip = require('luasnip')

			cmp.setup({
				snippet = {
					expand = function(args)
						luasnip.lsp_expand(args.body) -- bind to snippet plugin
					end
				},
				sources = cmp.config.sources({
					{ name = 'nvim_lsp' },
					{ name = 'luasnip' }
				}, {
					{ name = 'buffer' }
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
							return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
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
				}
			})
		end
	}
	-- autocompletion engine completion sources:
	use 'saadparwaiz1/cmp_luasnip' -- saved snippets
	use 'hrsh7th/cmp-nvim-lsp' -- LSP clients
	use 'hrsh7th/cmp-buffer' -- buffer words
	use 'hrsh7th/cmp-path' -- paths on local file system

	use {
		'williamboman/mason.nvim', -- manager for external libs like LSP clients, language syntaxes, etc
		config = function()
			require('mason').setup()
		end
	}

	use {
		'junnplus/nvim-lsp-setup', -- manage lsp installation and config in one place
		requires = {
			'neovim/nvim-lspconfig',
			'williamboman/mason.nvim',
			'williamboman/mason-lspconfig.nvim',
		},
		config = function()
			require('nvim-lsp-setup').setup({
				installer = {
					automatic_installation = false,
					ui = {
						icons = {
							server_installed = '✓',
							server_pending = '➜',
							server_uninstalled = '✗'
						}
					}
				},
				default_mappings = false, -- cf ../shortcuts.vim
				on_attach = function()
					-- disable auto format on save
				end,
				servers = {
					bashls = {},
					cssls = {},
					eslint = {},
					html = {},
					jsonls = {},
					tsserver = {
						autostart = true,
					},
					denols = {},
					vimls = {},
					yamlls = {},
					pylsp = {
						settings = {
							pylsp = {
								plugins = {
									pycodestyle = { enabled = false },
									black = {
										enabled = true,
										cache_config = true,
									},
									flake8 = {
										enabled = true,
									},
									mypy = {
										enabled = true,
										live_mode = true,
										dmypy = true,
									},
									isort = {
										enabled = true,
									},
								}
							}
						},
					},
					sumneko_lua = {
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
			})
		end
	}

	use {
		'gelguy/wilder.nvim', -- command menu autocompletion
		requires = { 'romgrk/fzy-lua-native', 'kyazdani42/nvim-web-devicons' },
		config = function()
			local wilder = require('wilder')
			wilder.setup({ modes = { ':', '/', '?' } })
			-- Disable Python remote plugin
			wilder.set_option('use_python_remote_plugin', 0)

			wilder.set_option('pipeline', {
				wilder.branch(
					wilder.cmdline_pipeline({
						fuzzy = 1,
						fuzzy_filter = wilder.lua_fzy_filter(),
					}),
					wilder.vim_search_pipeline()
				)
			})

			wilder.set_option('renderer', wilder.popupmenu_renderer(
				wilder.popupmenu_palette_theme({
					border = 'rounded',
					max_height = '30%',
					min_height = 0,
					prompt_position = 'top',
					reverse = 0,
					highlighter = wilder.lua_fzy_highlighter(),
					left = {
						' ',
						wilder.popupmenu_devicons()
					},
					right = {
						' ',
						wilder.popupmenu_scrollbar()
					},
				})
			))
		end,
	}

	use {
		'github/copilot.vim', -- codex-based autocompletion neural network frontend
		config = function()
			vim.g.copilot_no_tab_map = true
		end
	}

	-- ************
	-- UI
	-- ************
	use({
		'catppuccin/nvim', -- theme/colorscheme
		as = 'catppuccin',
		config = function()
			vim.opt.termguicolors = true
			vim.g.catppuccin_flavour = "mocha"
			require('catppuccin').setup({
				transparent_background = false,
				term_colors = false,
				styles = {
					comments = { 'italic' },
					functions = { 'bold' },
					keywords = { 'italic' },
					strings = {},
					variables = {},
				},
				integrations = {
					cmp = true,
					barbar = true,
					gitsigns = true,
					lsp_trouble = true,
					markdown = true,
					symbols_outline = true,
					telescope = true,
					treesitter = true,
					indent_blankline = {
						enabled = true,
						colored_indent_levels = false,
					},
					native_lsp = {
						enabled = true,
						underlines = {
							errors = { 'underline' },
							warnings = { 'undercurl' },
							hints = { 'underdash' },
							information = { 'underdot' },
						}
					},
					nvimtree = {
						enabled = true,
					}
				}
			})
			vim.cmd [[colorscheme catppuccin]]
		end
	})

	use {
		'romgrk/barbar.nvim', -- buffers management (="tab bar")
		requires = { 'kyazdani42/nvim-web-devicons' },
		config = function()
			require('bufferline').setup({
				closable = false,
			})
		end
	}

	use {
		'nvim-lualine/lualine.nvim', -- fancy status line with mode indicator and cursor position
		requires = { 'kyazdani42/nvim-web-devicons' },
		config = function()
			require('lualine').setup({
				options = {
					icons_enabled = true,
					theme = 'catppuccin',
					section_separators = { left = '', right = '' },
					component_separators = { left = '╱', right = '╱' }
				},
				sections = {
					lualine_a = { 'mode' },
					lualine_b = { { 'os.date("%H:%M", os.time())', icon = ' ', separator = '' }, function() return ' ' end, 'diff' },
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
					lualine_x = { 'diagnostics' },
					lualine_y = { 'filetype' },
					lualine_z = { 'location' },
				}
			})
		end
	}

	use({
		'kyazdani42/nvim-tree.lua', -- sidebar tree view file explorer, for when Ranger pop-up isn't enough
		requires = { 'kyazdani42/nvim-web-devicons' },
		config = function()
			require('nvim-tree').setup()
		end
	})

	use({
		'nvim-treesitter/nvim-treesitter-context', -- show nest/indent context at top of file, leveraging treesitter
		config = function()
			require('treesitter-context').setup({
				enable = false, -- disable by default, toggle with shortcut
			})
		end
	})

	use({
		'lukas-reineke/indent-blankline.nvim', -- indentation guides
		config = function()
			require('indent_blankline').setup({
				use_treesitter = true,
				show_current_context = true,
				show_current_context_start = false,
				show_trailing_blankline_indent = false,
				space_char_blankline = ' ',
			})
		end
	})

	use({
		'mvllow/modes.nvim', -- change line background color to reflect current mode
		config = function()
			require('modes').setup()
		end
	})

	use {
		'folke/todo-comments.nvim',
		requires = 'nvim-lua/plenary.nvim',
		config = function()
			require('todo-comments').setup({})
		end
	}

	use 'jeffkreeftmeijer/vim-numbertoggle' -- automatically switch numbers to absolute instead of relative when buffers are inactive

	use {
		'norcalli/nvim-colorizer.lua', -- highlight color strings with the color they represent
		config = function()
			require('colorizer').setup({ '*' }, {
				RGB = false;
				RRGGBB = true;
				names = true;
				RRGGBBAA = true;
				rgb_fn = true;
				hsl_fn = true;
			})
		end
	}

	use {
		'lewis6991/gitsigns.nvim', -- shows git added/removed lines to the left of the line numbers
		requires = {
			'nvim-lua/plenary.nvim'
		},
		config = function()
			require('gitsigns').setup({
				yadm = {
					enable = true
				}
			})
		end
	}

	use {
		'karb94/neoscroll.nvim', -- smooth scrolling
		config = function()
			require('neoscroll').setup()
		end
	}

	use 'folke/twilight.nvim' -- hide unfocused blocks while in zen mode

	use {
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
						ruler = false, -- disables the ruler text in the cmd line area
						showcmd = false, -- disables the command in the last line of the screen
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
	}

	-- ************
	-- Commands, utils & tools
	-- ************
	use { 'nvim-telescope/telescope-fzf-native.nvim', run = 'make' } -- native fzf sorter for Telescope, faster

	use {
		'nvim-telescope/telescope.nvim', -- fuzzy finder
		requires = { { 'nvim-lua/plenary.nvim' } },
		config = function()
			require('telescope').setup()
			require('telescope').load_extension('fzf')
		end
	}

	use {
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
					:IndentBlanklineDisable
				endfunction
				autocmd FileType floaterm call s:floatermSettings()
			]])
		end
	}

	use {
		'thaerkh/vim-workspace', -- leverage vim sessions to save opened buffers and undo history
		config = function()
			vim.g.workspace_create_new_tabs = false
			vim.g.workspace_session_directory = vim.env.HOME .. '/.nvim/sessions/'
			vim.g.workspace_undodir = vim.env.HOME .. '/.nvim/undohistory/'
			vim.g.workspace_autosave = false
		end
	}

	use {
		'folke/trouble.nvim', -- list lsp diagnostics
		requires = 'kyazdani42/nvim-web-devicons',
		config = function()
			require('trouble').setup({
				mode = "document_diagnostics"
			})
		end
	}

	use 'simrat39/symbols-outline.nvim' -- symbols sidebar

	use {
		'terryma/vim-multiple-cursors', -- multi-cursor support
		config = function()
			-- prevent delimitMate conflict
			vim.cmd [[
				function! Multiple_cursors_before()
					if exists(':DelimitMateOff')==2
						exe 'DelimitMateOff'
					endif
				endfunction

				function! Multiple_cursors_after()
					if exists(':DelimitMateOn')==2
						exe 'DelimitMateOn'
					endif
				endfunction
			]]
		end
	}

	use 'tpope/vim-surround' -- commands for working with {surrounding} marks

	use {
		'preservim/nerdcommenter', -- commands for toggling comments
		config = function()
			vim.g.NERDSpaceDelims = true
			vim.g.NERDCommentEmptyLines = true
			vim.g.NERDCompactSexyComs = false
			vim.g.NERDDefaultAlign = 'left'
			vim.g.NERDToggleCheckAllLines = true
		end
	}

	use 'easymotion/vim-easymotion' -- quickly jump around in current buffer

	use {
		'Raimondi/delimitMate', -- automatic closing of surroundings in insert mode
		config = function()
			vim.g.delimitMate_expand_cr = 2
			vim.g.delimitMate_expand_space = true
			vim.g.delimitMate_matchpairs = "(:),[:],{:},<:>"
			vim.cmd([[au FileType html,xml let b:delimitMate_matchpairs = "(:),[:],{:}"]])
		end
	}

	use {
		'ciaranm/detectindent', -- auto detect indent style and update settings accordingly
		config = function()
			vim.cmd([[au BufReadPost * :DetectIndent]])
		end
	}

	use 'alvan/vim-closetag' -- autoclose html/jsx tags

	use {
		'ruifm/gitlinker.nvim', -- copy link to code on GitHub
		requires = 'nvim-lua/plenary.nvim',
		config = function()
			require("gitlinker").setup()
			vim.api.nvim_set_keymap('n', '<leader>gY', '<cmd>lua require"gitlinker".get_repo_url()<cr>', { silent = true })
			vim.api.nvim_set_keymap('n', '<leader>gB',
				'<cmd>lua require"gitlinker".get_repo_url({action_callback = require"gitlinker.actions".open_in_browser})<cr>',
				{ silent = true })
		end
	}
end)
