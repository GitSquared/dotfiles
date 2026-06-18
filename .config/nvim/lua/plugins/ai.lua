return {
	{
		'folke/sidekick.nvim', -- AI CLIs integration
		opts = {},
	},

	{
		'zbirenbaum/copilot.lua',
		dependencies = {
			{
				'copilotlsp-nvim/copilot-lsp',
				init = function()
					vim.g.copilot_nes_debounce = 500
				end,
			},
		},
		cmd = 'Copilot',
		event = 'InsertEnter',
		config = function()
			local function sync_copilot_inline_visibility()
				vim.b.copilot_suggestion_hidden = vim.b.nes_state ~= nil
			end

			local function dismiss_copilot_inline()
				pcall(function()
					require('copilot.suggestion').dismiss()
				end)
			end

			local function install_nes_inline_guard()
				local ok, nes_ui = pcall(require, 'copilot-lsp.nes.ui')
				if not ok or nes_ui._copilot_inline_guard_installed then
					return
				end

				nes_ui._copilot_inline_guard_installed = true

				local display_next_suggestion = nes_ui._display_next_suggestion
				nes_ui._display_next_suggestion = function(bufnr, ns_id, edits)
					local displayed = display_next_suggestion(bufnr, ns_id, edits)
					vim.b[bufnr].copilot_suggestion_hidden = vim.b[bufnr].nes_state ~= nil

					if vim.b[bufnr].nes_state and bufnr == vim.api.nvim_get_current_buf() then
						dismiss_copilot_inline()
					end

					return displayed
				end

				local clear_suggestion = nes_ui.clear_suggestion
				nes_ui.clear_suggestion = function(bufnr, ns_id)
					clear_suggestion(bufnr, ns_id)
					bufnr = bufnr and bufnr > 0 and bufnr or vim.api.nvim_get_current_buf()

					if vim.api.nvim_buf_is_valid(bufnr) then
						vim.b[bufnr].copilot_suggestion_hidden = vim.b[bufnr].nes_state ~= nil
					end
				end
			end

			require('copilot').setup({
				suggestion = {
					enabled = true,
					auto_trigger = true,
					suggestion_notification = function()
						pcall(function()
							require('blink.cmp').hide()
						end)
					end,
					keymap = {
						accept = false,
						accept_word = false,
						accept_line = false,
					},
				},
				nes = {
					enabled = true,
					keymap = {
						accept_and_goto = false,
						accept = false,
						dismiss = false,
					},
				},
				panel = { enabled = false },
			})

			install_nes_inline_guard()

			vim.keymap.set('n', '<Tab>', function()
				local bufnr = vim.api.nvim_get_current_buf()
				if vim.b[bufnr].nes_state then
					return require('copilot-lsp.nes').apply_pending_nes()
							and require('copilot-lsp.nes').walk_cursor_end_edit()
							and '<Ignore>'
						or '<Ignore>'
				end

				return '<C-i>'
			end, {
				desc = 'Accept Copilot NES suggestion or jump forward',
				expr = true,
				replace_keycodes = true,
			})

			vim.keymap.set('n', '<Esc>', function()
				if require('copilot-lsp.nes').clear() then
					return
				end

				vim.cmd('cclose')
			end, { desc = 'Dismiss Copilot NES or close quickfix' })

			vim.api.nvim_create_autocmd({ 'InsertEnter', 'CursorMoved', 'CursorMovedI' }, {
				callback = sync_copilot_inline_visibility,
			})
		end,
	},
}
