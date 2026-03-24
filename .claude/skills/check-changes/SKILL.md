---
name: check-changes
description: Run linting, typechecking, and tests on changed files. Use when the user says "check changes", "run checks", "validate", "lint and typecheck", or after making code changes that need validation.
user-invocable: true
allowed-tools: Bash, Read, Grep, Glob
---

# Check Changes: Validate Modified Code

Run linting, typechecking, and relevant tests on all files changed in the current working tree.

> **Org-specific config**: Consult your organizational context for the monorepo package map (path prefixes, package names, typecheck/test commands) and linter command.

## Step 1: Identify changed files

```bash
git diff --name-only HEAD
git diff --name-only --cached
git diff --name-only main...HEAD 2>/dev/null
```

Combine all results, deduplicate, and filter to only files that still exist on disk.

## Step 2: Determine affected packages

Map changed files to their workspace packages using the monorepo package map from your organizational context.

## Step 3: Run lint

Run the configured linter on all changed TypeScript/JavaScript files. Report any remaining errors after autofix.

## Step 4: Run typechecks

For each affected package, run its typecheck command. Run multiple packages in parallel if possible (separate Bash calls).

## Step 5: Run relevant tests

For each affected package, check if there are test files colocated with the changed files (`.spec.ts` siblings). If yes, run the package test suite.

Skip tests if no test files are related to the changes (don't waste time running the full suite for a CSS fix).

## Step 6: Report

Present a concise summary:

```
## Check Results

| Check | Status | Details |
|-------|--------|---------|
| Lint | pass/fail | {N} files checked, {M} issues fixed, {K} remaining |
| niklas typecheck | pass/fail | {error summary if failed} |
| platform typecheck | pass/fail | {error summary if failed} |
| Tests (niklas) | pass/skip | {N} passed, {M} failed / skipped (no related tests) |

{If any failures, list the specific errors with file:line references}
```

If everything passes, confirm with a one-liner. If there are failures, list them and offer to fix.
