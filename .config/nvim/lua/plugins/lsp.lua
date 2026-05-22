return {
	{
		'HiPhish/jinja.vim', -- Jinja template syntax support
		config = function()
			vim.filetype.add({
				extension = {
					['sql.jinja'] = 'sql.jinja',
				},
				pattern = {
					['.*%.sql%.jinja'] = 'sql.jinja',
				},
			})
			vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
				pattern = '*.sql.jinja',
				callback = function()
					vim.bo.filetype = 'sql.jinja'
				end,
			})
		end,
	},

	{
		'stevearc/conform.nvim', -- format code while preserving marks and folds
		event = { 'BufWritePre' },
		cmd = { 'ConformInfo' },
		---@module "conform"
		---@type conform.setupOpts
		opts = {
			default_format_opts = {
				lsp_format = 'fallback',
			},
			formatters_by_ft = {
				lua = { 'stylua' },
				python = { 'ruff_fix', 'ruff_format' },
				javascript = { 'biome', 'biome-check', 'biome-organize-imports', 'eslint_d' },
				javascriptreact = { 'biome', 'biome-check', 'biome-organize-imports', 'eslint_d' },
				typescript = { 'biome', 'biome-check', 'biome-organize-imports', 'eslint_d' },
				typescriptreact = { 'biome', 'biome-check', 'biome-organize-imports', 'eslint_d' },
				json = { 'biome', 'biome-check' },
				sql = { 'sqruff' },
				['sql.jinja'] = { 'sqruff' },
				terraform = { 'terraform_fmt' },
				rust = { 'rustfmt' },
			},
			format_on_save = function(bufnr)
				if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then
					return
				end
				return { timeout_ms = 500 }
			end,
			formatters = {},
		},
		init = function()
			vim.o.formatexpr = "v:lua.require'conform'.formatexpr()"

			vim.api.nvim_create_user_command('FormatDisable', function(args)
				if args.bang then
					vim.b.disable_autoformat = true
				else
					vim.g.disable_autoformat = true
				end
			end, { desc = 'Disable autoformat-on-save', bang = true })

			vim.api.nvim_create_user_command('FormatEnable', function()
				vim.b.disable_autoformat = false
				vim.g.disable_autoformat = false
			end, { desc = 'Re-enable autoformat-on-save' })
		end,
	},

	{
		'junnplus/lsp-setup.nvim',
		dependencies = {
			'neovim/nvim-lspconfig',
			'williamboman/mason.nvim',
			'williamboman/mason-lspconfig.nvim',
			'saghen/blink.cmp',
		},
		opts = {
			default_mappings = false, -- cf shortcuts.vim
			servers = {
				bashls = {},
				cssls = {},
				biome = {},
				eslint = {},
				html = {},
				jsonls = {},
				tsgo = {
					-- Workaround: never attach tsgo without a real project root.
					-- Upstream panics with `vfs: path "tsconfig.json" is not absolute`
					-- when the root falls back to cwd. See microsoft/typescript-go#1905, #670.
					root_dir = function(bufnr, on_dir)
						local root = vim.fs.root(bufnr, {
							'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
							'bun.lockb', 'bun.lock', 'package.json',
						})
						if root then on_dir(root) end
					end,
					-- Workaround: strip completion trigger chars that tsgo panics on
					-- (`panic handling request textDocument/completion: Unknown trigger character`).
					on_init = function(client)
						local cp = client.server_capabilities and client.server_capabilities.completionProvider
						if cp and cp.triggerCharacters then
							local bad = { ['-'] = true, [':'] = true, ['!'] = true, ['('] = true, [']'] = true }
							cp.triggerCharacters = vim.tbl_filter(function(c) return not bad[c] end, cp.triggerCharacters)
						end
					end,
					-- Workaround: nvim sends "file://" (no path) for unnamed buffers — tsgo
					-- panics in computeConfigFileName(""). Also intercept completion requests
					-- with trigger chars tsgo panics on (belt-and-suspenders over on_init, since
					-- blink may not re-read server capabilities after we strip them).
					-- Root: vim.uri_from_bufnr() → uri_from_fname("") → "file://"
					on_attach = function(client)
						local bad_triggers = { ['-'] = true, [':'] = true, ['!'] = true, ['('] = true, [']'] = true }
						local function should_drop(method, params)
							if type(params) ~= 'table' then return false end
							local uri = type(params.textDocument) == 'table' and params.textDocument.uri
							if uri == 'file://' then return true end
							if method == 'textDocument/completion' then
								local ctx = params.context
								if type(ctx) == 'table' and ctx.triggerKind == 2 and bad_triggers[ctx.triggerCharacter] then
									return true
								end
							end
							return false
						end
						local _notify = client.notify
						client.notify = function(self, method, params, ...)
							if should_drop(method, params) then return end
							return _notify(self, method, params, ...)
						end
						local _request = client.request
						client.request = function(self, method, params, ...)
							if should_drop(method, params) then return nil end
							return _request(self, method, params, ...)
						end
					end,
				},
				tailwindcss = {},
				prismals = {},
				vimls = {},
				yamlls = {},
				gh_actions_ls = {},
				terraformls = {},
				rust_analyzer = {},
				pylsp = {
					settings = {
						pylsp = {
							plugins = {
								pycodestyle = { enabled = false },
								black = { enabled = false },
								pylsp_mypy = { enabled = false },
								isort = { enabled = false },
								ruff = { enabled = true },
								jedi_completion = { fuzzy = true },
							},
						},
					},
				},
				lua_ls = {
					settings = {
						Lua = {
							diagnostics = { globals = { 'vim' } },
							workspace = { library = vim.api.nvim_get_runtime_file('', true) },
						},
					},
				},
				jinja_lsp = {},
			},
			on_attach = function() end,
		},
		config = function(_, opts)
			require('lsp-setup').setup(opts)

			-- Auto-switch pylsp to project-local .venv
			vim.api.nvim_create_autocmd('LspAttach', {
				callback = function(args)
					local client = vim.lsp.get_client_by_id(args.data.client_id)
					if not client or client.name ~= 'pylsp' then return end

					local root_dir = client.config.root_dir
					if not root_dir then return end

					local venv_path = root_dir .. '/.venv'
					if vim.fn.isdirectory(venv_path) ~= 1 then return end

					local venv_pylsp = venv_path .. '/bin/pylsp'

					if vim.fn.executable(venv_pylsp) ~= 1 then
						vim.notify('Installing python-lsp-server in .venv...', vim.log.levels.INFO)
						local install_cmd = vim.fn.executable('uv') == 1
							 and string.format("cd %s && uv pip install 'python-lsp-server[all]'", vim.fn.shellescape(root_dir))
							 or string.format("%s/bin/pip install 'python-lsp-server[all]'", vim.fn.shellescape(venv_path))

						vim.fn.jobstart(install_cmd, {
							on_exit = function(_, exit_code)
								if exit_code == 0 then
									vim.notify('python-lsp-server installed! Restarting LSP...', vim.log.levels.INFO)
									vim.schedule(function()
										vim.lsp.stop_client(client.id, true)
										vim.schedule(function()
											vim.lsp.start({
												name = 'pylsp',
												cmd = { venv_pylsp },
												root_dir = root_dir,
												settings = opts.servers.pylsp.settings,
											})
										end)
									end)
								else
									vim.notify('Failed to install python-lsp-server', vim.log.levels.ERROR)
								end
							end,
						})
						return
					end

					local cmd_path = client.config.cmd[1]
					if cmd_path ~= venv_pylsp then
						vim.lsp.stop_client(client.id, true)
						vim.schedule(function()
							vim.lsp.start({
								name = 'pylsp',
								cmd = { venv_pylsp },
								root_dir = root_dir,
								settings = opts.servers.pylsp.settings,
							})
						end)
					end
				end,
			})

			-- Configure diagnostics
			vim.diagnostic.config({
				virtual_text = true,
				virtual_lines = false,
				underline = true,
				update_in_insert = false,
				severity_sort = true,
				float = {
					focusable = false,
					style = 'minimal',
					border = 'rounded',
					source = 'always',
				},
			})

			-- Highlight symbol usages under cursor
			vim.api.nvim_create_autocmd('LspAttach', {
				callback = function(args)
					local client = vim.lsp.get_client_by_id(args.data.client_id)
					local bufnr = args.buf
					if client == nil then return end

					if client:supports_method('textDocument/documentHighlight') then
						vim.cmd([[
							hi! link LspReferenceRead Visual
							hi! link LspReferenceText Visual
							hi! link LspReferenceWrite Visual
						]])

						vim.api.nvim_create_augroup('lsp_document_highlight', { clear = false })
						vim.api.nvim_clear_autocmds({ buffer = bufnr, group = 'lsp_document_highlight' })
						vim.api.nvim_create_autocmd({ 'CursorHold', 'CursorHoldI' }, {
							group = 'lsp_document_highlight',
							buffer = bufnr,
							callback = vim.lsp.buf.document_highlight,
						})
						vim.api.nvim_create_autocmd({ 'CursorMoved', 'CursorMovedI' }, {
							group = 'lsp_document_highlight',
							buffer = bufnr,
							callback = vim.lsp.buf.clear_references,
						})
					end
				end,
			})
		end,
	},
}
