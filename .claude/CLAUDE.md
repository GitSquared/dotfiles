# Global Instructions

## About Me
- Gabriel Saillard (Gaby), Senior SWE / Team Lead at Carbonfact
- Surface team lead — frontend, APIs, data warehouse
- Stack: TypeScript, React, Node.js

## Git Workflow
- Branch naming: `gaby/<3-word-description>`
- Conventional commits for PR titles. In monorepos use `scope` or `scope/feature`.
- Always rebase on `main` before opening a PR
- One logical change per commit

## Preferences
- Use bun when a JS package manager is needed
- Direct, concise communication — no corporate fluff
- Strong opinions, weakly held — challenge me if something looks off
- Don't over-engineer. Simplest working solution wins.
- When reviewing code: prioritize correctness and simplicity over cleverness

## Workflow
- **Intent level is a contract.** How much I delegate is signaled by how I phrase the ask, and I can force it with a prefix: `d:` = fully delegated (skip the pause below, don't offer options, return only the finished verified result, or, only when no reasonable default can be inferred from everything I've said, a blocking Steering question that quotes the instruction it questions and says what's missing); `b:` = brainstorm (prose only, touch no files); `p:` = plan (produce the plan, stop before implementation). Never come back at a lower level than I engaged at — option-picking on a delegated task, or reopening "is this a good idea" prose on a reviewed plan, is the failure mode. If a reasonable default follows from my total intent, take it and file it as an assumption on the status page (with what breaks if it's wrong) instead of asking.
- **When I start describing a new feature, non-trivial change, or architectural decision** (shaping-level, no marker): pause instead of jumping to code. State intent as you understood it, ask 1-3 clarifying questions if anything is ambiguous, sketch 2 approaches (narrowest fix vs. semantically cleanest), recommend one, and wait for go-ahead before editing files. Don't dive in while I'm still explaining.
- **Consequential sessions keep a status page.** A session that opens a PR, changes more than 50 lines, or runs more than 5 real build/brainstorm turns keeps one Artifact per the `session-status` skill, triaging each turn's signals with the ISA-18.2 questions. The page is the report: after a page update, chat is three lines at most (errors, failing output and destructive-action confirmations keep full content), and the page's status (🔴 blocked > 🟢 qa > 🟠 review > 🔵 running) replaces any chat-ending status line. Waiting on CI, the merge queue or bots is running, not blocked.
- **Bug fixes: root cause first.** Before editing, list up to 3 candidate causes, each with the check that would refute it (a query, log line, repro, or the screenshot in the report), and run those checks. State the surviving root cause in one line with its evidence, or file it as an assumption on the status page that names the check that would refute it. Before pushing, re-run the failing reproduction and show it passes; lint/typecheck alone don't count as "validated." Only report an edit as done once it's confirmed on disk or in the diff.

- **Scope and cost.** Screenshots only for visible UI changes, never for copy, tokens, flags or refactors. Plan only the next iteration, not the whole bet. At most 4 parallel agents, grouped so their files don't overlap. Emission-factor and methodology changes are pure expansions: never change the semantics of an existing factor unless asked.
- **PR watching belongs to the app.** After opening a PR (or pushing to one), bind it and turn on the app's auto-fix monitor (`mcp__ccd_pr__set_monitor` with `auto_fix`): standing approval for every PR. The monitor never fires on green, so after each push run one bounded background wait for the checks to settle (the `babysit-pr` fallback command), and no other polling or scheduled wakeups.

## Context & Memory
- **Canonical memory store is `~/ai-context/`**, managed with the `/memory` skill. This is the user/global tier and is always loaded.
- **Routing — decide scope before saving any memory:**
  - Global / cross-repo facts (workflow, comms, approval rules, hiring, preferences) → `~/ai-context/` via `/memory`.
  - Project-specific facts → that project's native store at `~/.claude/projects/<encoded-cwd>/memory/` (the harness auto-loads its `MEMORY.md` only when working in that project).
  - Never store the same fact in both tiers; never put a global fact in a project store. When unsure, treat it as global.
- **Override the harness default:** the system prompt suggests saving memory under `~/.claude/projects/<cwd>/memory/` (e.g. the `-Users-gaby` home scope). Do NOT route *global* memory there — the home scope is not loaded in project sessions, which is what caused store divergence. Global memory goes to `~/ai-context/`.
- Memory index (always loaded — context files and learned memories): @~/ai-context/INDEX.md
- Use `/memory` skill to save, update, or clean up memories
