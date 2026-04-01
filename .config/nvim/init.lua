local cfg = vim.fn.stdpath('config')
vim.cmd('source ' .. cfg .. '/custom-floaterms.vim')
vim.cmd('source ' .. cfg .. '/options.vim')
vim.cmd('source ' .. cfg .. '/shortcuts.vim')

require('config.lazy')
