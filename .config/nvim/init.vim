call plug#begin('~/.nvim/plugged')

Plug 'tpope/vim-sensible'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'voldikss/vim-floaterm'
Plug 'sheerun/vim-polyglot'
Plug 'thaerkh/vim-workspace'
Plug 'vim-airline/vim-airline'
Plug 'yuttie/comfortable-motion.vim'
Plug 'scrooloose/nerdtree'
Plug 'terryma/vim-multiple-cursors'
Plug 'matze/vim-move'
Plug 'Xuyuanp/nerdtree-git-plugin'
Plug 'Raimondi/delimitMate'
Plug 'inkarkat/vim-ingo-library'
Plug 'inkarkat/vim-OnSyntaxChange'
Plug 'alvan/vim-closetag'
Plug 'tpope/vim-surround'
Plug 'scrooloose/nerdcommenter'
Plug 'airblade/vim-gitgutter'
Plug 'ctrlpvim/ctrlp.vim'
Plug 'easymotion/vim-easymotion'
Plug 'ryanoasis/vim-devicons'
Plug 'ciaranm/detectindent'
Plug 'gko/vim-coloresque'
Plug 'mattn/emmet-vim'
Plug 'kyazdani42/nvim-web-devicons'
Plug 'romgrk/barbar.nvim'
Plug 'jeffkreeftmeijer/vim-numbertoggle'
" Rust stuff
Plug 'rust-lang/rust.vim', { 'for': 'rust' }
" Markdown stuff
Plug 'plasticboy/vim-markdown', { 'for': 'markdown' }
" Colorscheme
Plug 'ghifarit53/tokyonight-vim'

call plug#end()

" Mouse support
set mouse+=a
noremap <silent> <ScrollWheelDown> :call comfortable_motion#flick(40)<CR>
noremap <silent> <ScrollWheelUp>   :call comfortable_motion#flick(-40)<CR>

let mapleader = ' '

" Barbar tabline
let bufferline = get(g:, 'bufferline', {})
let bufferline.closable = v:false
let bufferline.icon_custom_colors = v:true
let bufferline.semantic_letters = v:true
let bufferline.icon_separator_active = '▎'
let bufferline.icon_separator_inactive = '▎'
let bufferline.icon_close_tab = ''
let bufferline.icon_close_tab_modified = '●'

let g:airline#extensions#coc#enabled = 1
let g:airline_theme = 'tokyonight'
let g:airline_powerline_fonts = 1
let g:airline#extensions#tabline#enabled = 0
" Disable powerline arrows
let g:airline_right_alt_sep = ''
let g:airline_right_sep = ''
let g:airline_left_alt_sep= ''
let g:airline_left_sep = ''
" Short mode indicator in airline
let g:airline_mode_map = {
	\ '__'     : '-',
	\ 'c'      : 'C',
	\ 'i'      : 'I',
	\ 'ic'     : 'I',
	\ 'ix'     : 'I',
	\ 'n'      : 'N',
	\ 'multi'  : 'M',
	\ 'ni'     : 'N',
	\ 'no'     : 'N',
	\ 'R'      : 'R',
	\ 'Rv'     : 'R',
	\ 's'      : 'S',
	\ 'S'      : 'S',
	\ ''     : 'S',
	\ 't'      : 'T',
	\ 'v'      : 'V',
	\ 'V'      : 'V',
	\ ''     : 'V',
\ }
" Less bloated Z section
" let g:airline_section_z = "%3p%% %#__accent_bold#%{g:airline_symbols.linenr}%4l%#__restore__#%#__accent_bold#/%L%{g:airline_symbols.maxlinenr}%#__restore__# :%3v"
let g:airline_section_z = "%#__accent_bold#%4l:%v/%L %3p%% %#__accent_bold#%{g:airline_symbols.linenr}"

" Workspace config
let g:workspace_create_new_tabs = 0
let g:workspace_session_directory = $HOME . '/.nvim/sessions/'
let g:workspace_undodir = $HOME . '/.nvim/undohistory/'
let g:workspace_autosave = 0

" DelimitMate has... interesting defaults, change them
let g:delimitMate_expand_cr = 2
let g:delimitMate_expand_space = 1
let g:delimitMate_matchpairs = "(:),[:],{:},<:>"

" Remove vim-gitgutter mappings
let g:gitgutter_map_keys = 0

" Floaterm config
let g:floaterm_autoclose = 1
let g:floaterm_opener = 'edit'
let g:floaterm_rootmarkers = ['.project', '.git', '.hg', '.svn', '.root', '.gitignore']
let g:floaterm_width = 0.8
function s:floatermSettings()
	" setlocal notermguicolors
	let t:floaterm_custom_opened = 1
endfunction
autocmd FileType floaterm call s:floatermSettings()

" Custom terminal drawer function
let t:floaterm_custom_opened = 0
function RunInShell(cmd)
	if t:floaterm_custom_opened
		exe 'FloatermSend '.a:cmd
	else
		exe 'FloatermNew --height=0.8 --width=0.6 '.a:cmd
	endif
endfunction
function CustomTermDrawerCloseHandler()
	let t:floaterm_custom_opened = 0
endfunction
augroup closeCustomTermDrawer
	autocmd!
	autocmd TermClose * :call CustomTermDrawerCloseHandler()
augroup END

" CtrlP: Ignore files in .gitignore
let g:ctrlp_user_command = ['.git', 'cd %s && git ls-files -co --exclude-standard']
let g:ctrpl_cmd = 'CtrlP'

let g:NERDSpaceDelims = 1
let g:NERDCommentEmptyLines = 1
let g:NERDCompactSexyComs = 1
let g:NERDDefaultAlign = 'left'
let g:NERDToggleCheckAllLines = 1

" Highlight the symbol and its references when holding the cursor.
autocmd CursorHold * silent call CocActionAsync('highlight')

" Use <tab> / <s-tab> to navigate and select completions
function! s:check_back_space() abort
	let col = col('.') - 1
	return !col || getline('.')[col - 1]  =~ '\s'
endfunction
inoremap <silent><expr> <Tab>
	\ pumvisible() ? "\<C-n>" :
	\ <SID>check_back_space() ? "\<Tab>" :
	\ coc#refresh()
inoremap <expr> <Tab> pumvisible() ? "\<C-n>" : "\<Tab>"
inoremap <expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"

" New, write, quit/close
nmap <Leader>b :enew<CR>
nmap <Leader>w :w<CR>
nmap <Leader>q :BufferClose<CR>
nmap <Leader>Q :qa<CR>
nmap <Leader>, :close<CR>
" Editor utilities
map <Leader>f <Plug>(easymotion-bd-w)
map <Leader>F :BufferPick<CR>
map <Leader>r <Plug>(coc-rename)
map <Leader>c <Plug>(code-action)
nmap <silent> K :call CocAction('doHover')<CR>
nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)
map <F9> :set hlsearch!<CR>
map <F10> :set invrelativenumber<CR>
map <Leader>T :set ts=3 sw=3 noet<CR>
let g:ctrlp_map = '<Leader>p'
nmap <Leader><Enter> :ToggleWorkspace<CR>
nmap <Leader>C :BufferCloseAllButCurrent<CR>
" Switch buffers
nmap <Leader>v :BufferPrevious<CR>
nmap <Leader>n :BufferNext<CR>
nmap <Leader>V :BufferMovePrevious<CR>
nmap <Leader>N :BufferMoveNext<CR>
" Create windows
nmap <Leader>; :split<CR>
nmap <Leader>: :vsplit<CR>
" Navigate windows
nmap <Leader><Leader> <C-W><C-W>
nmap <Up> <C-W>k
nmap <Down> <C-W>j
nmap <Left> <C-W>h
nmap <Right> <C-W>l
" Move windows
nmap <C-Up> <C-W>K
nmap <C-Down> <C-W>J
nmap <C-Left> <C-W>H
nmap <C-Right> <C-W>L
" Resize windows
nmap <Leader>= <C-W>=
nmap <S-Up> :resize +3<CR>
nmap <S-Down> :resize -3<CR>
nmap <S-Left> :vertical resize -3<CR>
nmap <S-Right> :vertical resize +3<CR>
" Toggle side panels
nmap <Leader>t :NERDTreeToggle<CR>
nmap <Leader>s :FloatermToggle<CR>
nmap <M-s> :FloatermToggle<CR>
nmap <Leader>d :FloatermNew ranger<CR>
" Terminal mode shortcuts
tmap <C-Space> <C-\><C-N><CR>
tmap <M-s> <C-\><C-n><CR>:FloatermToggle<CR>

" Try to automatically detect indentation settings
au BufReadPost * :DetectIndent

" Markdown stuff
au FileType markdown set conceallevel=2
au FileType markdown set nocursorline
au FileType markdown set norelativenumber
let g:vim_markdown_conceal_code_blocks = 0
let g:vim_markdown_math = 1
let g:vim_markdown_strikethrough = 1
let g:vim_markdown_folding_disabled = 1
let g:vim_markdown_new_list_item_indent = 2
let g:vim_markdown_autowrite = 1

" HTML stuff
" Prevent delimitMate from conflicting with closetag
au FileType html,xml let b:delimitMate_matchpairs = "(:),[:],{:}"

" Node stuff
au FileType javascript set makeprg=npm\ build\
au FileType javascript nmap <F4> :call RunInShell("clear; npm run lint\n")<CR>
au FileType javascript nmap <F5> :call RunInShell("clear; npm start\n")<CR>
au FileType javascript nmap <F6> :call RunInShell("clear; npm test\n")<CR>
au FileType javascript nmap <F7> :call RunInShell("clear; npm run build\n")<CR>

au FileType typescript set makeprg=npm\ build\
au FileType typescript nmap <F4> :call RunInShell("clear; npm run lint\n")<CR>
au FileType typescript nmap <F5> :call RunInShell("clear; npm start\n")<CR>
au FileType typescript nmap <F6> :call RunInShell("clear; npm test\n")<CR>
au FileType typescript nmap <F7> :call RunInShell("clear; npm run build\n")<CR>

" Prevent delimitMate from conflicting with closetag in jsx/tsx regions
au FileType javascriptreact,typescriptreact call OnSyntaxChange#Install('JsxRegion', '^jsxRegion$', 0, 'a')
au FileType javascriptreact,typescriptreact au User SyntaxJsxRegionEnterA let delimitMate_matchpairs = "(:),[:],{:}" | DelimitMateReload
au FileType javascriptreact,typescriptreact au User SyntaxJsxRegionLeaveA let delimitMate_matchpairs = "(:),[:],{:},<:>" | DelimitMateReload
" Enable closetag in jsx/tsx
let g:closetag_filenames = '*.html,*.xhtml,*.phtml,*.jsx,*.tsx'
let g:closetag_xhtml_filenames = '*.xhtml,*.jsx,*.tsx'
let g:closetag_regions = {
	\ 'javascriptreact': 'jsxRegion',
	\ 'typescriptreact': 'jsxRegion,tsxRegion',
\ }
au FileType javascriptreact,typescriptreact set makeprg=npm\ build\
au FileType javascriptreact,typescriptreact nmap <F4> :call RunInShell("clear; npm run lint\n")<CR>
au FileType javascriptreact,typescriptreact nmap <F5> :call RunInShell("clear; npm start\n")<CR>
au FileType javascriptreact,typescriptreact nmap <F6> :call RunInShell("clear; npm test\n")<CR>
au FileType javascriptreact,typescriptreact nmap <F7> :call RunInShell("clear; npm run build\n")<CR>

" Rust stuff
au FileType rust set makeprg=cargo\ build\ -j\ 12
au FileType rust nmap <leader>rt :call RunInShell("clear; cargo test\n")<CR>
au FileType rust nmap <leader>rr :call RunInShell("clear; env RUST_BACKTRACE=1 cargo run\n")<CR>
au FileType rust nmap <leader>rc <F5>
au FileType rust nmap <F5> :call RunInShell("clear; cargo build -j 12\n")<CR>
au FileType rust nmap <F6> :call RunInShell("clear;cd " . expand("%:p:h") . ";rustc " . expand("%:t") . ";set -a nvim_rust_filename (basename " . expand("%:t") . " .rs);./$nvim_rust_filename;rm $nvim_rust_filename;set -e nvim_rust_filename\n")<CR><CR>

if has('nvim') || has('termguicolors')
	" True Color support
	set termguicolors
endif

let g:tokyonight_style = "night"
colorscheme tokyonight

set switchbuf=useopen,vsplit
set hidden
set nobackup
set nowritebackup
set cmdheight=2
set updatetime=300
set shortmess+=c
set signcolumn=yes
set shell=/usr/bin/fish
set showmatch
set number relativenumber
set formatoptions+=o
set ts=3
set sw=3
set noet
set listchars=tab:\𑗄\ \ ,trail:·,nbsp:·
set list
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
