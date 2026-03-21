import type { SessionTimeline, TimelineEvent } from '$lib/types/timeline';
import { formatDurationBetween, formatCost, shortModel } from './format';

/** Convert a session timeline to formatted Markdown */
export function toMarkdown(timeline: SessionTimeline): string {
	const s = timeline.summary;
	const duration = formatDurationBetween(s.startedAt, s.lastActiveAt);

	const lines: string[] = [
		`# Session: ${s.slug || s.sessionId.slice(0, 8)}`,
		`**Project**: ${s.project} | **Model**: ${shortModel(s.model)} | **Cost**: ${formatCost(s.estimatedCost)} | **Duration**: ${duration} | **Events**: ${s.eventCount}`,
		'',
		'---',
		''
	];

	for (const event of timeline.events) {
		lines.push(formatEventMarkdown(event));
	}

	return lines.join('\n');
}

function formatEventMarkdown(event: TimelineEvent): string {
	const d = event.data;

	switch (d.eventType) {
		case 'user_message':
			return `### User\n\n${d.text}\n`;

		case 'assistant_text':
			return `### Claude\n\n${d.text}\n`;

		case 'thinking':
			return `### Thinking\n\n> ${d.thinking.split('\n').join('\n> ')}\n`;

		case 'tool_call': {
			const parts: string[] = [`### Tool: ${d.toolName}`];

			if (d.toolName === 'Bash') {
				parts.push('', '```bash', String(d.input.command || ''), '```');
				if (d.result) {
					parts.push('', d.result.isError ? '**Error:**' : '**Output:**');
					parts.push('```', d.result.content, '```');
				}
			} else if (d.toolName === 'Edit') {
				parts.push('', `File: \`${d.input.file_path}\``);
				parts.push('', '```diff');
				const oldStr = String(d.input.old_string || '');
				const newStr = String(d.input.new_string || '');
				for (const line of oldStr.split('\n')) parts.push(`- ${line}`);
				for (const line of newStr.split('\n')) parts.push(`+ ${line}`);
				parts.push('```');
			} else if (d.toolName === 'Read' || d.toolName === 'Write') {
				parts.push('', `File: \`${d.input.file_path}\``);
				if (d.toolName === 'Write' && d.input.content) {
					parts.push('', '```', String(d.input.content), '```');
				} else if (d.result) {
					parts.push('', '```', d.result.content, '```');
				}
			} else if (d.toolName === 'Glob' || d.toolName === 'Grep') {
				parts.push('', `Pattern: \`${d.input.pattern}\``);
				if (d.result) {
					parts.push('', '```', d.result.content, '```');
				}
			} else {
				parts.push('', '```json', JSON.stringify(d.input, null, 2), '```');
				if (d.result) {
					parts.push('', d.result.isError ? '**Error:**' : '**Result:**');
					parts.push('```', d.result.content, '```');
				}
			}

			return parts.join('\n') + '\n';
		}

		case 'system':
			return `*System: ${d.subtype}*\n`;

		case 'compact_boundary':
			return '---\n*Context compacted*\n---\n';

		default:
			return '';
	}
}

/** Convert a session timeline to clean JSON */
export function toJSON(timeline: SessionTimeline): string {
	const { summary, events } = timeline;
	const clean = {
		session: {
			id: summary.sessionId,
			project: summary.project,
			slug: summary.slug,
			model: summary.model,
			startedAt: summary.startedAt,
			lastActiveAt: summary.lastActiveAt,
			eventCount: summary.eventCount,
			toolCallCount: summary.toolCallCount,
			inputTokens: summary.inputTokens,
			outputTokens: summary.outputTokens,
			estimatedCost: summary.estimatedCost,
			provider: summary.provider
		},
		events: events.map((e) => ({
			timestamp: e.timestamp,
			...e.data
		}))
	};
	return JSON.stringify(clean, null, 2);
}

/** Trigger a file download in the browser */
export function downloadFile(content: string, filename: string, mimeType: string) {
	const blob = new Blob([content], { type: mimeType });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
