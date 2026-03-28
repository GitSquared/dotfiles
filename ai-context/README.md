# ai-context

Personal knowledge base and memory system for AI coding agents (Claude Code, etc.).

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

### MCP server

QMD exposes an MCP server for direct agent integration:

```bash
qmd mcp  # stdio transport — plug into Claude Code or other MCP-compatible agents
```

A QMD skill is installed at `~/.claude/skills/qmd` (symlinked from `~/.agents/skills/qmd`).

## Adding to other agents

To give another AI agent access to this context:

1. **Direct file reading** — Point the agent at `~/ai-context/INDEX.md` as its entry point. It lists all context files and memories with descriptions, so the agent can read specific files on demand.

2. **QMD MCP server** — If the agent supports MCP, run `qmd mcp` and connect it. The agent gets `query`, `get`, `multi_get`, and `status` tools for semantic search over the knowledge base.

3. **QMD CLI** — For agents that can run shell commands, `qmd query "..." --json` returns structured results.

### Minimal setup for a new agent

```bash
# 1. Install qmd
bun install -g @tobilu/qmd

# 2. Verify the collection exists
qmd status

# 3. If not, set it up
qmd collection add ~/ai-context --name ai-context --mask "**/*.md"
qmd context add qmd://ai-context "Personal knowledge base for AI agent memory"
qmd embed

# 4. Point the agent's system prompt at ~/ai-context/INDEX.md
#    or connect it to `qmd mcp` via MCP
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
