---
name: dig
description: Investigate a bug report, error, or link quickly in an isolated worktree. Use when the user says "dig into", "investigate", "look into this bug", "what's causing", or provides a bug report/error/Sentry link to triage.
argument-hint: "<bug description, error message, Sentry link, or issue URL>"
user-invocable: true
allowed-tools: Agent, Bash, Read, Grep, Glob, AskUserQuestion
---

# Dig: Quick Bug Investigation

Spin up an isolated investigation of a bug report, error, or issue link. Return findings fast with options to go deeper or start a fix.

## Input

`$ARGUMENTS` contains the bug report, error message, link (Sentry, GitHub issue, Slack thread), or description to investigate.

If `$ARGUMENTS` is empty, use `AskUserQuestion` to ask:
> What should I investigate? Paste a bug report, error message, Sentry link, or describe the issue.

## Step 1: Gather context from the input

Based on the input type, extract context before investigating code:

- **Sentry link**: Use Sentry MCP tools to fetch issue details, stacktrace, tags, and recent events.
- **GitHub issue URL**: Use `gh issue view <number> --json title,body,comments` to get the full issue.
- **Slack link**: Use Slack MCP tools to read the thread.
- **Error message or description**: Use as-is for code search.

Identify from the gathered context:
1. **Error signature**: the exact error message, exception type, or symptom
2. **Affected area**: file paths, modules, endpoints, or features mentioned
3. **Reproduction hints**: steps, payloads, or conditions that trigger the bug

## Step 2: Investigate in an isolated worktree

Launch an Agent with `isolation: "worktree"` to investigate the codebase without polluting the current working tree. The agent should:

1. Fetch and rebase on the latest `origin/main` before starting
2. Search for the error signature, affected files, and related code paths
3. Trace the logic to understand root cause
4. Check git blame/log for recent changes to the affected area
5. Look for related tests (or lack thereof)

Use this prompt template for the agent:

```
Investigate this bug in the codebase. Do NOT make any changes, only read and search.

## Bug Context
{gathered_context}

## Investigation Checklist
1. Run: git fetch origin main && git rebase origin/main
2. Search for the error message or key terms in the codebase
3. Read the affected files and trace the code path that leads to the bug
4. Run: git log --oneline -20 -- <affected_files> to check recent changes
5. Check for existing tests covering this code path
6. Identify the root cause or most likely candidates

## Output Format
Return your findings as:

### Root Cause
What is causing the bug (or top 2-3 candidates if uncertain).

### Affected Code
List the key files and line ranges involved.

### Recent Changes
Any recent commits that may have introduced or be related to the issue.

### Test Coverage
Whether the affected code path has tests, and what gaps exist.

### Evidence
Key code snippets or log entries that support your analysis.
```

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
- **"dig deeper"**: Launch another investigation agent focusing on a specific area, trace more code paths, or check related systems
- **"assess impact"**: Evaluate priority using Sentry (event frequency, affected users), PostHog (feature usage), and BigQuery (affected accounts/products) to estimate impact and recommend a priority (P0-P4)
- **"start fix"**: Create a working branch in the worktree and begin implementing a fix
- **"done"**: End the investigation, keep the findings for reference
