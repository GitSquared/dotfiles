---
name: rebase
description: Rebase the current branch on main
---

Pull the latest `main` and rebase the current branch onto it.

Steps:
1. `git fetch origin main`
2. `git rebase origin/main`
3. If conflicts occur:
   - Show the conflicting files and a summary of what's conflicting
   - Attempt to resolve obvious conflicts (e.g., lock files, import ordering)
   - For non-trivial conflicts, pause and ask for guidance — show both sides
4. After a successful rebase, show `git log --oneline main..HEAD` to confirm the result.
