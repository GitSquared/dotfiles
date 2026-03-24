---
name: kondo-blast
description: Pick 5 small bugs or kondos from the Notion backlog and fix them in parallel with a team of agents. Use when the user says "kondo blast", "blast kondos", "batch fix bugs", "clean up backlog", or wants to knock out several small tasks at once.
argument-hint: "[number of tasks, default 5]"
user-invocable: true
allowed-tools: Agent, Bash, Read, Grep, Glob, Edit, Write, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, mcp__notion__notion-query-database-view, mcp__notion__notion-fetch, mcp__notion__notion-update-page
---

# Kondo Blast: Batch Fix Bugs & Kondos

Pick small-to-medium bugs and kondos from the Notion backlog, confirm the hit list, then spawn a team of agents to fix them in parallel and open draft PRs.

> **Org-specific config**: Consult your organizational context for the "Pick Bugs & Kondos" Notion view URL, monorepo package map, PR conventions (task linking format), and your Notion user ID.

## Step 1: Query the backlog

Query the "Pick Bugs & Kondos" view from the organizational context. This view already filters for tasks in your domains that are incomplete and either unassigned or assigned to you.

From the results, filter for tasks that match ALL of:
- **Type** is "Bug" or "Kondo"
- **Size** is "XS - <1 hour", "S - ~1 hour", or "M - few hours" (exclude L, Design needed, and unset)
- **Status** is "Not started" (prefer untouched tasks)

Sort candidates by:
1. Priority ascending (P0 first)
2. Size ascending (XS first, then S, then M)
3. Feedback count descending (more-reported issues first)

Pick the top N tasks (default 5, or the number from `$ARGUMENTS` if provided).

## Step 2: Fetch task details

For each candidate, use `notion-fetch` to read the full task page. Extract:
- **`userDefined:ID`** (the task number, e.g., `42` means `PT-42`). This is critical for PR linking.
- **Notion page URL** (for the agent to reference)
- Task name and description
- Domain
- Priority and size
- Related feedbacks or customer mentions
- Any linked Slack threads or source URLs for additional context

## Step 3: Present the hit list

Show a table of selected tasks:

```
## Kondo Blast: Hit List

| # | ID | Task | Type | Size | Priority | Domain |
|---|-----|------|------|------|----------|--------|
| 1 | 42  | Fix tooltip overflow on /products | Bug | S | P2 | /products |
| 2 | 87  | Remove deprecated CSV export path  | Kondo | XS | P3 | /exports |
| ...
```

Include a one-line summary of each task's description if available.

Use `AskUserQuestion` to confirm:

> **Ready to blast these {N} tasks?**

Options:
- "Blast them all" (Recommended): Fix all listed tasks in parallel
- "Let me pick": Select which ones to work on
- "Reshuffle": Query again with different criteria (e.g., different domain, type, or size)

If "Let me pick", present each task and let the user include/exclude.

## Step 4: Spawn the fix team

Create a team with `TeamCreate`:
- team_name: `kondo-blast`
- description: `Batch fixing {N} bugs/kondos in parallel`

For each confirmed task, create a `TaskCreate` entry, then spawn an Agent with:
- `isolation: "worktree"` for a clean working copy
- `team_name: "kondo-blast"`
- `name`: `fix-{task_id}` (e.g., `fix-42`)

Each agent receives this prompt (fill in the task-specific details):

```
You are fixing a bug/kondo task from the backlog. Work in this worktree.

## Task
- Task ID: PT-{numeric_id} (from the userDefined:ID field)
- Notion Page URL: https://www.notion.so/{notion_page_id_without_dashes}
- Title: {name}
- Type: {type}
- Description: {description}
- Domain: {domain}
- Size: {size}
- Additional context: {slack_thread_or_source_url_or_feedbacks}

## Instructions
1. Run: git fetch origin main && git rebase origin/main
2. Create branch using the configured branch naming convention (e.g., gaby/fix-{short_slug})
3. Investigate the issue: search for relevant code, understand the problem
4. Implement the fix. Keep changes minimal and focused.
5. Run the configured linter on changed files
6. Run typecheck for affected packages (consult the monorepo package map)
7. Run relevant tests if they exist
8. Commit with a conventional commit message (e.g., fix(products): correct tooltip overflow)
9. Push the branch: git push -u origin <branch>
10. Open a DRAFT PR using the repo's PR template format. The PR body MUST:
    - Start with the configured task linking format (e.g., `**Notion task**: resolves PT-{numeric_id}`)
    - Follow the .github/pull_request_template.md structure exactly

Example gh command:
gh pr create --draft --title "<conventional commit title>" --body "$(cat <<'PREOF'
**Notion task**: resolves PT-{numeric_id}

## Problem

{describe the bug or tech debt issue being fixed}

## Solution

{one-line description of what was changed}

## Next steps

- [ ] Review and merge
PREOF
)"

Report back with:
- What you found and fixed (or why you couldn't fix it)
- The PR URL (or explanation if no PR was created)
- The task ID used for Notion linking
- Any concerns or follow-ups needed
```

Launch ALL agents in parallel (include all Agent tool calls in a single message).

## Step 5: Collect results and report

As agents complete, collect their results. Present a summary table:

```
## Kondo Blast: Results

| # | Task | Status | PR | Notes |
|---|------|--------|----|-------|
| 1 | Fix tooltip overflow | Fixed | #1234 | Straightforward CSS fix |
| 2 | Remove deprecated CSV path | Fixed | #1235 | Also cleaned up unused import |
| 3 | Align date format on /home | Blocked | -- | Needs design decision on locale |
| ...

**Score: {fixed}/{total} tasks blasted**
```

For each successfully opened PR, update the Notion task:
- Set **Status** to "In progress"
- Set **Assignee** to the user (look up Notion user ID from organizational context)

Use `notion-update-page` for each task page.

## Step 6: Offer next actions

Use `AskUserQuestion`:

> **What next?**

Options:
- "Review PRs": Open the PR URLs so you can review them
- "Blast more": Run another round with the next batch of tasks
- "Done": Wrap up the session
