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
				ensure_installed = 'all',
				highlight = {
					enable = true,
				}
			})
		end
	}

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
		config = function ()
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
		'hrsh7th/cmp-cmdline', -- completions for vim command line
		config = function()
			-- autocomplete commands using vim docs and paths on local fs
			require('cmp').setup.cmdline(':', {
				sources = require('cmp').config.sources({
					{ name = 'path' }
				}, {
					{ name = 'cmdline' }
				})
			})

			-- autocomplete searches using words in current buffer
			require('cmp').setup.cmdline('/', {
				sources = {
					{ name = 'buffer' }
				}
			})
		end
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
		'rose-pine/neovim', -- theme/colorscheme
		as = 'rose-pine',
		config = function()
			require('rose-pine').setup({
				disable_italics = true,
			})
			vim.cmd('colorscheme rose-pine')
		end
	})

	use {
		'romgrk/barbar.nvim', -- buffers management (="tab bar")
		requires = {'kyazdani42/nvim-web-devicons'},
		config = function()
			-- Fix visible-inactive-modified being brighter than active
			vim.cmd([[
				hi BufferVisible guibg=#232433 guifg=#a9b1d6
				hi BufferVisibleIndex guifg=#3b3d57 guibg=#232433
				hi BufferVisibleMod guifg=#3b3d57 guibg=#232433
				hi BufferVisibleSign guifg=#3b3d57 guibg=#232433
			]])
		end
	}

	use {
		'nvim-lualine/lualine.nvim', -- fancy status line with mode indicator and cursor position
		requires = {'kyazdani42/nvim-web-devicons'},
		config = function()
			require('lualine').setup({
				options = {
					section_separators = { left = '', right = '' },
					component_separators = { left = '╱', right = '╱' }
				},
				sections = {
					lualine_a = {'mode'},
					lualine_b = {{'os.date("%H:%M", os.time())', icon = ' ', separator = ''}, function() return ' ' end, 'diff'},
					lualine_c = {{
						'branch',
						fmt = function(s)
							if string.len(s) > 26 then
								return string.sub(s, 0, 26) .. '...'
							else
								return s
							end
						end
					}},
					lualine_x = {'diagnostics'},
					lualine_y = {'filetype'},
					lualine_z = {'location'}
				}
			})
		end
	}

	use({
		'lukas-reineke/indent-blankline.nvim', -- indentation guides
		config = function()
			require('indent_blankline').setup({
				use_treesitter = true,
				show_current_context = true,
				show_trailing_blankline_indent = false,
			})
		end
	})

	use({
		'mvllow/modes.nvim', -- change line background color to reflect current mode
		config = function()
			require('modes').setup()
		end
	})

	use 'jeffkreeftmeijer/vim-numbertoggle' -- automatically switch numbers to absolute instead of relative when buffers are inactive

	use {
		'norcalli/nvim-colorizer.lua', -- highlight color strings with the color they represent
		config = function()
			require('colorizer').setup({'*'}, {
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
	use {'nvim-telescope/telescope-fzf-native.nvim', run = 'make' } -- native fzf sorter for Telescope, faster

	use {
		'nvim-telescope/telescope.nvim', -- fuzzy finder
		requires = { {'nvim-lua/plenary.nvim'} },
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
			vim.g.floaterm_rootmarkers = {'.project', '.git', '.hg', '.svn', '.root', '.gitignore'}
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
			require('trouble').setup()
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
end)
