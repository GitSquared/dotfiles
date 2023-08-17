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
	use 'tpope/vim-sensible'   -- sensible default config

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
		tag = 'legacy',
		config = function()
			require('fidget').setup()
		end
	}

	use 'L3MON4D3/LuaSnip'   -- snippet plugin (leveraged by autocompletion engine)

	use 'onsails/lspkind-nvim' -- icons in autocompletion window

	use {
		'hrsh7th/nvim-cmp', -- autocompletion engine
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
		end
	}
	-- autocompletion engine completion sources:
	use 'saadparwaiz1/cmp_luasnip' -- saved snippets
	use 'hrsh7th/cmp-nvim-lsp'   -- LSP clients
	use 'hrsh7th/cmp-buffer'     -- buffer words
	use 'hrsh7th/cmp-path'       -- paths on local file system

	use {
		'jose-elias-alvarez/null-ls.nvim',
		requires = 'nvim-lua/plenary.nvim',
		config = function()
			require("null-ls").setup({
				sources = {
					require("null-ls").builtins.code_actions.eslint,
					require("null-ls").builtins.code_actions.gitsigns,
					require("null-ls").builtins.diagnostics.eslint,
					require("null-ls").builtins.diagnostics.fish,
					require("null-ls").builtins.diagnostics.mypy,  -- disabled because too slow
					-- require("null-ls").builtins.diagnostics.mypy.with({ -- use dmypy instead
					--    command = 'poetry',
					--    args = function(params)
					--       local t1 = {
					--          'run',
					--          '--',
					--          'dmypy',
					--          'run',
					--          '--timeout',
					--          '500000',
					--          '--',
					--          '--hide-error-context',
					--          '--no-color-output',
					--          '--show-absolute-path',
					--          '--show-column-numbers',
					--          '--show-error-codes',
					--          '--no-error-summary',
					--          '--no-pretty',
					--          '--cache-fine-grained',
					--          '--sqlite-cache',
					--          '--shadow-file',
					--          params.bufname,
					--          params.temp_path,
					--          params.bufname,
					--       }
					--       -- local t2 = vim.lsp.buf.list_workspace_folders()
					--       -- for _, v in ipairs(t2) do
					--       --    table.insert(t1, v)
					--       -- end
					--       return t1
					--    end,
					--    timeout = 500000,
					--    -- Do not run when inside of a .venv area
					--    runtime_condition = function(params)
					--       return true
					--       -- if string.find(params.bufname, '.venv') then
					--       --    return false
					--       -- else
					--       --    return true
					--       -- end
					--    end,
					-- }),
					require("null-ls").builtins.diagnostics.flake8,
					require("null-ls").builtins.diagnostics.proselint,
					require("null-ls").builtins.diagnostics.tsc,
					require("null-ls").builtins.formatting.autopep8,
					require("null-ls").builtins.formatting.black,
					require("null-ls").builtins.formatting.eslint,
					require("null-ls").builtins.formatting.isort,
				},
			})
		end
	}

	use {
		'williamboman/mason.nvim', -- manager for external libs like LSP clients, language syntaxes, etc
		config = function()
			require('mason').setup()
		end
	}

	use {
		'junnplus/lsp-setup.nvim', -- manage lsp installation and config in one place
		requires = {
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
					eslint = {},
					html = {},
					jsonls = {},
					tsserver = {
						autostart = true,
					},
					vimls = {},
					yamlls = {},
					pylsp = {
						autostart = true,
						settings = {
							pylsp = {
								plugins = {
									pycodestyle = { enabled = false },
									autopep8 = { enabled = false },
									yapf = { enabled = false },
									black = {
										enabled = true,
										cache_config = true,
									},
									pylsp_mypy = {
										enabled = false, -- ran through null-ls instead
										live_mode = false,
										dmypy = true,
										report_progress = false,
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
	}

	use 'stevearc/dressing.nvim' -- better vim ui input for e.g lsp rename

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
				background = {
					light = "latte",
					dark = "mocha"
				},
				transparent_background = false,
				term_colors = true,
				styles = {
					comments = { 'italic' },
					functions = { 'bold' },
					keywords = { 'italic' },
					strings = {},
					variables = {},
				},
				dim_inactive = {
					enabled = true,
					shade = "dark",
					percentage = 0.15,
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
					fidget = true,
					indent_blankline = {
						enabled = true,
						colored_indent_levels = true,
					},
					native_lsp = {
						enabled = true,
						virtual_text = {
							errors = { "italic" },
							hints = { "italic" },
							warnings = { "italic" },
							information = { "italic" },
						},
						underlines = {
							errors = { "underline" },
							hints = { "undercurl" },
							warnings = { "undercurl" },
							information = { "underline" },
						},
					},
					barbecue = {
						dim_dirname = true,
						bold_basename = true,
						dim_context = true,
					},
					nvimtree = {
						enabled = true,
					},
				}
			})
			vim.cmd [[colorscheme catppuccin]]
			-- barbar fix
			vim.cmd [[highlight BufferTabpageFill guibg=#181824]]
		end
	})

	use {
		'mhinz/vim-startify', -- start screen
		config = function()
			vim.g.startify_lists = {
				{ header = { '   Sessions' },  type = 'sessions' },
				{
					header = {
						'   MRU [' .. vim.fn.fnamemodify(vim.fn.getcwd(), ':~') .. ']',
					},
					type = 'dir',
				},
				{ header = { '   Files' },     type = 'files' },
				{ header = { '   Commands' },  type = 'commands' },
				{ header = { '   Bookmarks' }, type = 'bookmarks' },
			}
			vim.g.startify_skiplist = {
				'COMMIT_EDITMSG',
				'^/tmp',
				vim.fn.escape(
					vim.fn.fnamemodify(vim.fn.resolve(vim.env.VIMRUNTIME), ':p'),
					'\\'
				) .. 'doc',
				'plugged/.*/doc',
				'pack/.*/doc',
			}
			vim.g.startify_relative_path = 1
			vim.g.startify_session_delete_buffers = 1
			vim.g.startify_session_persistence = 1
			vim.g.startify_session_sort = 1
			vim.g.startify_change_to_dir = 0
			vim.g.startify_change_to_vcs_root = 1
		end
	}

	use {
		'romgrk/barbar.nvim', -- buffers management (="tab bar")
		requires = { 'kyazdani42/nvim-web-devicons' },
		config = function()
			require('bufferline').setup({
				icons = {
					inactive = { button = '' },
					current = { button = '' },
					visible = { button = '' },
				}
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
					lualine_b = { { 'os.date("%H:%M", os.time())', icon = '', separator = '󰅐' }, function() return ' ' end,
						'diff' },
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
		'nvim-tree/nvim-tree.lua', -- sidebar tree view file explorer, for when Ranger pop-up isn't enough
		requires = { 'nvim-tree/nvim-web-devicons' },
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
				show_current_context_start = true,
				show_trailing_blankline_indent = false,
				space_char_blankline = ' ',
				-- space_char_highlight_list = {
				--    "IndentBlanklineIndent1",
				--    "IndentBlanklineIndent2",
				--    "IndentBlanklineIndent3",
				--    "IndentBlanklineIndent4",
				--    "IndentBlanklineIndent5",
				--    "IndentBlanklineIndent6",
				-- },
				indent_blankline_filetype_exclude = { 'lspinfo', 'packer', 'checkhealth', 'help', 'man',
					'NvimTree' }
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
				RGB = false,
				RRGGBB = true,
				names = true,
				RRGGBBAA = true,
				rgb_fn = true,
				hsl_fn = true,
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
		'folke/trouble.nvim', -- list lsp diagnostics
		requires = 'kyazdani42/nvim-web-devicons',
		config = function()
			require('trouble').setup({
				mode = "document_diagnostics"
			})
		end
	}

	use {
		'utilyre/barbecue.nvim', -- show lsp symbols breadcrumbs in winbar
		tag = "*",
		requires = {
			'SmiteshP/nvim-navic',
			'nvim-tree/nvim-web-devicons', -- optional dependency
		},
		after = 'nvim-web-devicons', -- keep this if you're using NvChad
		config = function()
			require('barbecue').setup({
				theme = 'catppuccin'
			})
		end,
	}

	use {
		'SmiteshP/nvim-navbuddy', -- navigate LSP symbols in a ranger-like view
		requires = {
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
	}

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
