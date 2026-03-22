import { join } from 'path';
import { homedir } from 'os';
import { readdir, readFile, stat } from 'fs/promises';
import Database from 'better-sqlite3';
import type { SessionProvider } from './types';
import type { SessionSummary, SessionTimeline, TimelineEvent, TimelineEventData } from '$lib/types/timeline';
import { estimateCost } from '$lib/utils/cost';

const CURSOR_STORAGE = join(
	homedir(),
	'Library',
	'Application Support',
	'Cursor',
	'User',
	'workspaceStorage'
);

/** Keys known to contain AI conversation data in Cursor's state.vscdb */
const CONVERSATION_KEY_PATTERNS = [
	'composer.composerData',
	'workbench.panel.aichat.view.aichat.chatdata'
];

interface CursorMessage {
	role?: string;
	type?: number; // 1 = user, 2 = assistant in some formats
	text?: string;
	content?: string;
	message?: string;
	timestamp?: number;
	createdAt?: number;
	model?: string;
	modelName?: string;
	tokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	tokensUsed?: number;
	// Tool call fields (Cursor Composer / Agent mode)
	toolCalls?: Array<{
		name?: string;
		function?: { name?: string; arguments?: string };
		type?: string;
		id?: string;
		arguments?: string | Record<string, unknown>;
		result?: string;
		output?: string;
	}>;
	toolInvocations?: Array<{
		toolName?: string;
		args?: Record<string, unknown>;
		result?: string;
		state?: string;
	}>;
	// Cursor's codeblock-based tool calls
	codeBlocks?: Array<{
		language?: string;
		code?: string;
		uri?: string;
		fileName?: string;
	}>;
	// File operations tracked by Cursor
	fileEdits?: Array<{
		uri?: string;
		fileName?: string;
		oldContent?: string;
		newContent?: string;
	}>;
	terminalCommands?: Array<{
		command?: string;
		output?: string;
		exitCode?: number;
	}>;
}

interface CursorConversation {
	id?: string;
	tabId?: string;
	composerId?: string;
	title?: string;
	name?: string;
	messages?: CursorMessage[];
	conversation?: CursorMessage[];
	bubbles?: Array<{
		type: string;
		text?: string;
		rawText?: string;
		modelName?: string;
		tokenCount?: number;
	}>;
	model?: string;
	createdAt?: number | string;
	updatedAt?: number | string;
	lastUpdatedAt?: number | string;
}

function getWorkspaceName(workspaceDir: string): string {
	try {
		const wsPath = join(workspaceDir, 'workspace.json');
		const data = JSON.parse(require('fs').readFileSync(wsPath, 'utf-8'));
		const folder = data.folder || data.workspace || '';
		// Extract project name from URI like file:///Users/foo/project
		const decoded = decodeURIComponent(folder);
		const parts = decoded.replace(/^file:\/\//, '').split('/');
		return parts[parts.length - 1] || parts[parts.length - 2] || 'unknown';
	} catch {
		return 'unknown';
	}
}

function extractMessages(conv: CursorConversation): CursorMessage[] {
	// Cursor has used different formats across versions
	if (conv.bubbles && Array.isArray(conv.bubbles)) {
		return conv.bubbles.map((b) => ({
			role: b.type === 'user' ? 'user' : b.type === 'ai' ? 'assistant' : b.type,
			text: b.rawText || b.text || '',
			model: b.modelName,
			tokens: b.tokenCount
		}));
	}
	if (conv.messages && Array.isArray(conv.messages)) return conv.messages;
	if (conv.conversation && Array.isArray(conv.conversation)) return conv.conversation;
	return [];
}

function getMessageRole(msg: CursorMessage): 'user' | 'assistant' | 'system' {
	if (msg.role === 'user' || msg.type === 1) return 'user';
	if (msg.role === 'assistant' || msg.role === 'ai' || msg.type === 2) return 'assistant';
	return 'system';
}

function getMessageText(msg: CursorMessage): string {
	return msg.text || msg.content || msg.message || '';
}

function getTimestamp(msg: CursorMessage): string {
	const ts = msg.timestamp || msg.createdAt;
	if (!ts) return new Date().toISOString();
	// Handle both seconds and milliseconds
	const ms = ts > 1e12 ? ts : ts * 1000;
	return new Date(ms).toISOString();
}

function getConvId(conv: CursorConversation): string {
	return conv.composerId || conv.tabId || conv.id || crypto.randomUUID();
}

function getConvTimestamp(conv: CursorConversation, position: 'start' | 'end'): string {
	const messages = extractMessages(conv);
	if (messages.length > 0) {
		const msg = position === 'start' ? messages[0] : messages[messages.length - 1];
		return getTimestamp(msg);
	}
	const raw = position === 'start' ? conv.createdAt : (conv.lastUpdatedAt || conv.updatedAt || conv.createdAt);
	if (typeof raw === 'number') {
		const ms = raw > 1e12 ? raw : raw * 1000;
		return new Date(ms).toISOString();
	}
	if (typeof raw === 'string') return raw;
	return new Date().toISOString();
}

export class CursorProvider implements SessionProvider {
	type = 'cursor' as const;

	async discoverSessions(): Promise<SessionSummary[]> {
		const sessions: SessionSummary[] = [];

		let workspaceDirs: string[];
		try {
			workspaceDirs = await readdir(CURSOR_STORAGE);
		} catch {
			return [];
		}

		for (const wsDir of workspaceDirs) {
			const wsPath = join(CURSOR_STORAGE, wsDir);
			const dbPath = join(wsPath, 'state.vscdb');

			try {
				const s = await stat(dbPath);
				if (!s.isFile()) continue;
			} catch {
				continue;
			}

			let db: Database.Database;
			try {
				db = new Database(dbPath, { readonly: true });
			} catch {
				continue;
			}

			try {
				const projectName = getWorkspaceName(wsPath);

				for (const keyPattern of CONVERSATION_KEY_PATTERNS) {
					const rows = db.prepare(
						'SELECT key, value FROM ItemTable WHERE key LIKE ?'
					).all(`%${keyPattern}%`) as Array<{ key: string; value: string | Buffer }>;

					for (const row of rows) {
						try {
							const raw = typeof row.value === 'string'
								? row.value
								: row.value.toString('utf-8');
							const parsed = JSON.parse(raw);

							// The data can be a single conversation or an object containing multiple
							const conversations: CursorConversation[] = [];
							if (Array.isArray(parsed)) {
								conversations.push(...parsed);
							} else if (parsed.tabs && Array.isArray(parsed.tabs)) {
								conversations.push(...parsed.tabs);
							} else if (parsed.allComposers && Array.isArray(parsed.allComposers)) {
								conversations.push(...parsed.allComposers);
							} else if (parsed.messages || parsed.bubbles || parsed.conversation) {
								conversations.push(parsed);
							}

							for (const conv of conversations) {
								const messages = extractMessages(conv);
								if (messages.length < 2) continue; // Skip empty/trivial conversations

								const convId = getConvId(conv);
								const startedAt = getConvTimestamp(conv, 'start');
								const lastActiveAt = getConvTimestamp(conv, 'end');

								let inputTokens = 0;
								let outputTokens = 0;
								let toolCallCount = 0;
								let model = '';

								for (const msg of messages) {
									const role = getMessageRole(msg);
									const msgModel = msg.model || msg.modelName;
									if (msgModel && !model) model = msgModel;

									if (msg.inputTokens) inputTokens += msg.inputTokens;
									if (msg.outputTokens) outputTokens += msg.outputTokens;
									if (msg.tokens || msg.tokensUsed) {
										const t = msg.tokens || msg.tokensUsed || 0;
										if (role === 'user') inputTokens += t;
										else if (role === 'assistant') outputTokens += t;
									}

									// Count tool calls
									if (msg.toolCalls && Array.isArray(msg.toolCalls)) toolCallCount += msg.toolCalls.length;
									if (msg.toolInvocations && Array.isArray(msg.toolInvocations)) toolCallCount += msg.toolInvocations.length;
									if (msg.terminalCommands && Array.isArray(msg.terminalCommands)) toolCallCount += msg.terminalCommands.length;
									if (msg.fileEdits && Array.isArray(msg.fileEdits)) toolCallCount += msg.fileEdits.length;
								}

								// Derive a slug from conversation title or first user message
								const slug = conv.title || conv.name ||
									getMessageText(messages.find((m) => getMessageRole(m) === 'user') || messages[0]).slice(0, 60) ||
									'Cursor conversation';

								sessions.push({
									sessionId: `cursor-${convId}`,
									project: projectName,
									slug,
									startedAt,
									lastActiveAt,
									model: model || 'unknown',
									version: '',
									eventCount: messages.length,
									toolCallCount,
								errorCount: 0,
									inputTokens,
									outputTokens,
									estimatedCost: estimateCost(model, inputTokens, outputTokens),
									filePath: dbPath,
									provider: 'cursor',
									providerMeta: {
										dbPath,
										conversationKey: row.key,
										conversationId: convId,
										workspaceDir: wsPath
									}
								});
							}
						} catch {
							// Skip unparseable values
						}
					}
				}
			} finally {
				db.close();
			}
		}

		sessions.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
		return sessions;
	}

	async parseSession(sessionId: string, meta: Record<string, string>): Promise<SessionTimeline> {
		const { dbPath, conversationKey, conversationId } = meta;

		const db = new Database(dbPath, { readonly: true });
		try {
			const rows = db.prepare(
				'SELECT value FROM ItemTable WHERE key LIKE ?'
			).all(`%${conversationKey}%`) as Array<{ value: string | Buffer }>;

			for (const row of rows) {
				const raw = typeof row.value === 'string' ? row.value : row.value.toString('utf-8');
				const parsed = JSON.parse(raw);

				const conversations: CursorConversation[] = [];
				if (Array.isArray(parsed)) {
					conversations.push(...parsed);
				} else if (parsed.tabs && Array.isArray(parsed.tabs)) {
					conversations.push(...parsed.tabs);
				} else if (parsed.allComposers && Array.isArray(parsed.allComposers)) {
					conversations.push(...parsed.allComposers);
				} else if (parsed.messages || parsed.bubbles || parsed.conversation) {
					conversations.push(parsed);
				}

				const conv = conversations.find((c) => getConvId(c) === conversationId);
				if (!conv) continue;

				return buildTimeline(conv, sessionId, meta);
			}

			throw new Error(`Conversation ${conversationId} not found in database`);
		} finally {
			db.close();
		}
	}
}

function buildTimeline(
	conv: CursorConversation,
	sessionId: string,
	meta: Record<string, string>
): SessionTimeline {
	const messages = extractMessages(conv);
	const events: TimelineEvent[] = [];
	let eventIndex = 0;
	let model = '';
	let inputTokens = 0;
	let outputTokens = 0;
	let toolCallCount = 0;

	for (const msg of messages) {
		const role = getMessageRole(msg);
		const text = getMessageText(msg);
		const timestamp = getTimestamp(msg);
		const msgModel = msg.model || msg.modelName;
		if (msgModel && !model) model = msgModel;

		if (msg.inputTokens) inputTokens += msg.inputTokens;
		if (msg.outputTokens) outputTokens += msg.outputTokens;
		if (msg.tokens || msg.tokensUsed) {
			const t = msg.tokens || msg.tokensUsed || 0;
			if (role === 'user') inputTokens += t;
			else if (role === 'assistant') outputTokens += t;
		}

		// Parse explicit tool calls (Cursor Agent/Composer mode)
		if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
			// Emit text first if any
			if (text.trim()) {
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: { eventType: role === 'user' ? 'user_message' : 'assistant_text', text }
				});
				eventIndex++;
			}

			for (const tc of msg.toolCalls) {
				const toolName = tc.name || tc.function?.name || tc.type || 'tool';
				let input: Record<string, unknown> = {};
				const rawArgs = tc.arguments || tc.function?.arguments;
				if (typeof rawArgs === 'string') {
					try { input = JSON.parse(rawArgs); } catch { input = { raw: rawArgs }; }
				} else if (rawArgs && typeof rawArgs === 'object') {
					input = rawArgs;
				}

				const result = tc.result || tc.output;
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: {
						eventType: 'tool_call',
						toolName,
						toolUseId: tc.id || `cursor-${eventIndex}`,
						input,
						...(result ? { result: { content: result, isError: false } } : {})
					}
				});
				eventIndex++;
				toolCallCount++;
			}
			continue;
		}

		// Parse toolInvocations (alternative Cursor format)
		if (msg.toolInvocations && Array.isArray(msg.toolInvocations)) {
			if (text.trim()) {
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: { eventType: role === 'user' ? 'user_message' : 'assistant_text', text }
				});
				eventIndex++;
			}

			for (const ti of msg.toolInvocations) {
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: {
						eventType: 'tool_call',
						toolName: ti.toolName || 'tool',
						toolUseId: `cursor-${eventIndex}`,
						input: ti.args || {},
						...(ti.result ? { result: { content: typeof ti.result === 'string' ? ti.result : JSON.stringify(ti.result), isError: ti.state === 'error' } } : {})
					}
				});
				eventIndex++;
				toolCallCount++;
			}
			continue;
		}

		// Parse terminal commands from Cursor agent
		if (msg.terminalCommands && Array.isArray(msg.terminalCommands)) {
			for (const cmd of msg.terminalCommands) {
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: {
						eventType: 'tool_call',
						toolName: 'Bash',
						toolUseId: `cursor-bash-${eventIndex}`,
						input: { command: cmd.command || '' },
						result: {
							content: cmd.output || `exit code: ${cmd.exitCode ?? 'unknown'}`,
							isError: (cmd.exitCode ?? 0) !== 0
						}
					}
				});
				eventIndex++;
				toolCallCount++;
			}
		}

		// Parse file edits from Cursor agent
		if (msg.fileEdits && Array.isArray(msg.fileEdits)) {
			for (const edit of msg.fileEdits) {
				const fileName = edit.fileName || edit.uri || 'unknown';
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: {
						eventType: 'tool_call',
						toolName: 'Edit',
						toolUseId: `cursor-edit-${eventIndex}`,
						input: {
							file_path: fileName,
							...(edit.oldContent ? { old_string: edit.oldContent.slice(0, 500) } : {}),
							...(edit.newContent ? { new_string: edit.newContent.slice(0, 500) } : {})
						},
						result: { content: `Edited ${fileName}`, isError: false }
					}
				});
				eventIndex++;
				toolCallCount++;
			}
		}

		// Parse code blocks as Read/Write operations
		if (msg.codeBlocks && Array.isArray(msg.codeBlocks) && role === 'assistant') {
			if (text.trim()) {
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: { eventType: 'assistant_text', text }
				});
				eventIndex++;
			}

			for (const cb of msg.codeBlocks) {
				if (cb.uri || cb.fileName) {
					events.push({
						id: `evt-${eventIndex}`,
						index: eventIndex,
						timestamp,
						data: {
							eventType: 'tool_call',
							toolName: 'Write',
							toolUseId: `cursor-write-${eventIndex}`,
							input: {
								file_path: cb.fileName || cb.uri || 'unknown',
								content: cb.code || ''
							},
							result: { content: cb.code || '', isError: false }
						}
					});
					eventIndex++;
					toolCallCount++;
				}
			}
			continue;
		}

		// Fallback: detect tool-like patterns in assistant text
		if (role === 'assistant' && text.trim()) {
			const toolEvents = parseToolPatternsFromText(text, timestamp, eventIndex);
			if (toolEvents.length > 0) {
				// Emit remaining text without tool patterns
				const cleanText = stripToolPatterns(text);
				if (cleanText.trim()) {
					events.push({
						id: `evt-${eventIndex}`,
						index: eventIndex,
						timestamp,
						data: { eventType: 'assistant_text', text: cleanText }
					});
					eventIndex++;
				}

				for (const te of toolEvents) {
					events.push(te);
					te.index = eventIndex;
					te.id = `evt-${eventIndex}`;
					eventIndex++;
					toolCallCount++;
				}
				continue;
			}
		}

		if (!text.trim()) continue;

		let data: TimelineEventData;
		if (role === 'user') {
			data = { eventType: 'user_message', text };
		} else if (role === 'assistant') {
			data = { eventType: 'assistant_text', text };
		} else {
			data = { eventType: 'system', subtype: 'cursor' };
		}

		events.push({
			id: `evt-${eventIndex}`,
			index: eventIndex,
			timestamp,
			data
		});
		eventIndex++;
	}

	const startedAt = getConvTimestamp(conv, 'start');
	const lastActiveAt = getConvTimestamp(conv, 'end');
	const slug = conv.title || conv.name ||
		getMessageText(messages.find((m) => getMessageRole(m) === 'user') || messages[0]).slice(0, 60) ||
		'Cursor conversation';

	const summary: SessionSummary = {
		sessionId,
		project: meta.project || 'unknown',
		slug,
		startedAt,
		lastActiveAt,
		model: model || 'unknown',
		version: '',
		eventCount: events.length,
		toolCallCount,
		errorCount: 0,
		inputTokens,
		outputTokens,
		estimatedCost: estimateCost(model, inputTokens, outputTokens),
		filePath: meta.dbPath,
		provider: 'cursor',
		providerMeta: meta
	};

	return { summary, events };
}

/** Detect tool-like patterns in raw assistant text (bash commands, file operations) */
function parseToolPatternsFromText(text: string, timestamp: string, startIndex: number): TimelineEvent[] {
	const events: TimelineEvent[] = [];

	// Detect bash/terminal command blocks: ```bash\n...\n```
	const bashRegex = /```(?:bash|sh|shell|terminal|zsh)\n([\s\S]*?)```/g;
	let match;
	while ((match = bashRegex.exec(text)) !== null) {
		const command = match[1].trim();
		if (command) {
			events.push({
				id: `evt-${startIndex + events.length}`,
				index: startIndex + events.length,
				timestamp,
				data: {
					eventType: 'tool_call',
					toolName: 'Bash',
					toolUseId: `cursor-infer-${startIndex + events.length}`,
					input: { command },
					result: { content: command, isError: false }
				}
			});
		}
	}

	// Detect file path references with code blocks (e.g. "In `src/foo.ts`:" followed by code)
	const fileEditRegex = /(?:(?:create|edit|modify|update|write to|in)\s+)?[`"]([^\s`"]+\.\w{1,10})[`"]\s*:?\s*```\w*\n([\s\S]*?)```/gi;
	while ((match = fileEditRegex.exec(text)) !== null) {
		const filePath = match[1];
		const content = match[2].trim();
		if (filePath && content && !filePath.startsWith('http')) {
			events.push({
				id: `evt-${startIndex + events.length}`,
				index: startIndex + events.length,
				timestamp,
				data: {
					eventType: 'tool_call',
					toolName: 'Write',
					toolUseId: `cursor-infer-${startIndex + events.length}`,
					input: { file_path: filePath, content },
					result: { content: `Wrote to ${filePath}`, isError: false }
				}
			});
		}
	}

	return events;
}

/** Strip tool patterns from text to avoid duplication */
function stripToolPatterns(text: string): string {
	// Remove bash code blocks
	let cleaned = text.replace(/```(?:bash|sh|shell|terminal|zsh)\n[\s\S]*?```/g, '');
	// Remove file edit blocks that we parsed
	cleaned = cleaned.replace(/(?:(?:create|edit|modify|update|write to|in)\s+)?[`"][^\s`"]+\.\w{1,10}[`"]\s*:?\s*```\w*\n[\s\S]*?```/gi, '');
	return cleaned;
}
