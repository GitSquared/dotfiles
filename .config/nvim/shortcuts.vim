let mapleader = ' '

" New, write, quit/close
nmap <Leader>B :enew<CR>
nmap <Leader>w :w<CR>
nmap <Leader>q :BufferClose<CR>
nmap <Leader>Q :qa<CR>
nmap <Leader>, :close<CR>
" Editor utilities
map <Leader>z :ZenMode<CR>
map <Leader>f <cmd>lua require("flash").jump()<CR>
map <Leader>F :BufferPick<CR>
map <Leader>b :Telescope buffers<CR>
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
nmap <Leader>/ :Telescope current_buffer_fuzzy_find<CR>
nmap <Leader>p :Telescope smart_open<CR>
nmap <Leader>C :TSContextToggle<CR>
nmap <Leader>l :Outline<CR>
nmap <silent><Leader>o :lua require'telescope.builtin'.live_grep{ shorten_path = true, word_match = "-w", only_sort_text = true }<CR>
nmap <Leader>s :call CustomTermToggle(g:floaterm_shell)<CR>
nmap <Leader>d :call CustomTermToggle('ranger')<CR>
nmap <leader>D :NvimTreeToggle<CR>
nmap <Leader>g :LazyGit<CR>
nmap <Leader>t :lua require('trouble').toggle('diagnostics')<CR>
nmap <silent><Esc> :cclose<CR>
" LSP features
nmap <Leader>r :IncRename 
nmap <Leader>c :lua vim.lsp.buf.code_action()<CR>
nmap <Leader>e :lua require('conform').format({ async = true })<CR>
" Below is also <C-W>d in neovim 0.10
nmap <silent> KE :lua vim.diagnostic.open_float()<CR>
nmap <silent> gd :Telescope lsp_definitions<CR>
nmap <silent> gy :Telescope lsp_type_definitions<CR>
nmap <silent> gi :Telescope lsp_implementations<CR>
nmap <silent> gr :Telescope lsp_references<CR>
imap <silent><script><expr> <A-Tab> copilot#Accept("\<CR>")
" Git integration
nmap gb :Telescope git_bcommits<CR>
nmap gk :Gitsigns prev_hunk<CR>
nmap gj :Gitsigns next_hunk<CR>
map <Leader>gy :GitLink<CR>
map <Leader>gb :GitLink blame<CR>
" Terminal mode shortcuts
tmap <A-Esc> <C-\><C-N><CR>
