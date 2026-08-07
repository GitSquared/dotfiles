# Straylight agent workspace

Repositories belong in `/workspace/repos`. Issue-specific worktrees belong in
`/workspace/runs`.

## Select the repository

- Use the repository named in the Linear issue or its Linear guidance.
- If the repository is ambiguous, ask in the Agent Session before editing.
- Never guess that a similarly named repository is the requested target.

## Isolate implementation work

- Do not implement changes in a repository's default checkout.
- Create or reuse `/workspace/runs/<issue-identifier>/<repository-name>` as a Git
  worktree for an implementation task.
- Use branch `agent/<lowercase-issue-identifier>` unless the issue specifies a
  branch.
- Never edit or remove another issue's worktree.
- Run the repository's relevant checks in the task worktree.

## Authority

- Reading, analysis, local edits, and local checks are allowed when requested.
- Do not push, open or merge a pull request, deploy, change external services,
  or delete a worktree unless the Linear issue or a follow-up explicitly asks.
- Never expose credentials or secret values in Linear activities.
- Report the repository, worktree, branch, changes, checks, and remaining
  decisions in the final response.
