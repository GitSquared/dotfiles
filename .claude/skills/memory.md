---
name: memory
description: Manage the persistent memory system at ~/ai-context/. Use when the user says "remember", "forget", "memory", or when you learn something worth persisting across conversations.
user_invocable: true
---

# Memory Management Skill

Manage Gaby's persistent memory.

## Two tiers — route before saving

Memory lives in two stores. Decide scope FIRST:

| Tier | Location | Loaded | Holds |
|------|----------|--------|-------|
| **Global (canonical)** | `~/ai-context/` | every session (via CLAUDE.md `@import`) | cross-repo facts: workflow, comms, approval rules, hiring, preferences |
| **Project** | `~/.claude/projects/<encoded-cwd>/memory/` | only in that project (harness loads its `MEMORY.md`) | facts specific to one repo |

Rules across tiers:
- Never store the same fact in both. Never put a global fact in a project store. When unsure, treat it as global → `~/ai-context/`.
- Ignore the harness system-prompt suggestion to save global memory under the `-Users-gaby` home scope — it is not loaded in project sessions.
- The project tier uses the harness-native format (`MEMORY.md` index, `metadata:`/`[[wikilinks]]`). The global tier uses the format below. Don't mix conventions within a store.

The rest of this skill manages the **global tier** (`~/ai-context/`).

## Directory Structure

```
~/ai-context/
├── INDEX.md              # Router loaded via CLAUDE.md — lists all context files and memories
├── context/              # Stable reference files (org, processes, comms, skills config)
│   ├── org.md            # Team structure, stakeholders, Notion IDs
│   ├── processes.md      # Rituals, task management, databases, bet updates
│   ├── comms.md          # Slack channels, meetings, documentation
│   └── skills-config.md  # Monorepo map, PR conventions, domains, cycle methodology
├── memories/             # Learned behaviors — organized by type
│   ├── feedback/         # What to do / not do (corrections and confirmations)
│   ├── user/             # About Gaby's role, preferences, knowledge
│   ├── project/          # Ongoing initiatives, decisions, deadlines
│   └── reference/        # Pointers to external resources
└── context7-key.txt      # API key (do not modify)
```

## Operations

### Save a memory

1. Determine the type: `feedback`, `user`, `project`, or `reference`
2. Write a `.md` file in `~/ai-context/memories/{type}/` with frontmatter:
   ```markdown
   ---
   name: Short descriptive name
   description: One-line description — used to decide relevance in future conversations
   type: feedback|user|project|reference
   ---

   The memory content.

   **Why:** reason this matters
   **How to apply:** when/where to use this
   ```
3. Add a one-liner to the appropriate section of `~/ai-context/INDEX.md`

### Update a memory

1. Read the existing memory file
2. Edit it with the new information
3. Update INDEX.md if the one-liner hook changed

### Delete a memory

1. Remove the file from `~/ai-context/memories/`
2. Remove the corresponding line from INDEX.md

### List memories

Read `~/ai-context/INDEX.md` — it's the canonical index.

### Clean up memories

1. Read INDEX.md to get the full list
2. For each memory, check if it's still accurate:
   - If it names a file/function: verify it still exists
   - If it's a project memory: check if the project/initiative is still active
   - If it conflicts with current state: update or remove
3. Remove stale entries from both the file and INDEX.md

## Re-indexing

After saving, updating, or deleting memories, re-index QMD so semantic search stays current:

```bash
qmd update && qmd embed
```

## Rules

- **What to save**: Corrections, confirmed approaches, user preferences, project context, external resource pointers
- **What NOT to save**: Code patterns derivable from reading the repo, git history, things already in CLAUDE.md, ephemeral task details
- **Deduplication**: Always check INDEX.md before creating a new memory — update existing ones instead
- **Context files** (`context/*.md`): These are stable reference docs. Only modify when the org structure, processes, or skill config actually changes. Don't save transient info here.
- **Convert relative dates**: "next Thursday" → "2026-04-02" so memories remain interpretable later
