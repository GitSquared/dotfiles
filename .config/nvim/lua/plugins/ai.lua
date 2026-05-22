return {
	{
		'folke/sidekick.nvim', -- AI CLIs integration
		opts = {},
	},

	{
		'zbirenbaum/copilot.lua',
		dependencies = {
			'copilotlsp-nvim/copilot-lsp',
		},
		cmd = 'Copilot',
		event = 'InsertEnter',
		config = function()
			require('copilot').setup({
				suggestion = {
					enabled = true,
					auto_trigger = true,
					keymap = {
						accept = '<A-Tab>',
					},
				},
				nes = {
					enabled = true,
					keymap = {
						accept_and_goto = '<C-Tab>',
						dismiss = '<Esc>',
					},
				},
				panel = { enabled = false },
			})
		end,
	},
}
