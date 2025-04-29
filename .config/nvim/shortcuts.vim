let mapleader = ' '
let maplocalleader = ','

" QoL
" Keep cursor focused in center of screen
nmap n nzz
nmap N Nzz
nmap <C-d> <C-d>zz
nmap <C-u> <C-u>zz
" Move selection around
vmap J :m '>+1<CR>gv=gv
vmap K :m '<-2<CR>gv=gv
" Paste over without overwriting register
xmap p "_dP

" New, write, quit/close
nmap <Leader>B :enew<CR>
nmap <Leader>w :w<CR>
nmap <Leader>q :BufferClose<CR>
nmap <Leader>Q :qa<CR>
nmap <Leader>, :close<CR>
" Editor utilities
map <Leader>z :ZenMode<CR>
map <Leader>F :BufferPick<CR>
map <Leader>b :FzfLua buffers<CR>
map <F9> :set hlsearch!<CR>
map <F10> :set invrelativenumber<CR>
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
nmap <A-Up> <C-W>K
nmap <A-Down> <C-W>J
nmap <A-Left> <C-W>H
nmap <A-Right> <C-W>L
" Resize windows
nmap <Leader>= <C-W>=
nmap <S-Up> :resize +3<CR>
nmap <S-Down> :resize -3<CR>
nmap <S-Left> :vertical resize -3<CR>
nmap <S-Right> :vertical resize +3<CR>
" Toggle side panels
nmap <Leader>/ :FzfLua lgrep_curbuf<CR>
nmap <Leader>p :FzfLua files<CR>
nmap <Leader>C :TSContextToggle<CR>
nmap <Leader>l :Outline<CR>
nmap <silent><Leader>o :FzfLua live_grep_native<CR>
nmap <Leader>s :call CustomTermToggle(g:floaterm_shell)<CR>
nmap <Leader>d :Yazi<CR>
nmap <leader>D :NvimTreeToggle<CR>
nmap <Leader>g :LazyGit<CR>
nmap <Leader>t :lua require('trouble').toggle('diagnostics')<CR>
nmap <Leader>ai :AvanteFocus<CR>
nmap <silent><Esc> :cclose<CR>
" LSP features
nmap <Leader>r :IncRename 
nmap <Leader>c :lua vim.lsp.buf.code_action()<CR>
nmap <Leader>e :lua require('conform').format({ async = true })<CR>
" Below is also <C-W>d in neovim 0.10
nmap <silent> KE :lua vim.diagnostic.open_float()<CR>
nmap <silent> gd :Glance definitions<CR>
nmap <silent> gy :Glance type_definitions<CR>
nmap <silent> gi :Glance implementations<CR>
nmap <silent> gr :Glance references<CR>
imap <silent><script><expr> <A-Tab> copilot#Accept("\<CR>")
" Git integration
nmap gb :Gitsigns blame<CR>
nmap gk :Gitsigns prev_hunk<CR>zz
nmap gj :Gitsigns next_hunk<CR>zz
map <Leader>gy :GitLink<CR>
nmap gis :Octo issue list<CR>
nmap gpr :Octo pr search review-requested:@me is:open<CR>
" Terminal mode shortcuts
tmap <A-Esc> <C-\><C-N><CR>
