---
name: oncall-triage
description: Triage oncall issues by cross-referencing Sentry errors in your domains with open Notion tasks, flagging untracked problems. Use when the user says "oncall triage", "what's broken", "triage my domains", "check sentry", or wants to see what needs attention in their product areas.
user-invocable: true
allowed-tools: Agent, Bash, Read, Grep, Glob, AskUserQuestion, mcp__notion__notion-query-database-view, mcp__notion__notion-fetch, mcp__notion__notion-search, mcp__notion__notion-create-pages, mcp__sentry__search_issues, mcp__sentry__get_issue_details, mcp__sentry__search_events
---

# Oncall Triage: Surface Untracked Issues

Cross-reference Sentry errors in your product domains with open Notion tasks to find issues nobody has filed a ticket for yet.

> **Org-specific config**: Consult your organizational context for product domains, Eng Referent ID, Notion view URLs, and oncall conventions.

## Step 1: Identify domains to scan

Look up your product domains from the organizational context (Eng Referent page ID and domain list). Map these to likely Sentry search terms: route names, module names, service names.

## Step 2: Pull recent Sentry issues

Use Sentry MCP tools to search for recent unresolved issues. Run multiple searches in parallel:

1. Search for unresolved issues in the main project, sorted by frequency or last seen
2. Filter for issues seen in the last 7 days
3. Focus on issues that match your domain keywords

For each issue, extract:
- Issue title and ID
- Event count and affected user count
- First seen / last seen
- Stacktrace summary (key file paths)
- Tags (URL patterns, browser, etc.)

## Step 3: Pull open Notion bugs

Query the Bugs (by domain) view from the organizational context.

This view shows open bugs grouped by domain. Extract all bug titles, descriptions, and any linked Sentry/source URLs.

## Step 4: Cross-reference

For each Sentry issue:
1. Check if a Notion bug already exists that matches (by error message, title similarity, or linked Sentry URL)
2. Classify as:
   - **Tracked**: Already has a matching Notion task
   - **Untracked**: No matching Notion task found
   - **Stale**: Has a Notion task but hasn't been seen in Sentry recently (might be fixed)

## Step 5: Present triage report

```
## Oncall Triage Report

### Untracked Issues (need tickets)
| # | Sentry Issue | Events (7d) | Users | Domain | Severity |
|---|-------------|-------------|-------|--------|----------|
| 1 | TypeError in MetricsService.query | 142 | 23 | Metrics v2 | High |
| 2 | 404 on /exports/dpp endpoint | 38 | 5 | /exports | Medium |
| ...

### Tracked Issues (already in Notion)
| Sentry Issue | Notion Task | PT | Status |
|-------------|-------------|-----|--------|
| ProductList render error | Fix product list crash | PT-156 | Not started |
| ...

### Possibly Fixed (stale Notion bugs)
| PT | Task | Last Sentry event | Status |
|----|------|--------------------|--------|
| PT-89 | Explorer timeout on large datasets | >30d ago | Not started |
| ...
```

## Step 6: Offer actions

Use `AskUserQuestion`:

> **What would you like to do?**

Options:
- "File tickets": Create Notion tasks for untracked issues (sets Type=Bug, Domain, Priority based on severity, and adds Sentry link as Source URL)
- "Close stale": Mark possibly-fixed bugs as "Won't do" with a note that Sentry shows no recent events
- "Dig into one": Pick a specific issue to investigate deeper with `/dig`
- "Done": Keep the report for reference
