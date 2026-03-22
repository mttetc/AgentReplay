# AgentReplay Roadmap

## Current State (v0.2.0)

**What it is**: DevTools for replaying AI coding agent sessions — "Chrome DevTools for AI agents"

**Tech stack**: SvelteKit 2, Svelte 5, Tailwind CSS 4, TypeScript 5.9, Node adapter
**Codebase**: ~4500 lines of TypeScript/Svelte
**Providers**: Claude Code (JSONL), Cursor (SQLite), Windsurf (SQLite/JSON)

### What's implemented

**Core**
- Session auto-discovery (Claude Code, Cursor, Windsurf)
- Timeline playback with keyboard controls (arrows, space)
- Speed control (1x, 2x, 4x, 8x)
- Unified diff viewer for Edit tool calls
- Bash output with terminal-style rendering
- Code display with syntax highlighting (Shiki, 26 languages)
- Token counting + cost estimation (Opus, Sonnet, Haiku pricing)
- Session dashboard with search, sort, infinite scroll
- Stats bar (model, duration, tools, tokens, cost)
- Dark theme, responsive layout (desktop side-by-side, mobile tabbed)
- CLI entry point (`npx agent-replay`) with auto port detection

**Tier 1 — Indispensable**
- Search & filter within sessions (Cmd+F, type/tool filters, match count)
- Export sessions (Markdown, JSON, clipboard)
- Timeline virtualization (virtual scroll for 10K+ events)
- Syntax highlighting (Shiki-based, 26 languages)

**Tier 2 — Differentiators**
- Session comparison (side-by-side stats, tool butterfly chart, file overlap)
- Cost heatmap (amber intensity bars on timeline)
- Annotations/bookmarks (persistent notes per event, localStorage)
- File tree timeline (files touched, grouped by directory, click-to-jump)

**Tier 3 — Expansion**
- Windsurf provider (SQLite + JSON discovery, tool call parsing)
- Cross-session analytics dashboard (daily/weekly cost, model/provider breakdown, top projects)
- Full Cursor support (tool calls, terminal commands, file edits, code blocks, text pattern detection)

### Auto port detection
If port 3000 is occupied, the CLI automatically finds the next available port (tries up to 20 ports).

---

## What NOT to build

- Multi-user / collaboration — too early, adds complexity
- Cloud backend / SaaS — stay local-first (privacy advantage)
- VS Code extension — browser standalone is the right form factor for now
- AI-powered analysis ("the agent made an error here") — gadget, not core value
