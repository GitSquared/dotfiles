return {
	{
		'nvim-treesitter/nvim-treesitter',
		lazy = false, -- plugin explicitly does not support lazy-loading
		build = ':TSUpdate',
		config = function()
			require('nvim-treesitter').setup({
				-- Installs parsers here, prepended to rtp — takes precedence
				-- over any parsers bundled by Homebrew's neovim formula
				install_dir = vim.fn.stdpath('data') .. '/site',
			})
			require('nvim-treesitter').install({
				'vim', 'lua', 'sql', 'rust', 'regex',
				'typescript', 'tsx', 'javascript',
				'scss', 'yaml', 'python', 'toml', 'latex',
				'html', 'json', 'http', 'graphql',
				'fish', 'dockerfile', 'terraform', 'bash', 'css',
			})
		end,
	},

	{
		'MeanderingProgrammer/render-markdown.nvim',
		opts = {},
		dependencies = { 'nvim-treesitter/nvim-treesitter', 'nvim-tree/nvim-web-devicons' },
	},
}
