# Agent Replay

DevTools for replaying AI agent sessions. Browse, inspect, and debug your Claude Code and Cursor sessions with a timeline-based UI.

<!-- ![Agent Replay Screenshot](screenshot.png) -->

## What is this?

Agent Replay gives you a visual debugger for your AI coding agent sessions. It reads session data directly from your local machine (Claude Code's JSONL logs, Cursor's SQLite database) and presents them in an interactive timeline you can step through event by event.

Think of it as Chrome DevTools, but for AI agent conversations. You can see every prompt, response, tool call, file edit, and command execution in order, with syntax-highlighted diffs and output.

## Features

- **Timeline playback** — step through agent sessions event by event with keyboard controls
- **Unified diff view** — see file edits as syntax-highlighted diffs
- **Bash output rendering** — view command executions and their output
- **Token & cost tracking** — monitor input/output tokens and estimated costs per session
- **Multi-provider support** — works with Claude Code and Cursor out of the box
- **Session discovery** — automatically finds and lists all sessions from your local data
- **Stats dashboard** — session-level metrics including event count, tool calls, model used
- **Dark theme** — easy on the eyes for extended debugging sessions

## Quick Start

Run directly with npx:

```sh
npx agent-replay
```

Or install globally:

```sh
npm install -g agent-replay
agent-replay
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Development

```sh
git clone https://github.com/mttetc/agent-replay.git
cd agent-replay
npm install
npm run dev
```

The dev server starts at [http://localhost:5173](http://localhost:5173) with hot reload.

### Building

```sh
npm run build
npm start
```

## Tech Stack

- **Framework** — SvelteKit 2 with Svelte 5
- **Styling** — Tailwind CSS 4
- **Runtime** — Node.js with adapter-node
- **Build** — Vite 7
- **Language** — TypeScript

## Supported Providers

### Claude Code

Reads JSONL session logs from `~/.claude/projects/`. Each file contains a full conversation with user prompts, assistant responses, tool calls, and token usage.

### Cursor

Reads Cursor's local SQLite database to extract agent sessions including composer and chat interactions.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `CLAUDE_DIR` | `~/.claude/projects` | Path to Claude Code session data |
| `DEMO_MODE` | `false` | Run with demo data |

## Project Structure

```
src/
  components/    # Svelte UI components (Timeline, DiffView, EventCard, etc.)
  lib/
    server/      # Server-side logic
      providers/ # Data providers (Claude Code, Cursor)
    types/       # TypeScript type definitions
    utils/       # Shared utilities (cost calculation, formatting)
  routes/        # SvelteKit pages (dashboard + session detail)
static/          # Static assets
build/           # Production build output (adapter-node)
bin/             # CLI entry point
```

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create your branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)
