-- Active language servers setup for built-in neovim LSP client (via nvim-lspconfig)
-- language servers have to be installed using the system package manager or npm
-- (a lot of them are through npm, here's a pro tip to list installed global npm packages: npm list -g --depth=0)

local lsp = require('lspconfig')

-- tell LSP servers we support code snippets
local capabilities = require('cmp_nvim_lsp').update_capabilities(
	vim.lsp.protocol.make_client_capabilities()
)

lsp.bashls.setup({ capabilities = capabilities }) -- npm i -g bash-language-server
lsp.cssls.setup({ capabilities = capabilities }) -- npm i -g vscode-langservers-extracted
-- lsp.eslint.setup({ capabilities = capabilities }) -- ↑↑↑
lsp.html.setup({ capabilities = capabilities }) -- ↑↑↑
lsp.jsonls.setup({ capabilities = capabilities }) -- ↑↑↑
lsp.tsserver.setup({ autostart = true, capabilities = capabilities }) -- npm i -g typescript typescript-language-server
lsp.vimls.setup({ capabilities = capabilities }) -- npm i -g vim-language-server
lsp.yamlls.setup({ capabilities = capabilities }) -- npm i -g yaml-language-server
lsp.pylsp.setup({ -- pip install -U 'python-lsp-server[all]' preload pyls-flake8 python-lsp-black pyls-mypy pyls-isort
	capabilities = capabilities,
	settings = {
		pylsp = {
			plugins = {
				pycodestyle = {enabled = false},
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
})
local lua_runtime_path = vim.split(package.path, ';')
table.insert(lua_runtime_path, "lua/?.lua")
table.insert(lua_runtime_path, "lua/?/init.lua")
lsp.sumneko_lua.setup({  -- brew install lua-language-server
	capabilities = capabilities,
	settings = {
		Lua = {
			runtime = {
				version = 'LuaJIT',
				path = lua_runtime_path
			},
			diagnostics = {
				-- recognize the `vim` global
				globals = {'vim'}
			},
			workspace = {
				-- recognize vim api
				library = vim.api.nvim_get_runtime_file("", true)
			}
		},
	}
})
