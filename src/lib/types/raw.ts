/** Raw types matching the JSONL entries from Claude Code sessions */

export interface RawContentBlockText {
	type: 'text';
	text: string;
}

export interface RawContentBlockThinking {
	type: 'thinking';
	thinking: string;
}

export interface RawContentBlockToolUse {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record<string, unknown>;
	caller?: { type: string };
}

export interface RawContentBlockToolResult {
	type: 'tool_result';
	tool_use_id: string;
	content?: string | RawContentBlockText[];
	is_error?: boolean;
}

export type RawContentBlock =
	| RawContentBlockText
	| RawContentBlockThinking
	| RawContentBlockToolUse
	| RawContentBlockToolResult;

export interface RawMessage {
	role: 'user' | 'assistant';
	id?: string;
	model?: string;
	content: string | RawContentBlock[];
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	};
	stop_reason?: string | null;
}

export interface RawUserEntry {
	type: 'user';
	uuid: string;
	parentUuid: string | null;
	sessionId: string;
	timestamp: string;
	message: RawMessage;
	cwd?: string;
	version?: string;
	gitBranch?: string;
	slug?: string;
	isSidechain?: boolean;
}

export interface RawAssistantEntry {
	type: 'assistant';
	uuid: string;
	parentUuid: string | null;
	sessionId: string;
	timestamp: string;
	message: RawMessage;
	requestId?: string;
	isSidechain?: boolean;
}

export interface RawSystemEntry {
	type: 'system';
	uuid: string;
	parentUuid?: string | null;
	timestamp: string;
	subtype?: string;
	durationMs?: number;
	sessionId?: string;
}

export interface RawFileHistorySnapshot {
	type: 'file-history-snapshot';
	messageId: string;
	snapshot: {
		messageId: string;
		trackedFileBackups: Record<string, unknown>;
		timestamp: string;
	};
	isSnapshotUpdate: boolean;
}

export interface RawProgressEntry {
	type: 'progress';
	[key: string]: unknown;
}

export type RawEntry =
	| RawUserEntry
	| RawAssistantEntry
	| RawSystemEntry
	| RawFileHistorySnapshot
	| RawProgressEntry;
