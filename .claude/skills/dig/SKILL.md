---
name: dig
description: Investigate a bug report, error, or link quickly in an isolated worktree. Use when the user says "dig into", "investigate", "look into this bug", "what's causing", or provides a bug report/error/Sentry link to triage.
argument-hint: "<bug description, error message, Sentry link, or issue URL>"
user-invocable: true
allowed-tools: Agent, Bash, Read, Grep, Glob, AskUserQuestion
---

# Dig: Quick Bug Investigation

Spin up an isolated investigation of a bug report, error, or issue link. Return findings fast with options to go deeper or start a fix.

**CRITICAL**: All codebase investigation MUST happen inside a worktree agent. The main conversation should only gather external context (Slack, Sentry, GitHub) and present results. Never search, read, or modify code in the main working tree.

## Input

`$ARGUMENTS` contains the bug report, error message, link (Sentry, GitHub issue, Slack thread), or description to investigate.

If `$ARGUMENTS` is empty, use `AskUserQuestion` to ask:
> What should I investigate? Paste a bug report, error message, Sentry link, or describe the issue.

## Step 1: Gather external context

Based on the input type, extract context using MCP tools or CLI before touching the codebase:

- **Sentry link**: Use Sentry MCP tools to fetch issue details, stacktrace, tags, and recent events.
- **GitHub issue URL**: Use `gh issue view <number> --json title,body,comments` to get the full issue.
- **Slack link**: Use Slack MCP tools to read the thread.
- **Error message or description**: Use as-is for code search.

Identify from the gathered context:
1. **Error signature**: the exact error message, exception type, or symptom
2. **Affected area**: file paths, modules, endpoints, or features mentioned
3. **Reproduction hints**: steps, payloads, or conditions that trigger the bug

## Step 2: Investigate in an isolated worktree

Launch an **Explore** agent with `isolation: "worktree"` to investigate the codebase. Keep the agent prompt **concise** (under 2000 chars) to avoid prompt-too-long errors. Summarize the gathered context into a short bug description rather than pasting raw thread contents.

The agent should:
1. Fetch and rebase on the latest `origin/main` before starting
2. Search for the error signature, affected files, and related code paths
3. Trace the logic to understand root cause
4. Check git blame/log for recent changes to the affected area
5. Look for related tests (or lack thereof)

Use this prompt template for the agent:

```
Investigate this bug. Read-only, no changes.

## Bug
{2-3 sentence summary of the issue}

## Key terms to search
{error messages, function names, file paths mentioned}

## Checklist
1. git fetch origin main && git rebase origin/main
2. Search for the key terms in the codebase
3. Read affected files and trace the code path
4. git log --oneline -20 -- <affected_files> for recent changes
5. Check for existing test coverage

## Return format
### Root Cause
What causes the bug (or top 2-3 candidates).
### Affected Code
Key files and line ranges.
### Recent Changes
Relevant commits that may have introduced or relate to the issue.
### Test Coverage
Whether the affected code path has tests, and gaps.
### Evidence
Key code snippets supporting your analysis.
```

**If the agent fails** (prompt too long, timeout, etc.): retry with an even shorter prompt. Do NOT fall back to investigating in the main working tree.

## Step 3: Present findings

Present a concise investigation report:

```
## Investigation: {title}

### Root Cause
{root_cause_explanation}

### Affected Code
{file_list_with_lines}

### Recent Changes
{relevant_commits}

### Test Coverage
{test_status}

### Complexity & Risk Assessment
- **Fix complexity**: S / M / L / XL
- **Risk level**: Low / Medium / High
- **Blast radius**: {what could break}
- **Confidence**: High / Medium / Low (in the diagnosis)
```

## Step 4: Offer next actions

Use `AskUserQuestion` to ask:

> **What would you like to do next?**

Options:
- **"dig deeper"**: Launch another worktree agent focusing on a specific area, trace more code paths, or check related systems. Must use `isolation: "worktree"`.
- **"assess impact"**: Evaluate priority using Sentry (event frequency, affected users), PostHog (feature usage), and BigQuery (affected accounts/products) to estimate impact and recommend a priority (P0-P4). This can run in the main conversation since it only queries external services.
- **"start fix"**: Launch a general-purpose agent with `isolation: "worktree"` to create a working branch and implement the fix. The agent should rebase on origin/main, create a branch, implement, lint, typecheck, and test. Review the agent's worktree diff before merging it back.
- **"done"**: End the investigation, keep the findings for reference.
