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
- **Intent level is a contract.** How much I delegate is signaled by how I phrase the ask, and I can force it with a prefix: `d:` = fully delegated (skip the pause below, don't offer options, return only the finished verified result, or a blocking Steering question that quotes the instruction it questions and names the default you'll take); `b:` = brainstorm (prose only, touch no files); `p:` = plan (produce the plan, stop before implementation). Never come back at a lower level than I engaged at — option-picking on a delegated task, or reopening "is this a good idea" prose on a reviewed plan, is the failure mode. Every question you do ask ships with a recommended default.
- **When I start describing a new feature, non-trivial change, or architectural decision** (shaping-level, no marker): pause instead of jumping to code. State intent as you understood it, ask 1-3 clarifying questions if anything is ambiguous, sketch 2 approaches (narrowest fix vs. semantically cleanest), recommend one, and wait for go-ahead before editing files. Don't dive in while I'm still explaining.
- **Bug fixes: root cause first.** Before editing, state the root cause in one line and how you confirmed it — reproduction, log trace, query, or flagged as unverified hypothesis. Before pushing, re-run the failing reproduction and show it passes; lint/typecheck alone don't count as "validated."

## Context & Memory
- **Canonical memory store is `~/ai-context/`**, managed with the `/memory` skill. This is the user/global tier and is always loaded.
- **Routing — decide scope before saving any memory:**
  - Global / cross-repo facts (workflow, comms, approval rules, hiring, preferences) → `~/ai-context/` via `/memory`.
  - Project-specific facts → that project's native store at `~/.claude/projects/<encoded-cwd>/memory/` (the harness auto-loads its `MEMORY.md` only when working in that project).
  - Never store the same fact in both tiers; never put a global fact in a project store. When unsure, treat it as global.
- **Override the harness default:** the system prompt suggests saving memory under `~/.claude/projects/<cwd>/memory/` (e.g. the `-Users-gaby` home scope). Do NOT route *global* memory there — the home scope is not loaded in project sessions, which is what caused store divergence. Global memory goes to `~/ai-context/`.
- Memory index (always loaded — context files and learned memories): @~/ai-context/INDEX.md
- Use `/memory` skill to save, update, or clean up memories

@RTK.md
