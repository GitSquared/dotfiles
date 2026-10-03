# ai-context

Personal knowledge base and memory system for AI coding agents.

This directory is the single source of truth for persistent context that should be available across all projects and conversations.

## Structure

```
ai-context/
├── INDEX.md              # Memory index — loaded into every conversation via CLAUDE.md
├── context/              # Stable reference files (rarely change)
│   ├── org.md            # Team structure, stakeholders, Notion ID mappings
│   ├── processes.md      # Rituals, task management, Notion databases, bet updates
│   ├── comms.md          # Slack channels, meetings, documentation norms
│   └── skills-config.md  # Monorepo packages, linting, PR conventions, domains
├── memories/             # Learned behaviors — grows over time
│   ├── feedback/         # What to do / not do (corrections and confirmations)
│   ├── user/             # About me — role, preferences, knowledge
│   ├── project/          # Ongoing initiatives, decisions, deadlines
│   └── reference/        # Pointers to external resources
└── README.md             # This file
```

## How it works

### Loading context

The global `~/.claude/CLAUDE.md` includes a reference to `INDEX.md`:

```markdown
## Context & Memory
- Memory index (always loaded — context files and learned memories): @~/ai-context/INDEX.md
```

This means `INDEX.md` is injected into every Claude Code conversation. It acts as a router — listing context files to read on demand and one-line summaries of all memories.

### Memory files

Each memory is a standalone `.md` file with frontmatter:

```markdown
---
name: Short descriptive name
description: One-line description used for relevance matching
type: feedback|user|project|reference
---

The memory content.

**Why:** reason this matters
**How to apply:** when/where to use this
```

### Context files

Stable reference documents under `context/`. These contain org structure, processes, Notion IDs, and tool configuration. They change infrequently — only when the actual org/process changes.

## Semantic search with QMD

[QMD](https://github.com/tobi/qmd) provides local semantic search over this directory.

### Setup

```bash
# Install
bun install -g @tobilu/qmd

# The collection is already configured. To verify:
qmd status

# If starting fresh, register the collection:
qmd collection add ~/ai-context --name ai-context --mask "**/*.md"
qmd context add qmd://ai-context "Personal knowledge base for AI agent memory"
qmd embed
```

### Usage

```bash
# Semantic search (recommended — hybrid BM25 + vector + reranking)
qmd query "how should I handle rejection emails"

# Fast keyword search
qmd search "Notion database"

# Vector similarity only
qmd vsearch "team communication norms"

# Get a specific document
qmd get qmd://ai-context/memories/feedback/rejection-emails.md

# Re-index after adding new memories
qmd update && qmd embed
```

A QMD skill is installed at `~/.claude/skills/qmd` (symlinked from `~/.agents/skills/qmd`).

## Adding to other agents

Agents should use the **QMD CLI** for on-demand search—do not set up a separate agent integration. Give the agent shell access and tell it to:

1. Read `~/ai-context/INDEX.md` as the overview and routing guide.
2. Search relevant memories with `qmd query "your question" -c ai-context` (hybrid semantic search) or `qmd search "keywords" -c ai-context` (fast keyword search).
3. Read useful results with `qmd get qmd://ai-context/path/to/file.md`.
4. If QMD is not installed or the collection is missing, follow the setup below.

### Minimal setup for a new agent

```bash
# 1. Install qmd
bun install -g @tobilu/qmd

# 2. Check the index and collection
qmd status

# 3. If the ai-context collection is missing, register it
qmd collection add ~/ai-context --name ai-context --mask "**/*.md"
qmd context add qmd://ai-context/ "Personal knowledge base for AI agent memory"
qmd embed

# 4. Tell the agent to read ~/ai-context/INDEX.md and use the QMD CLI
#    for relevant on-demand retrieval (see instructions above)
```

## Maintenance

```bash
# After adding/editing memories, re-index:
qmd update && qmd embed

# Check health:
qmd status

# Clean caches:
qmd cleanup
```
