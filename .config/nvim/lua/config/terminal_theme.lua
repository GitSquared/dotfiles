local M = {}
local current, pending

local function blend(a, b, amount)
	local rgb = {}
	for i = 1, 3 do
		local offset = 2 * i
		local x = tonumber(a:sub(offset, offset + 1), 16)
		local y = tonumber(b:sub(offset, offset + 1), 16)
		rgb[i] = math.floor(x + (y - x) * amount + 0.5)
	end
	return string.format('#%02x%02x%02x', unpack(rgb))
end

-- Read the existing terminal theme as a startup/headless fallback.
local function fallback()
	local path = vim.fn.expand('~/.config/ghostty/themes/merino-' .. vim.o.background)
	if vim.fn.filereadable(path) == 0 then return end
	local colors = { values = {} }
	for _, line in ipairs(vim.fn.readfile(path)) do
		local key, hex = line:match('^([%w%-]+)%s*=%s*(#%x+)')
		if key == 'foreground' then colors.fg = hex end
		if key == 'background' then colors.bg = hex end
		local slot, value = line:match('^palette%s*=%s*(%d+)=(#%x+)')
		if slot and tonumber(slot) < 16 then colors.values[tonumber(slot) + 1] = value end
	end
	if colors.fg and colors.bg and #colors.values == 16 then return colors end
end

local function polish(colors)
	local fg, bg = colors.fg, colors.bg
	-- Editing surfaces and buffer tabs inherit the terminal background.
	for _, name in ipairs({ 'Normal', 'NormalNC', 'SignColumn', 'FoldColumn',
		'LineNr', 'CursorLineNr', 'EndOfBuffer', 'WinBar', 'WinBarNC',
		'TabLine', 'TabLineFill', 'TabLineSel', 'CursorLine', 'CursorColumn' }) do
		local hl = vim.api.nvim_get_hl(0, { name = name, link = false })
		hl.bg, hl.ctermbg, hl.reverse, hl.default = nil, nil, nil, nil
		vim.api.nvim_set_hl(0, name, hl)
	end
	for name, hl in pairs(vim.api.nvim_get_hl(0, {})) do
		if name:match('^Buffer') and not hl.link then
			hl.bg, hl.ctermbg, hl.reverse, hl.default = nil, nil, nil, nil
			vim.api.nvim_set_hl(0, name, hl)
		end
	end
	-- Quiet neutral guides; only the current scope gets a muted blue accent.
	vim.api.nvim_set_hl(0, 'IblIndent', { fg = blend(bg, fg, 0.32), nocombine = true })
	vim.api.nvim_set_hl(0, 'IblWhitespace', { fg = blend(bg, fg, 0.32), nocombine = true })
	vim.api.nvim_set_hl(0, 'IblScope', { fg = blend(bg, colors.values[5], 0.8), nocombine = true })
end

function M.apply(colors)
	local fg, bg, a = colors.fg, colors.bg, colors.values
	local dark = vim.o.background == 'dark'
	local p = require('mini.base16').mini_palette(bg, fg, 50)
	-- Base16's shade ramp plus Merino accents; retain our preferred syntax roles.
	p.base00, p.base01, p.base02 = bg, blend(bg, fg, 0.06), blend(bg, fg, 0.14)
	p.base03, p.base04 = blend(fg, bg, dark and 0.42 or 0.35), blend(fg, bg, 0.22)
	p.base05, p.base06, p.base07 = fg, fg, fg
	p.base08, p.base09 = a[2], a[6]
	p.base0A, p.base0B = blend(a[7], a[5], 0.4), blend(a[4], fg, 0.1)
	p.base0C, p.base0D = a[7], blend(a[7], fg, 0.12)
	p.base0E, p.base0F = blend(a[5], fg, 0.1), a[6]
	require('mini.base16').setup({ palette = p, use_cterm = false })
	-- Base16 reuses the string slot for success messages; keep semantic statuses distinct.
	for name, slot in pairs({ DiagnosticOk = 3, Added = 3, Removed = 2, Changed = 5,
		DiagnosticError = 2, DiagnosticWarn = 4, DiagnosticInfo = 5, DiagnosticHint = 7,
		GitSignsAdd = 3, GitSignsDelete = 2, GitSignsChange = 5, WarningMsg = 4 }) do
		vim.api.nvim_set_hl(0, name, { fg = a[slot] })
	end
	vim.api.nvim_set_hl(0, 'Constant', { fg = a[6] })
	vim.api.nvim_set_hl(0, 'Identifier', { fg = fg })
	vim.api.nvim_set_hl(0, '@constant.builtin', { link = 'Constant' })
	vim.api.nvim_set_hl(0, 'DiffAdd', { fg = fg, bg = blend(bg, a[3], 0.12) })
	vim.api.nvim_set_hl(0, 'DiffDelete', { fg = fg, bg = blend(bg, a[2], 0.12) })
	vim.api.nvim_set_hl(0, 'Comment', { fg = p.base03, italic = true })
	for slot = 0, 15 do vim.g['terminal_color_' .. slot] = a[slot + 1] end
	vim.g.colors_name = 'merino'
	polish(colors)
end

function M.load()
	local colors = current or fallback()
	if colors then M.apply(colors) end
end

-- Asynchronous OSC queries: no blocking reads or external theme-sync dependency.
function M.refresh()
	if pending or vim.fn.has('ttyin') == 0 or vim.fn.has('ttyout') == 0 then return end
	local request = { values = {}, count = 0, seen = {} }
	pending = request
	local queries = { '\27]10;?\27\\', '\27]11;?\27\\' }
	for slot = 0, 15 do queries[#queries + 1] = '\27]4;' .. slot .. ';?\27\\' end
	io.stdout:write(table.concat(queries))
	io.stdout:flush()
	vim.defer_fn(function() if pending == request then pending = nil end end, 1000)
end

function M.setup()
	local group = vim.api.nvim_create_augroup('MerinoTerminalPalette', { clear = true })
	-- Buffer-tab plugins can recreate their highlights after a colorscheme loads.
	vim.api.nvim_create_autocmd({ 'ColorScheme', 'VimEnter' }, {
		group = group,
		callback = function()
			vim.schedule(function()
				local colors = current or fallback()
				if colors then polish(colors) end
			end)
		end,
	})
	vim.api.nvim_create_autocmd('TermResponse', {
		group = group,
		callback = function(event)
			local sequence = event.data.sequence
			local target = sequence:match('^\27%](1[01]);')
			local slot = sequence:match('^\27%]4;(%d+);')
			local r, g, b = sequence:match('rgb:(%x+)/(%x+)/(%x+)')
			if not r or (not target and not slot) then return end
			if not pending then
				if target == '11' then M.refresh() end
				return
			end
			local function channel(value)
				return math.floor(tonumber(value, 16) * 255 / (16 ^ #value - 1) + 0.5)
			end
			local hex = string.format('#%02x%02x%02x', channel(r), channel(g), channel(b))
			local key = target or ('palette:' .. slot)
			if slot and tonumber(slot) < 16 then pending.values[tonumber(slot) + 1] = hex
			elseif target == '10' then pending.fg = hex
			elseif target == '11' then pending.bg = hex
			else return end
			if not pending.seen[key] then pending.count = pending.count + 1; pending.seen[key] = true end
			if pending.count == 18 then
				local colors = { fg = pending.fg, bg = pending.bg, values = pending.values }
				pending = nil
				if not vim.deep_equal(current, colors) then
					current = colors
					vim.schedule(function() vim.cmd.colorscheme('merino') end)
				end
			end
		end,
	})
	vim.cmd.colorscheme('merino')
	vim.api.nvim_create_autocmd('VimEnter', { group = group, once = true, callback = M.refresh })
end

return M
