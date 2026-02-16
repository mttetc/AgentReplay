import { readFile } from 'fs/promises';
import type {
	RawEntry,
	RawAssistantEntry,
	RawUserEntry,
	RawSystemEntry,
	RawContentBlock,
	RawContentBlockToolUse,
	RawContentBlockToolResult,
	RawContentBlockText,
	RawContentBlockThinking
} from '$lib/types/raw';
import type {
	SessionTimeline,
	TimelineEvent,
	TimelineEventData,
	SessionSummary
} from '$lib/types/timeline';
import { estimateCost } from '$lib/utils/cost';

interface AssistantTurn {
	messageId: string;
	timestamp: string;
	model: string;
	blocks: RawContentBlock[];
	inputTokens: number;
	outputTokens: number;
}

/**
 * Parse a JSONL session file into a full timeline.
 *
 * Key steps:
 * 1. Read all lines, skip progress/queue-operation/file-history-snapshot
 * 2. Reassemble streamed assistant turns (group by message.id, merge content blocks)
 * 3. Match tool_result entries to their tool_use counterparts
 * 4. Build chronological timeline events
 */
export async function parseSession(
	filePath: string,
	sessionId: string,
	project: string
): Promise<SessionTimeline> {
	const content = await readFile(filePath, 'utf-8');
	const lines = content.split('\n').filter((l) => l.trim());

	const entries: RawEntry[] = [];
	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as RawEntry;
			entries.push(entry);
		} catch {
			// Skip malformed lines
		}
	}

	// Filter out entries we don't care about
	const filtered = entries.filter(
		(e) =>
			e.type !== 'progress' &&
			e.type !== 'file-history-snapshot' &&
			(e as Record<string, unknown>).type !== 'queue-operation'
	);

	// Step 1: Reassemble assistant turns by message.id
	const assistantTurns = new Map<string, AssistantTurn>();
	const orderedEntries: Array<
		| { kind: 'user'; entry: RawUserEntry }
		| { kind: 'assistant_turn'; messageId: string }
		| { kind: 'system'; entry: RawSystemEntry }
	> = [];

	const seenAssistantIds = new Set<string>();

	for (const entry of filtered) {
		if (entry.type === 'user') {
			orderedEntries.push({ kind: 'user', entry: entry as RawUserEntry });
		} else if (entry.type === 'assistant') {
			const aEntry = entry as RawAssistantEntry;
			const msgId = aEntry.message.id || aEntry.uuid;

			if (!assistantTurns.has(msgId)) {
				assistantTurns.set(msgId, {
					messageId: msgId,
					timestamp: aEntry.timestamp,
					model: aEntry.message.model || '',
					blocks: [],
					inputTokens: 0,
					outputTokens: 0
				});
			}

			const turn = assistantTurns.get(msgId)!;

			// Merge content blocks
			const rawContent = aEntry.message.content;
			if (typeof rawContent === 'string') {
				if (rawContent.trim()) {
					turn.blocks.push({ type: 'text', text: rawContent });
				}
			} else if (Array.isArray(rawContent)) {
				for (const block of rawContent) {
					turn.blocks.push(block);
				}
			}

			// Accumulate usage
			const usage = aEntry.message.usage;
			if (usage) {
				turn.inputTokens +=
					(usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0);
				turn.outputTokens += usage.output_tokens || 0;
			}

			// Track order — only add to orderedEntries on first encounter
			if (!seenAssistantIds.has(msgId)) {
				seenAssistantIds.add(msgId);
				orderedEntries.push({ kind: 'assistant_turn', messageId: msgId });
			}
		} else if (entry.type === 'system') {
			orderedEntries.push({ kind: 'system', entry: entry as RawSystemEntry });
		}
	}

	// Step 2: Build a map of tool_use_id → tool_result for matching
	const toolResults = new Map<string, { content: string; isError: boolean }>();
	for (const entry of filtered) {
		if (entry.type !== 'user') continue;
		const userEntry = entry as RawUserEntry;
		const rawContent = userEntry.message.content;
		if (!Array.isArray(rawContent)) continue;

		for (const block of rawContent) {
			if (block.type === 'tool_result') {
				const trBlock = block as RawContentBlockToolResult;
				let resultText = '';
				if (typeof trBlock.content === 'string') {
					resultText = trBlock.content;
				} else if (Array.isArray(trBlock.content)) {
					resultText = trBlock.content.map((b) => b.text).join('\n');
				}
				toolResults.set(trBlock.tool_use_id, {
					content: resultText,
					isError: trBlock.is_error || false
				});
			}
		}
	}

	// Step 3: Build timeline events
	const events: TimelineEvent[] = [];
	let eventIndex = 0;
	let slug = '';
	let version = '';
	let model = '';
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	let startedAt = '';
	let lastActiveAt = '';

	for (const ordered of orderedEntries) {
		if (ordered.kind === 'user') {
			const userEntry = ordered.entry;
			if (!startedAt) startedAt = userEntry.timestamp;
			lastActiveAt = userEntry.timestamp;
			if (userEntry.slug && !slug) slug = userEntry.slug;
			if (userEntry.version && !version) version = userEntry.version;

			const rawContent = userEntry.message.content;
			// Extract user text (skip tool_result blocks, those are matched to tool_calls)
			if (typeof rawContent === 'string') {
				if (rawContent.trim()) {
					events.push(makeEvent(eventIndex++, userEntry.timestamp, {
						eventType: 'user_message',
						text: rawContent
					}));
				}
			} else if (Array.isArray(rawContent)) {
				const textParts: string[] = [];
				for (const block of rawContent) {
					if (block.type === 'text') {
						textParts.push((block as RawContentBlockText).text);
					}
				}
				if (textParts.length > 0) {
					events.push(makeEvent(eventIndex++, userEntry.timestamp, {
						eventType: 'user_message',
						text: textParts.join('\n')
					}));
				}
			}
		} else if (ordered.kind === 'assistant_turn') {
			const turn = assistantTurns.get(ordered.messageId)!;
			if (!model && turn.model) model = turn.model;
			totalInputTokens += turn.inputTokens;
			totalOutputTokens += turn.outputTokens;
			lastActiveAt = turn.timestamp;

			for (const block of turn.blocks) {
				if (block.type === 'thinking') {
					const thinkBlock = block as RawContentBlockThinking;
					if (thinkBlock.thinking.trim()) {
						events.push(makeEvent(eventIndex++, turn.timestamp, {
							eventType: 'thinking',
							thinking: thinkBlock.thinking
						}));
					}
				} else if (block.type === 'text') {
					const textBlock = block as RawContentBlockText;
					if (textBlock.text.trim()) {
						events.push(makeEvent(eventIndex++, turn.timestamp, {
							eventType: 'assistant_text',
							text: textBlock.text
						}));
					}
				} else if (block.type === 'tool_use') {
					const toolBlock = block as RawContentBlockToolUse;
					const result = toolResults.get(toolBlock.id);
					events.push(makeEvent(eventIndex++, turn.timestamp, {
						eventType: 'tool_call',
						toolName: toolBlock.name,
						toolUseId: toolBlock.id,
						input: toolBlock.input,
						result
					}));
				}
			}
		} else if (ordered.kind === 'system') {
			const sysEntry = ordered.entry;
			if (sysEntry.subtype === 'compact_boundary') {
				events.push(makeEvent(eventIndex++, sysEntry.timestamp, {
					eventType: 'compact_boundary'
				}));
			} else {
				events.push(makeEvent(eventIndex++, sysEntry.timestamp, {
					eventType: 'system',
					subtype: sysEntry.subtype || 'unknown',
					durationMs: sysEntry.durationMs
				}));
			}
		}
	}

	const summary: SessionSummary = {
		sessionId,
		project,
		slug,
		startedAt,
		lastActiveAt,
		model,
		version,
		eventCount: events.length,
		toolCallCount: events.filter((e) => e.data.eventType === 'tool_call').length,
		inputTokens: totalInputTokens,
		outputTokens: totalOutputTokens,
		estimatedCost: estimateCost(model, totalInputTokens, totalOutputTokens),
		filePath,
		provider: 'claude-code'
	};

	return { summary, events };
}

function makeEvent(index: number, timestamp: string, data: TimelineEventData): TimelineEvent {
	return {
		id: `evt-${index}`,
		index,
		timestamp,
		data
	};
}
