---
name: review
description: Review a pull request thoroughly in an isolated worktree. Checks out the PR, reads discussion, checks CI, addresses review comments with commits, and produces an executive summary. Use when the user says "review PR", "review this PR", "help review", or provides a PR number/URL to review.
argument-hint: "<PR number or URL>"
user-invocable: true
allowed-tools: Agent, Bash, Read, Grep, Glob, Edit, Write, AskUserQuestion, SendMessage
---

# Review: Thorough PR Review Workflow

Check out a PR in an isolated worktree, review the code, address existing review comments with fix commits, validate changes, and produce an executive summary.

> **Org-specific config**: Consult your organizational context for linter command and AI reviewers to skip.

## Step 1: Identify the PR

If `$ARGUMENTS` contains a PR number or URL, use that. Otherwise, detect from the current branch:

```bash
gh pr view --json number,url,headRefName,title,body,author
```

If no PR is found, use `AskUserQuestion` to ask for the PR number.

Extract the PR number for use throughout.

## Step 2: Investigate in an isolated worktree

Launch an Agent with `isolation: "worktree"` to perform the full review. The agent should do all work inside the worktree.

Use this prompt (fill in PR-specific details):

```
You are reviewing PR #{number} in an isolated worktree. Your job is to thoroughly review the PR, address existing review comments, and produce an executive summary.

## Setup

1. Run: gh pr checkout {number}
2. Run: git fetch origin main

## Phase 1: Gather Context

Run these commands to understand the full picture:

- Read the PR description and discussion: gh pr view {number}
- Read all review comments: gh api repos/{owner}/{repo}/pulls/{number}/comments --paginate
- Read PR-level review summaries: gh api repos/{owner}/{repo}/pulls/{number}/reviews --paginate
- Check the diff against main: git log --oneline main..HEAD
- Check CI status: gh pr checks {number}

## Phase 2: Code Review

Review the actual code changes:

1. Run: git diff main...HEAD
2. Read each changed file in full to understand context (not just the diff hunks)
3. Evaluate:
   - **Correctness**: Does the code do what the PR description says? Are there logic errors?
   - **Conventions**: Does it follow project patterns (check CLAUDE.md and relevant AGENTS.md)?
   - **Performance**: Any obvious performance issues (N+1 queries, missing indexes, large payloads)?
   - **Tests**: Are changes tested? Are there gaps?
   - **Security**: Any OWASP top-10 concerns (injection, XSS, auth bypass)?
   - **i18n**: If touching frontend, are strings properly translated?

## Phase 3: Address Existing Review Comments

For each unresolved review comment thread from human reviewers:

1. Read the comment and understand what's being asked
2. **Skip comments from AI reviewers** (consult organizational context for names of AI review tools to ignore)
3. Classify as: Actionable fix | Question to answer | Nitpick | Already addressed
4. For actionable fixes:
   a. Make the change
   b. Run the configured linter on changed files
   c. Run typecheck for affected packages
   d. Commit with a clear message referencing the comment (one commit per fix)
   e. Example: git commit -m "fix: address review comment on null check in ProductService"
5. For questions: draft a reply but don't post it yet

Do NOT push commits. They will be reviewed locally first.

## Phase 4: Produce Report

Return a structured report with:

### Executive Summary
2-3 sentences on what the PR does, its quality, and readiness to merge.

### Code Review Findings
Bullet points of anything you noticed, grouped by severity:
- **Must fix**: Blocking issues
- **Should fix**: Non-blocking but important
- **Nit**: Style/preference suggestions

### Review Comments Addressed
For each comment thread you addressed:

| Comment | Author | Action | Commit |
|---------|--------|--------|--------|
| "Add null check for..." | alice | Fixed | abc1234 |
| "Why not use X?" | bob | Drafted reply | -- |
| "Missing test for..." | alice | Fixed | def5678 |

### CI Status
Current state of checks and any failures.

### Commits Made
List of fix commits created (not yet pushed).

### Draft Replies
Any reply text drafted for question-type comments (for user to review before posting).
```

## Step 3: Present results

Show the agent's report to the user. Then use `AskUserQuestion`:

> **What would you like to do?**

Options:
- "Push fixes" (Recommended): Push the fix commits to the PR branch, then reply in-thread to each addressed comment with a short explanation and commit link
- "Review commits first": Show the individual commit diffs for approval before pushing
- "Discard fixes": Drop the fix commits and keep only the review notes
- "Done": Keep the review summary, no further action
