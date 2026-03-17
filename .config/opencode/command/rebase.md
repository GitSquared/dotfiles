---
description: Rebase current worktree on main branch
agent: overseer
---

Pull the `main` branch, then rebase the current branch on the `main` branch, making sure to resolve conflicts to integrate newer changes into your current work.
Pause and ask questions if conflicts seem too large or resolution unclear.

Once you have rebased the branch, run dependency install scripts for the project's package managers, and copy any `.env.example` files in the current project and its direct sub-folders to `.env` equivalents next to the examples files.
