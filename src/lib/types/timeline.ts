import type { ProviderType } from '$lib/server/providers/types';

/** Timeline model — transformed from raw JSONL for UI consumption */

export type EventType =
	| 'user_message'
	| 'assistant_text'
	| 'thinking'
	| 'tool_call'
	| 'tool_result'
	| 'system'
	| 'compact_boundary';

export type ToolName =
	| 'Bash'
	| 'Read'
	| 'Write'
	| 'Edit'
	| 'Glob'
	| 'Grep'
	| 'Task'
	| 'WebFetch'
	| 'WebSearch'
	| 'AskUserQuestion'
	| string;

export interface ToolCallEvent {
	eventType: 'tool_call';
	toolName: ToolName;
	toolUseId: string;
	input: Record<string, unknown>;
	/** Matched result from the following user turn */
	result?: {
		content: string;
		isError: boolean;
	};
}

export interface UserMessageEvent {
	eventType: 'user_message';
	text: string;
}

export interface AssistantTextEvent {
	eventType: 'assistant_text';
	text: string;
}

export interface ThinkingEvent {
	eventType: 'thinking';
	thinking: string;
}

export interface SystemEvent {
	eventType: 'system';
	subtype: string;
	durationMs?: number;
}

export interface CompactBoundaryEvent {
	eventType: 'compact_boundary';
}

export type TimelineEventData =
	| ToolCallEvent
	| UserMessageEvent
	| AssistantTextEvent
	| ThinkingEvent
	| SystemEvent
	| CompactBoundaryEvent;

export interface TimelineEvent {
	id: string;
	index: number;
	timestamp: string;
	data: TimelineEventData;
	/** Token usage for this event's assistant turn (shared across events from same turn) */
	tokens?: { input: number; output: number };
}

export interface SessionSummary {
	sessionId: string;
	project: string;
	slug: string;
	startedAt: string;
	lastActiveAt: string;
	model: string;
	version: string;
	eventCount: number;
	toolCallCount: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	estimatedCost: number;
	/** Number of tool call errors */
	errorCount: number;
	/** Full path to the source file */
	filePath: string;
	/** Which provider this session came from */
	provider: ProviderType;
	/** Provider-specific metadata for routing */
	providerMeta?: Record<string, string>;
	/** Git branch active during the session */
	gitBranch?: string;
	/** Working directory of the session */
	cwd?: string;
}

export interface SessionTimeline {
	summary: SessionSummary;
	events: TimelineEvent[];
}
