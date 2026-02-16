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
		toolCallCount: 0,
		inputTokens,
		outputTokens,
		estimatedCost: estimateCost(model, inputTokens, outputTokens),
		filePath: meta.dbPath,
		provider: 'cursor',
		providerMeta: meta
	};

	return { summary, events };
}
