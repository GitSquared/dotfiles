return {
	{
		'ibhagwan/fzf-lua',
		dependencies = { 'nvim-lua/plenary.nvim', 'nvim-tree/nvim-web-devicons' },
		opts = {},
	},

	{
		'voldikss/vim-floaterm',
		config = function()
			vim.g.floaterm_autoclose = true
			vim.g.floaterm_opener = 'edit'
			vim.g.floaterm_rootmarkers = { '.project', '.git', '.hg', '.svn', '.root', '.gitignore' }
			vim.g.floaterm_width = 0.8
			vim.g.floaterm_shell = vim.o.shell
			vim.cmd([[
				function s:floatermSettings()
				endfunction
				autocmd FileType floaterm call s:floatermSettings()
			]])
		end,
	},

	{
		'folke/trouble.nvim',
		dependencies = { 'nvim-tree/nvim-web-devicons' },
		opts = { mode = 'document_diagnostics' },
		config = function()
			local signs = { Error = '', Warn = '', Hint = '', Info = '' }
			for type, icon in pairs(signs) do
				local hl = 'DiagnosticSign' .. type
				vim.fn.sign_define(hl, { text = icon, texthl = hl, numhl = '' })
			end
		end,
	},

	{
		'dnlhc/glance.nvim',
		cmd = 'Glance',
		config = function()
			require('glance').setup({
				border = { enable = true, top_char = '─', bottom_char = '─' },
			})
		end,
	},

	{
		'nvim-tree/nvim-tree.lua',
		dependencies = { 'nvim-tree/nvim-web-devicons' },
		config = function()
			require('nvim-tree').setup()
		end,
	},

	{
		'mikavilpas/yazi.nvim',
		event = 'VeryLazy',
		dependencies = { { 'folke/snacks.nvim', lazy = true } },
		opts = {},
	},

	{
		'm4xshen/hardtime.nvim',
		dependencies = { 'MunifTanjim/nui.nvim', 'nvim-lua/plenary.nvim' },
		opts = {
			disable_mouse = false,
			disabled_keys = {
				['<Up>'] = {}, ['<Down>'] = {}, ['<Left>'] = {}, ['<Right>'] = {},
			},
			restricted_keys = {
				['h'] = {}, ['j'] = {}, ['k'] = {}, ['l'] = {},
			},
		},
	},
}
