return {
	{
		'lewis6991/gitsigns.nvim',
		config = function()
			require('gitsigns').setup()
		end,
	},

	{
		'kdheepak/lazygit.nvim',
		cmd = {
			'LazyGit', 'LazyGitConfig', 'LazyGitCurrentFile',
			'LazyGitFilter', 'LazyGitFilterCurrentFile',
		},
		dependencies = { 'nvim-lua/plenary.nvim' },
		config = function()
			vim.g.lazygit_floating_window_winblend = 0
			vim.g.lazygit_floating_window_scaling_factor = 0.9
		end,
	},

	{
		'linrongbin16/gitlinker.nvim',
		cmd = 'GitLink',
		opts = {},
	},

	{
		'pwntester/octo.nvim',
		dependencies = {
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
			vim.keymap.set('i', '@', '@<C-x><C-o>', { silent = true, buffer = true })
			vim.keymap.set('i', '#', '#<C-x><C-o>', { silent = true, buffer = true })
		end,
	},
}
