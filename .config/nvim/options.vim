set shell=/opt/homebrew/bin/fish

set timeoutlen=200
set updatetime=1000
set switchbuf=useopen,vsplit
set hidden
set nobackup
set termguicolors
set nowritebackup
set mouse=a
set cmdheight=2
set shortmess+=c
set signcolumn=yes
set showmatch
set number relativenumber
augroup nolinenoforterm
	autocmd!
	autocmd TermOpen * setlocal nonumber norelativenumber
augroup END
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
set clipboard^=unnamed
set foldcolumn=1
set fillchars=eob:\ ,fold:\ ,foldopen:,foldsep:\ ,foldclose:
