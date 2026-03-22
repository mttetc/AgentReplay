import type { SessionTimeline, TimelineEvent } from '$lib/types/timeline';
import { formatDurationBetween, formatCost, shortModel, formatFullDate } from './format';

/**
 * Generate a self-contained HTML file for a session.
 * No external dependencies — CSS is inline, data is embedded.
 */
export function toStaticHTML(timeline: SessionTimeline): string {
	const s = timeline.summary;
	const duration = formatDurationBetween(s.startedAt, s.lastActiveAt);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(s.slug || s.sessionId.slice(0, 8))} — Agent Replay</title>
<style>${CSS}</style>
</head>
<body>
<div class="header">
	<div class="header-left">
		<span class="logo">agent<span class="accent">replay</span></span>
		<span class="badge">${escapeHtml(shortModel(s.model))}</span>
		<span class="meta">${escapeHtml(s.project)}</span>
	</div>
	<div class="header-right">
		<span class="meta">${formatFullDate(s.startedAt)}</span>
	</div>
</div>
<div class="stats">
	<div class="stat"><span class="stat-label">Duration</span><span class="stat-value">${duration}</span></div>
	<div class="stat"><span class="stat-label">Events</span><span class="stat-value">${s.eventCount}</span></div>
	<div class="stat"><span class="stat-label">Tool calls</span><span class="stat-value">${s.toolCallCount}</span></div>
	<div class="stat"><span class="stat-label">Tokens</span><span class="stat-value">${formatTokens(s.inputTokens)}in / ${formatTokens(s.outputTokens)}out</span></div>
	<div class="stat"><span class="stat-label">Cost</span><span class="stat-value cost">${formatCost(s.estimatedCost)}</span></div>
</div>
<h1>${escapeHtml(s.slug || s.sessionId.slice(0, 8))}</h1>
<div class="timeline">
${timeline.events.map(renderEvent).join('\n')}
</div>
<footer>
	<p>Exported from <strong>Agent Replay</strong> — DevTools for AI Agents</p>
</footer>
</body>
</html>`;
}

function renderEvent(event: TimelineEvent): string {
	const d = event.data;
	switch (d.eventType) {
		case 'user_message':
			return `<div class="event event-user"><div class="event-label">User</div><div class="event-content">${escapeHtml(d.text)}</div></div>`;
		case 'assistant_text':
			return `<div class="event event-assistant"><div class="event-label">Claude</div><div class="event-content">${escapeHtml(d.text)}</div></div>`;
		case 'thinking':
			return `<div class="event event-thinking"><div class="event-label">Thinking</div><div class="event-content">${escapeHtml(d.thinking)}</div></div>`;
		case 'tool_call': {
			const input = formatToolInput(d.toolName, d.input);
			const resultHtml = d.result
				? `<div class="tool-result ${d.result.isError ? 'error' : ''}">${escapeHtml(truncate(d.result.content, 2000))}</div>`
				: '';
			return `<div class="event event-tool"><div class="event-label">Tool: ${escapeHtml(d.toolName)}</div><div class="event-content"><pre>${escapeHtml(input)}</pre>${resultHtml}</div></div>`;
		}
		case 'system':
			return `<div class="event event-system"><div class="event-label">System</div><div class="event-content">${escapeHtml(d.subtype)}</div></div>`;
		case 'compact_boundary':
			return `<div class="event event-system"><hr><em>Context compacted</em></div>`;
		default:
			return '';
	}
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
	if (toolName === 'Bash') return String(input.command || '');
	if (toolName === 'Read') return `Read: ${input.file_path}`;
	if (toolName === 'Write') return `Write: ${input.file_path}\n${truncate(String(input.content || ''), 1000)}`;
	if (toolName === 'Edit') return `Edit: ${input.file_path}\n- ${String(input.old_string || '').slice(0, 200)}\n+ ${String(input.new_string || '').slice(0, 200)}`;
	if (toolName === 'Glob' || toolName === 'Grep') return `${toolName}: ${input.pattern}`;
	return JSON.stringify(input, null, 2);
}

function formatTokens(n: number): string {
	if (n < 1000) return `${n} `;
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K `;
	return `${(n / 1_000_000).toFixed(2)}M `;
}

function truncate(text: string, max: number): string {
	return text.length > max ? text.slice(0, max) + '...' : text;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

const CSS = `
:root { --bg: #0a0a0f; --surface: #111118; --border: #1e1e2a; --text: #e0e0e8; --text-dim: #666; --accent: #3b82f6; --green: #34d399; --amber: #fbbf24; --red: #f87171; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; max-width: 900px; margin: 0 auto; padding: 1rem; }
.header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid var(--border); margin-bottom: 1rem; }
.header-left { display: flex; align-items: center; gap: 0.75rem; }
.logo { font-weight: 700; font-size: 14px; }
.accent { color: var(--accent); }
.badge { background: rgba(59,130,246,0.15); color: var(--accent); padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.meta { color: var(--text-dim); font-size: 12px; }
.stats { display: flex; gap: 1.5rem; flex-wrap: wrap; padding: 0.75rem 0; border-bottom: 1px solid var(--border); margin-bottom: 1rem; }
.stat { display: flex; flex-direction: column; }
.stat-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
.stat-value { font-size: 14px; font-weight: 600; }
.stat-value.cost { color: var(--green); }
h1 { font-size: 18px; margin-bottom: 1.5rem; }
.timeline { display: flex; flex-direction: column; gap: 0.5rem; }
.event { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.event-label { padding: 6px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--border); }
.event-content { padding: 12px; font-size: 13px; white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow-y: auto; }
.event-content pre { font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace; font-size: 12px; overflow-x: auto; }
.event-user .event-label { background: rgba(59,130,246,0.1); color: var(--accent); }
.event-assistant .event-label { background: rgba(139,92,246,0.1); color: #a78bfa; }
.event-thinking .event-label { background: rgba(251,191,36,0.1); color: var(--amber); }
.event-thinking .event-content { color: var(--text-dim); font-style: italic; }
.event-tool .event-label { background: rgba(52,211,153,0.1); color: var(--green); }
.event-system .event-label { background: rgba(100,100,120,0.1); color: var(--text-dim); }
.tool-result { margin-top: 8px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 4px; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; }
.tool-result.error { border-left: 3px solid var(--red); color: var(--red); }
footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); text-align: center; color: var(--text-dim); font-size: 12px; }
@media (max-width: 600px) { .stats { gap: 0.75rem; } .header { flex-direction: column; align-items: flex-start; gap: 0.5rem; } }
`;
