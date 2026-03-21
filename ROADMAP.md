# AgentReplay Roadmap

## Current State (v0.1.1)

**What it is**: DevTools for replaying AI coding agent sessions — "Chrome DevTools for AI agents"

**Tech stack**: SvelteKit 2, Svelte 5, Tailwind CSS 4, TypeScript 5.9, Node adapter
**Codebase**: ~2500 lines of TypeScript/Svelte
**Providers**: Claude Code (JSONL), Cursor (SQLite)

### What's implemented
- Session auto-discovery (Claude Code ~/.claude/projects/, Cursor SQLite)
- Timeline playback with keyboard controls (arrows, space)
- Speed control (1x, 2x, 4x, 8x)
- Unified diff viewer for Edit tool calls
- Bash output with terminal-style rendering
- Code display with line numbers
- Token counting + cost estimation (Opus, Sonnet, Haiku pricing)
- Session dashboard with search, sort, infinite scroll
- Stats bar (model, duration, tools, tokens, cost)
- Dark theme, responsive layout (desktop side-by-side, mobile tabbed)
- Plan selector (API/Pro/Max/Enterprise)
- CLI entry point (`npx agent-replay`)

### What's partially working
- Cursor support: sessions load but no tool call tracking (text-only)
- Tool display: custom rendering for 10 tools, generic fallback for others

---

## Tier 1 — Indispensable

These features are the difference between "personal prototype" and "useful tool".

### 1. Search & Filter within a session
Find specific events by text or type. "Where did the agent make that error?" Filter by event type (user, assistant, thinking, tool_call) and tool name (Bash, Edit, Read...). Show match count. Cmd+F shortcut.

### 2. Export session
Share sessions as Markdown (copy to clipboard or download) or JSON. Formatted with headers per event type, code blocks for tool calls, diff blocks for edits. Users want to paste into PRs and issues.

### 3. Timeline virtualization
Virtual scroll for large sessions (10K+ events). Currently all EventCards are in the DOM. Custom implementation with fixed item height estimate, overscan buffer, spacer divs.

### 4. Syntax highlighting
Shiki-based highlighting for code blocks (Read, Write, Glob, Grep results). Infer language from file extension. Bundle common languages only (ts, js, json, py, bash, md, css, html, svelte, rust, go, yaml).

---

## Tier 2 — Differentiators

These features make AgentReplay the tool people choose over reading raw JSONL.

### 5. Session diff / comparison
Compare 2 sessions on the same task. "I re-ran the same prompt, what changed?" Side-by-side or inline diff of event sequences, tool usage, and outcomes.

### 6. Cost heatmap
Visualize where tokens are consumed in a session. Identify the most expensive tool calls and thinking blocks. Color-coded timeline overlay.

### 7. Annotations / bookmarks
Mark events with notes ("bug here", "good approach") and find them later. Persisted locally. Useful for session review and team sharing.

### 8. File tree timeline
See the file tree evolve through the session. Which files were read, modified, created — visualized as a git-history-like timeline but for a single agent session.

---

## Tier 3 — Expansion

New users and use cases.

### 9. Windsurf / Copilot providers
More providers = more users. The `SessionProvider` interface is already clean for this.

### 10. Cross-session analytics
Dashboard: total cost per day/week, most used tools, error rate, average session duration. Power users want to track their agent usage.

### 11. Full Cursor support
Parse tool inputs/results from Cursor's message format. Currently ~30% functional (text-only timeline events).

---

## What NOT to build

- Multi-user / collaboration — too early, adds complexity
- Cloud backend / SaaS — stay local-first (privacy advantage)
- VS Code extension — browser standalone is the right form factor for now
- AI-powered analysis ("the agent made an error here") — gadget, not core value
