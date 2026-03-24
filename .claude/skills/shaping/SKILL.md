---
name: shaping
description: Research your product domains to suggest bet topics for the next cycle. Analyzes bugs, kondos, feedback, and existing draft bets to propose actionable bet pitches. Use when the user says "shaping", "suggest bets", "what should we build next", "prepare for shaping", "bet ideas", or is preparing for a shaping session or betting table.
user-invocable: true
allowed-tools: Agent, Bash, Read, Grep, Glob, AskUserQuestion, mcp__notion__notion-query-database-view, mcp__notion__notion-fetch, mcp__notion__notion-search
---

# Shaping: Suggest Bet Topics for Next Cycle

Analyze your product domains' bug backlog, kondo debt, customer feedback, and existing draft bets to surface compelling bet ideas for the next cycle.

> **Org-specific config**: Consult your organizational context for cycle methodology, Notion view URLs (Bugs, Kondos, Bets database), product domains, and strategic priorities.

## Step 1: Gather signals from your domains

Run these data pulls in parallel:

### A. Open bugs in your domains
Query the Bugs (by domain) view from the organizational context.
Look for: clusters of bugs in the same area, high-priority bugs that keep recurring, bugs with high feedback counts.

### B. Open kondos in your domains
Query the Kondos (by domain) view from the organizational context.
Look for: groups of related kondos that could be addressed together as a bet, long-standing tech debt.

### C. Product feedback
Search the Product Feedbacks database for recent feedback related to your domains. Use domain keywords from your organizational context.
Look for: recurring customer complaints, feature requests with multiple reporters.

### D. Existing draft/placeholder bets touching your domains
Search the Bets database for bets in Draft or Placeholder status that relate to your domains.

### E. Recently released/selected bets in your domains
Check the last 2-3 cycles for bets that touched your domains. Understand what was just shipped to avoid re-proposing solved problems and to identify natural follow-ups.

## Step 2: Identify themes

Group the signals into themes. A theme is a cluster of related issues/feedback/debt that points to a coherent problem worth solving. For each theme, note:
- **Signal count**: How many bugs, kondos, feedbacks feed into this theme?
- **User impact**: How many customers or users are affected?
- **Recurring?**: Has this area been patched before without a proper fix?
- **Strategic alignment**: Does it align with any strategic priorities from the organizational context?

## Step 3: Draft bet suggestions

For each strong theme (aim for 3-5 suggestions), draft a lightweight bet pitch:

```
### {Bet Title}

**Problem**: {1-2 sentences on what's wrong and why it matters}

**Signals**:
- {X} open bugs in {domain} (e.g., PT-42, PT-87, PT-103)
- {Y} customer feedback reports about {issue}
- {Z} kondos piling up around {area}

**Rough solution**: {2-4 sentences on the macro approach, not task-level details}

**Appetite estimate**: {1-3} (Small to Medium)

**Strategic alignment**: {which strategic priority it maps to, if any}

**Domains**: {which product domains it touches}

**Risk/Notes**: {any caveats: needs design, cross-team dependency, unknown scope, etc.}
```

Avoid grab-bags. Each suggestion should solve a specific, observable problem.

## Step 4: Present and discuss

Show the suggestions ranked by signal strength (most evidence first).

Use `AskUserQuestion`:

> **Which ideas are worth developing further?**

Options:
- "Draft in Notion": Create Placeholder bet pages in the Bets database for selected suggestions
- "Refine one": Deep-dive into a specific suggestion to flesh out the pitch
- "More signals": Dig deeper into a specific domain or theme for more evidence
- "Done": Keep the analysis for reference
