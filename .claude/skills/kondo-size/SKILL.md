---
name: kondo-size
description: Estimate and set size for unsized bugs and kondos in your product domains on Notion. Use when the user says "kondo size", "size tasks", "size the backlog", "estimate unsized tasks", or wants to triage unsized bugs/kondos.
argument-hint: "[max number of tasks to size, default 20, hard max 50]"
user-invocable: true
allowed-tools: Agent, Bash, Read, Grep, Glob, AskUserQuestion, TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, mcp__notion__notion-query-database-view, mcp__notion__notion-fetch, mcp__notion__notion-update-page
---

# Kondo Size: Batch-Size Unsized Backlog Tasks

Find unsized bugs and kondos in your product domains, estimate their size via parallel agent teams, and write the results back to Notion.

> **Org-specific config**: Consult your organizational context for the "Pick Bugs & Kondos" Notion view URL.

## Step 1: Query the backlog

Query the "Pick Bugs & Kondos" view from the organizational context.

From the results, filter for tasks matching ALL of:
- **Type** is "Bug" or "Kondo"
- **Status** is "Not started" or "In progress" (not complete)
- **Size** is empty (unset)

Respect the limit:
- Default: 20 tasks
- If `$ARGUMENTS` provides a number, use that (minimum 1)
- **Hard maximum: 50 tasks.** If more unsized tasks exist, note the overflow count but stop at 50.

Sort candidates by:
1. Priority ascending (P0 first)
2. Feedback count descending (more-reported first)
3. Created at ascending (oldest first)

## Step 2: Fetch task details

For each candidate, use `notion-fetch` to read the full task page. Extract:
- **`userDefined:ID`** (the PT number)
- Task name and description
- Domain
- Priority
- Type (Bug vs Kondo)
- Any linked feedbacks, Slack threads, or source URLs

## Step 3: Present candidates

Show a summary table:

```
## Kondo Size: {N} unsized tasks found

| # | PT | Task | Type | Priority | Domain |
|---|-----|------|------|----------|--------|
| 1 | PT-42 | Fix tooltip overflow | Bug | P2 | /products |
| 2 | PT-87 | Remove deprecated CSV path | Kondo | P3 | /exports |
| ...

{overflow_count} additional unsized tasks not included (hit limit of {max}).
```

Use `AskUserQuestion`:

> **Size these {N} tasks?**

Options:
- "Size them all" (Recommended): Estimate all listed tasks
- "Let me pick": Select which ones to size
- "Cancel": Abort

## Step 4: Spawn sizing team

Create a team with `TeamCreate`:
- team_name: `kondo-size`
- description: `Batch sizing {N} unsized bugs/kondos`

Process tasks in **batches of 5**. For each batch, spawn 5 Agents in parallel:
- `team_name: "kondo-size"`
- `name`: `size-pt-{id}` (e.g., `size-pt-42`)

Each agent receives this prompt:

```
Do a quick complexity estimation for this Notion task. Keep it fast and surface-level.
Do NOT make any changes to the codebase.

## Task
- PT-{id}: {name}
- Type: {type}
- Description: {description}
- Domain: {domain}
- Additional context: {slack_thread_or_feedbacks}

## What to Check
1. Search for keywords from the task title/description in the codebase
2. Identify the key files and modules that would likely be touched
3. Check how many systems/layers are involved (frontend, backend, DB, BigQuery, etc.)

## Assess These Dimensions (briefly)
- **Scope**: How many files/systems would this touch? (1 file vs cross-cutting)
- **Clarity**: Is the problem obvious from the description, or does it need discovery?
- **Risk**: Could a fix here break other things? (isolated vs high blast radius)

## Map to a Size
- **XS - <1 hour**: Single, obvious change in one place. No unknowns.
- **S - ~1 hour**: Small scope, clear problem, maybe 2-3 files.
- **M - few hours**: Multiple layers or some uncertainty. Non-trivial coordination.
- **L - few days**: Broad footprint, significant unknowns, or cross-team work.
- **Design needed**: Can't size until design clarifies the problem or approach.

## Return Format
Return EXACTLY this format:

SIZE: {XS - <1 hour | S - ~1 hour | M - few hours | L - few days | Design needed}
RATIONALE: {1-3 sentences on what you found that drove the estimate. Reference specific files or patterns.}
FILES: {comma-separated list of key files that would be touched, max 5}
```

Wait for all 5 agents in a batch to complete before starting the next batch. Track progress via tasks.

## Step 5: Write results to Notion

For each sized task:

1. **Set the Size property** on the Notion task page via `notion-update-page` using the exact size label returned by the agent (skip if agent said "too ambiguous")
2. **Append a callout block** to the task page body with the rationale:

```
> **Size estimate**
> {size} - {rationale}
> Key files: {files}
```

## Step 6: Present results

Show a summary table:

```
## Kondo Size: Results

| PT | Task | Size | Rationale |
|----|------|------|-----------|
| PT-42 | Fix tooltip overflow | S | Single CSS fix in ProductTooltip.tsx |
| PT-87 | Remove deprecated CSV path | XS | Dead code removal in exports/csv.ts |
| PT-103 | Refactor metrics query builder | M | Touches MetricsService + 3 views |
| ...

**Sized: {sized}/{total} | Skipped: {skipped} (ambiguous)**
```

## Step 7: Offer next actions

Use `AskUserQuestion`:

> **What next?**

Options:
- "Blast the small ones": Run `/kondo-blast` targeting the XS/S tasks just sized
- "Size more": Run another batch if there were overflow tasks
- "Done": Wrap up
