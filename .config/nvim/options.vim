set shell=/opt/homebrew/bin/fish

set timeoutlen=200
set switchbuf=useopen,vsplit
set hidden
set nobackup
set termguicolors
set nowritebackup
set mouse=a
set cmdheight=2
set cursorline
augroup cursorlinetoggle
	autocmd!
	autocmd BufEnter,FocusGained,InsertLeave,WinEnter * set cursorline
	autocmd BufLeave,FocusLost,InsertEnter,WinLeave * set nocursorline
augroup END
set shortmess+=c
set signcolumn=yes
set showmatch
set number relativenumber
set list
set listchars=tab:⇝\ ,trail:·,nbsp:·
set formatoptions+=o
set ts=3
set sw=3
set noet
set autoindent
set breakindent
set formatoptions=l
set lbr
set splitbelow
set splitright
set showcmd
set ignorecase
set smartcase
set gdefault
set clipboard=unnamedplus
