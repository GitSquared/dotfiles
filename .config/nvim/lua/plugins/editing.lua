return {
	'tpope/vim-surround',

	{
		'folke/flash.nvim',
		event = 'VeryLazy',
		---@type Flash.Config
		opts = {},
		keys = {
			{ 's',     mode = { 'n', 'x', 'o' }, function() require('flash').jump() end,              desc = 'Flash' },
			{ 'S',     mode = { 'n', 'o' },      function() require('flash').treesitter() end,        desc = 'Flash Treesitter' },
			{ 'r',     mode = 'o',               function() require('flash').remote() end,            desc = 'Remote Flash' },
			{ 'R',     mode = { 'o', 'x' },      function() require('flash').treesitter_search() end, desc = 'Treesitter Search' },
			{ '<c-s>', mode = { 'c' },           function() require('flash').toggle() end,            desc = 'Toggle Flash Search' },
		},
	},

	{
		'sustech-data/wildfire.nvim',
		event = 'VeryLazy',
		dependencies = { 'nvim-treesitter/nvim-treesitter' },
		config = function()
			require('wildfire').setup()
		end,
	},

	{
		'Raimondi/delimitMate',
		config = function()
			vim.g.delimitMate_expand_cr = 2
			vim.g.delimitMate_expand_space = true
			vim.g.delimitMate_matchpairs = '(:),[:],{:},<:>'
			vim.cmd([[au FileType html,xml let b:delimitMate_matchpairs = "(:),[:],{:}"]])
		end,
	},

	{
		'ciaranm/detectindent',
		config = function()
			vim.cmd([[au BufReadPost * :DetectIndent]])
		end,
	},
}
