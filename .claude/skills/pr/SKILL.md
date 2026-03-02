---
name: pr
description: Create a pull request for the current branch
---

Prepare and submit a pull request for the changes on the current branch.

Steps:
1. Check `git status` — ensure the working tree is clean. If there are uncommitted changes, ask what to do.
2. Fetch and rebase on `main`:
   ```
   git fetch origin main
   git rebase origin/main
   ```
   If conflicts arise, pause and ask for guidance.
3. Verify the branch name follows the pattern `gaby/<3-word-description>`. If not, suggest renaming.
4. Review the full diff against main: `git log --oneline main..HEAD` and `git diff main...HEAD`
5. Draft the PR:
   - **Title**: Use conventional commit format (e.g., `feat(scope): short description`). In a monorepo, use the project or project/feature as scope.
   - **Body**: If there's a PR template in `.github/`, follow it. Otherwise use a concise summary + test plan.
6. Create the PR with `gh pr create`
7. Return the PR URL.

Do NOT push to `main` directly.
