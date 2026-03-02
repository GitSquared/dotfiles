---
name: review
description: Review and address comments on a pull request
---

Review pull request #$ARGUMENTS and address pending comments. Be proactive — fix what you can, flag what needs human judgment.

## Gather Context
1. Check out the PR: `gh pr checkout $ARGUMENTS`
2. Read the full discussion: `gh pr view -c $ARGUMENTS`
3. Review the commit history: `git log --oneline main..HEAD`
4. Check CI status: `gh pr checks $ARGUMENTS`
5. Read the diff: `git diff main...HEAD`

## Review & Fix
- For each pending review comment:
  - If it's a clear fix: implement it and commit with a descriptive message referencing the comment
  - If it's ambiguous or a design decision: flag it for me with your take
- Run your own review on top — look for:
  - Correctness and edge cases
  - Unnecessary complexity
  - Security concerns (injection, auth, data leakage)
  - Missing tests for changed behavior
- Each fix should be its own commit. Validate type-checking passes before committing.

## Do NOT push. Changes will be reviewed locally first.

## Wrap Up
Provide:
1. **Executive summary** of the PR (what it does, why, risk level)
2. **Per-comment list**: what you addressed, how, and why — and what you left for me
3. **Your own findings**: anything the original reviewers missed

When I approve, push to the remote and reply to each addressed review comment with a short explanation and commit link.
