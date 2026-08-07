# Straylight agent workspace

Every Linear Agent Session receives this private `/workspace`. Repository sources
are mounted read-only under `/repositories`; other sessions' workspaces are not
mounted at all.

## Select the repository

- Use the repository named in the Linear issue, its Linear guidance, or the
  ranked repository suggestions in the task prompt.
- If the repository is ambiguous, ask in the Agent Session before editing.
- Never guess that a similarly named repository is the requested target.
- Clone the chosen source into `/workspace/<repository-name>` before editing.
  `git clone --shared /repositories/<repository-name> /workspace/<repository-name>`
  is fast and keeps all task writes inside this jail.

## Isolate implementation work

- Do not modify anything below `/repositories`; it is a shared read-only source.
- Implement only in the private clone below `/workspace`.
- Use branch `agent/<lowercase-issue-identifier>` unless the issue specifies a
  branch.
- Run the repository's relevant checks in the task worktree.

## Authority

- Reading, analysis, local edits, and local checks are allowed when requested.
- Do not push, open or merge a pull request, deploy, change external services,
  or delete a worktree unless the Linear issue or a follow-up explicitly asks.
- Never expose credentials or secret values in Linear activities.
- Report the repository, worktree, branch, changes, checks, and remaining
  decisions in the final response.
