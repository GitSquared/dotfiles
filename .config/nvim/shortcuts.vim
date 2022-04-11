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
nmap / :Telescope current_buffer_fuzzy_find<CR>
nmap <Leader>m :SymbolsOutline<CR>
nmap <Leader>p :Telescope find_files<CR>
nmap <silent><Leader>o :lua require'telescope.builtin'.live_grep{ shorten_path = true, word_match = "-w", only_sort_text = true }<CR>
nmap <Leader>s :call CustomTermToggle(g:floaterm_shell)<CR>
nmap <Leader>d :call CustomTermToggle('ranger')<CR>
nmap <Leader>g :call CustomTermToggle('lazygit')<CR>
nmap <Leader>h :FloatermPrev<CR>
nmap <Leader>l :FloatermNext<CR>
nmap <Leader>t :TroubleToggle<CR>
nmap <silent><Esc> :cclose<CR>
" IDE-like autocompletion and code navigation
map <Leader>r :lua vim.lsp.buf.rename()<CR>
map <Leader>c :Telescope lsp_code_actions<CR>
nmap <silent> K :lua vim.lsp.buf.hover()<CR>
nmap <silent> gd :Telescope lsp_definitions<CR>
nmap <silent> gy :Telescope lsp_type_definitions<CR>
nmap <silent> gi :Telescope lsp_implementations<CR>
nmap <silent> gr :Telescope lsp_references<CR>
imap <silent><script><expr> <A-Tab> copilot#Accept("\<CR>")
" Git integration
nmap gb :Gitsigns blame_line<CR>
nmap gk :Gitsigns prev_hunk<CR>
nmap gj :Gitsigns next_hunk<CR>
" Terminal mode shortcuts
tmap <C-Space> <C-\><C-N><CR>
