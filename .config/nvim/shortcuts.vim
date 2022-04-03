let mapleader = ' '

" New, write, quit/close
nmap <Leader>b :enew<CR>
nmap <Leader>w :w<CR>
nmap <Leader>q :BufferClose<CR>
nmap <Leader>Q :qa<CR>
nmap <Leader>, :close<CR>
" Editor utilities
map <Leader>z :ZenMode<CR>
map <Leader>f <Plug>(easymotion-bd-w)
map <Leader>F :BufferPick<CR>
map <Leader>e :EslintFixAll<CR>
map <F9> :set hlsearch!<CR>
map <F10> :set invrelativenumber<CR>
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
nmap <Leader>m :SymbolsOutline<CR>
nmap <Leader>g :Git<CR>
nmap <Leader>p :Files<CR>
nmap <Leader>o :Ag<CR>
nmap <Leader>s :call CustomTermToggle(g:floaterm_shell)<CR>
nmap <Leader>d :call CustomTermToggle('ranger')<CR>
nmap <Leader>g :call CustomTermToggle('lazygit')<CR>
nmap <Leader>h :FloatermPrev<CR>
nmap <Leader>l :FloatermNext<CR>
nmap <Leader>t :TroubleToggle<CR>
nmap <silent><Esc> :cclose<CR>
" IDE-like autocompletion and code navigation
map <Leader>r :lua vim.lsp.buf.rename()<CR>
map <Leader>c :lua vim.lsp.buf.code_action()<CR>
nmap <silent> K :lua vim.lsp.buf.hover()<CR>
nmap <silent> gd :lua vim.lsp.buf.definition()<CR>
nmap <silent> gy :lua vim.lsp.buf.type_definition()<CR>
nmap <silent> gi :lua vim.lsp.buf.implementation()<CR>
nmap <silent> gr :lua vim.lsp.buf.references()<CR>
imap <silent><script><expr> <A-Tab> copilot#Accept("\<CR>")
" Git integration
nmap gb :Gitsigns blame_line<CR>
nmap gk :Gitsigns prev_hunk<CR>
nmap gj :Gitsigns next_hunk<CR>
" Terminal mode shortcuts
tmap <C-Space> <C-\><C-N><CR>
