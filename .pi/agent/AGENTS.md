## Searching

Use `ag` (the_silver_searcher) for code searches instead of `grep`/`rg`. Line numbers and headings are on by default; `-n` means **norecurse**, not line numbers — never pass it. Useful flags: `ag -l` (files only), `-i`, `-C 5` (context), `-c` (counts), `-g '<glob>'` (filenames), `-u` (no ignores), `--rust` / `--ts` type filters.

## Personal context (`~/ai-context`)

When a request would benefit from the user's established preferences, workflows, team/project context, or prior decisions, consult the personal knowledge base on demand—do not load it wholesale:

1. Use `qmd query "<question>" -c ai-context` for semantic retrieval; use `qmd search "<keywords>" -c ai-context` for exact terms.
2. Read relevant hits with `qmd get qmd://ai-context/<path>`; use `~/ai-context/INDEX.md` as the topic/file map.
3. Apply retrieved context when relevant, but treat it as user-specific and potentially sensitive. Do not copy it into public artifacts, project files, or messages to others unless the user asks. Verify potentially stale facts against current sources.
4. If QMD is unavailable or the collection is missing, say so and fall back to reading `~/ai-context/INDEX.md` and the relevant files directly. Do not configure an MCP server.
5. Do not create or edit memory entries unless the user asks to save/update something.
