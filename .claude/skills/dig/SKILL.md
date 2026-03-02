---
name: dig
description: Investigate a topic (bug, feature, concept) in an isolated worktree. Pre-analyzes the codebase and surfaces key findings with options. Use like /dig notion-url, /dig "performance issues in X", /dig "how does Y work".
---

Pre-analyze a topic before the user dives in. Set up an isolated workspace, do surface-level investigation, and present findings with actionable options.

Topic: $ARGUMENTS

## Phase 1 — Parse the Topic

Determine what kind of input was provided:

- **Notion URL** (contains `notion.so`): Fetch the Notion page to extract the task title, description, and any linked context. Use the `notion-fetch` MCP tool. Extract keywords and scope from the task content.
- **GitHub URL** (contains `github.com`): Use `gh` CLI to fetch issue/PR details. Extract the problem statement and any referenced files/code.
- **Free-text description**: Use the text directly as the investigation brief. Extract keywords, identify which subsystems or domains are likely involved.

Summarize the topic in one sentence before proceeding.

## Phase 2 — Set Up Worktree

Create an isolated worktree for this investigation:

1. Use `EnterWorktree` with a name derived from the topic (e.g., `dig-performance-explorer`, `dig-notion-12345`). Keep the name short, kebab-case, max 30 chars.
2. Confirm the worktree is active before proceeding.

## Phase 3 — Surface-Level Investigation

Run a broad but time-boxed investigation. Use the **Explore agent** for codebase searches and the **general-purpose agent** for web/external lookups. Run searches in parallel where possible.

Depending on the topic type, investigate:

### For bugs / issues:
- Search for error messages, exception types, or symptoms mentioned in the topic
- Find the relevant code paths and entry points
- Check recent commits touching those areas (`git log --oneline -20 -- <relevant-paths>`)
- Look for existing tests covering the area
- Check for related TODOs, FIXMEs, or known issues in the code

### For features / enhancements:
- Map the existing code in the relevant domain (key files, modules, patterns)
- Identify extension points and where new code would likely go
- Check how similar features were implemented elsewhere in the codebase
- Look for relevant types, interfaces, and data models

### For exploratory / "how does X work" topics:
- Trace the data flow or execution path
- Identify key files, entry points, and dependencies
- Map the module boundaries and interfaces
- Note any non-obvious patterns or gotchas

### Always:
- Cap the investigation at ~10-15 tool calls. This is a surface scan, not a deep dive.
- Focus on mapping the landscape, not solving the problem.
- Note things that smell off or surprising — these are valuable signals.

## Phase 4 — Present Findings

Structure your output as follows:

### Summary
One paragraph: what the topic is about, what area of the codebase it touches, and your initial read on complexity/risk.

### Key Files
List the 3-8 most relevant files with a one-liner about each. Use `file_path:line_number` format where specific locations matter.

### Findings
Bullet points of what you discovered. Be concrete — reference specific code, patterns, or data. Flag anything surprising or concerning.

### Open Questions
Things you couldn't determine from the surface scan that would need deeper investigation.

### Options
Present 2-4 concrete next steps the user can choose from:

1. **Investigate deeper** — Specific area(s) that need more analysis before acting. Say what you'd look at.
2. **Fix/implement directly** — If the path forward seems clear enough, outline the approach. Say what you'd change.
3. **Spike / prototype** — If the topic is exploratory, suggest a focused experiment. Say what you'd build.
4. **Punt / delegate** — If this looks like it belongs to someone else or needs more context. Say who/what.

Each option should be specific enough that the user can pick one and you can immediately act on it.

## Guidelines

- Be opinionated. Don't just list facts — give your read on the situation.
- Prefer showing code references over describing code abstractly.
- If the topic is vague, make reasonable assumptions and state them explicitly.
- Don't start fixing or implementing anything — this is reconnaissance only.
- If you find the topic is trivial (< 5 min fix), say so and propose the fix directly.
- **IMPORTANT: Do NOT clean up or remove the worktree after finishing.** The whole point is to leave the user in the worktree, ready to start working. The worktree must persist after this skill completes.
