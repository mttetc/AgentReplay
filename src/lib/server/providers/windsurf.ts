import { join } from 'path';
import { homedir } from 'os';
import { readdir, readFile, stat } from 'fs/promises';
import type { SessionProvider } from './types';
import type { SessionSummary, SessionTimeline, TimelineEvent, TimelineEventData } from '$lib/types/timeline';
import { estimateCost } from '$lib/utils/cost';

/**
 * Windsurf (Codeium) stores conversation data in its workspace storage,
 * similar to VS Code / Cursor. The exact paths can vary by version but
 * the common pattern is:
 *   ~/Library/Application Support/Windsurf/User/workspaceStorage/
 *   ~/.config/Windsurf/User/workspaceStorage/ (Linux)
 *   %APPDATA%/Windsurf/User/workspaceStorage/ (Windows)
 *
 * Within each workspace, state.vscdb or globalStorage contains chat data.
 * Windsurf also stores Cascade conversations in its own format.
 */

function getWindsurfStoragePaths(): string[] {
	const home = homedir();
	const platform = process.platform;

	if (platform === 'darwin') {
		return [
			join(home, 'Library', 'Application Support', 'Windsurf', 'User', 'workspaceStorage'),
			join(home, 'Library', 'Application Support', 'Windsurf', 'User', 'globalStorage')
		];
	}
	if (platform === 'linux') {
		return [
			join(home, '.config', 'Windsurf', 'User', 'workspaceStorage'),
			join(home, '.config', 'Windsurf', 'User', 'globalStorage')
		];
	}
	if (platform === 'win32') {
		const appdata = process.env.APPDATA || join(home, 'AppData', 'Roaming');
		return [
			join(appdata, 'Windsurf', 'User', 'workspaceStorage'),
			join(appdata, 'Windsurf', 'User', 'globalStorage')
		];
	}
	return [];
}

/** Known keys that contain Windsurf/Cascade AI conversation data */
const CONVERSATION_KEY_PATTERNS = [
	'cascade.conversationData',
	'cascade.chatData',
	'workbench.panel.chat',
	'windsurf.conversations'
];

interface WindsurfMessage {
	role?: string;
	type?: string;
	content?: string;
	text?: string;
	message?: string;
	timestamp?: number;
	createdAt?: number;
	model?: string;
	modelName?: string;
	tokens?: number;
	inputTokens?: number;
	outputTokens?: number;
	// Tool call fields
	toolCalls?: Array<{
		name?: string;
		function?: string;
		arguments?: string | Record<string, unknown>;
		result?: string;
		output?: string;
	}>;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	toolOutput?: string;
}

interface WindsurfConversation {
	id?: string;
	conversationId?: string;
	title?: string;
	name?: string;
	messages?: WindsurfMessage[];
	turns?: WindsurfMessage[];
	model?: string;
	createdAt?: number | string;
	updatedAt?: number | string;
}

function getWorkspaceName(workspaceDir: string): string {
	try {
		const wsPath = join(workspaceDir, 'workspace.json');
		const data = JSON.parse(require('fs').readFileSync(wsPath, 'utf-8'));
		const folder = data.folder || data.workspace || '';
		const decoded = decodeURIComponent(folder);
		const parts = decoded.replace(/^file:\/\//, '').split('/');
		return parts[parts.length - 1] || parts[parts.length - 2] || 'unknown';
	} catch {
		return 'unknown';
	}
}

function extractMessages(conv: WindsurfConversation): WindsurfMessage[] {
	if (conv.messages && Array.isArray(conv.messages)) return conv.messages;
	if (conv.turns && Array.isArray(conv.turns)) return conv.turns;
	return [];
}

function getMessageRole(msg: WindsurfMessage): 'user' | 'assistant' | 'tool' | 'system' {
	if (msg.role === 'user' || msg.type === 'user') return 'user';
	if (msg.role === 'assistant' || msg.role === 'ai' || msg.type === 'assistant' || msg.type === 'ai') return 'assistant';
	if (msg.role === 'tool' || msg.type === 'tool') return 'tool';
	return 'system';
}

function getMessageText(msg: WindsurfMessage): string {
	return msg.content || msg.text || msg.message || '';
}

function getTimestamp(msg: WindsurfMessage): string {
	const ts = msg.timestamp || msg.createdAt;
	if (!ts) return new Date().toISOString();
	if (typeof ts === 'string') return ts;
	const ms = ts > 1e12 ? ts : ts * 1000;
	return new Date(ms).toISOString();
}

function getConvId(conv: WindsurfConversation): string {
	return conv.conversationId || conv.id || crypto.randomUUID();
}

function getConvTimestamp(conv: WindsurfConversation, position: 'start' | 'end'): string {
	const messages = extractMessages(conv);
	if (messages.length > 0) {
		const msg = position === 'start' ? messages[0] : messages[messages.length - 1];
		return getTimestamp(msg);
	}
	const raw = position === 'start' ? conv.createdAt : (conv.updatedAt || conv.createdAt);
	if (typeof raw === 'number') {
		const ms = raw > 1e12 ? raw : raw * 1000;
		return new Date(ms).toISOString();
	}
	if (typeof raw === 'string') return raw;
	return new Date().toISOString();
}

export class WindsurfProvider implements SessionProvider {
	type = 'windsurf' as const;

	async discoverSessions(): Promise<SessionSummary[]> {
		const sessions: SessionSummary[] = [];
		const storagePaths = getWindsurfStoragePaths();

		for (const storagePath of storagePaths) {
			let entries: string[];
			try {
				entries = await readdir(storagePath);
			} catch {
				continue;
			}

			for (const entry of entries) {
				const entryPath = join(storagePath, entry);

				// Check for state.vscdb (same approach as Cursor)
				const dbPath = join(entryPath, 'state.vscdb');
				try {
					const s = await stat(dbPath);
					if (!s.isFile()) continue;
				} catch {
					// Also try reading JSON-based conversation files
					await this.discoverJsonSessions(entryPath, sessions);
					continue;
				}

				try {
					// Dynamic import for better-sqlite3 (same as Cursor provider)
					const Database = (await import('better-sqlite3')).default;
					const db = new Database(dbPath, { readonly: true });

					try {
						const projectName = getWorkspaceName(entryPath);

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

									const conversations = this.extractConversations(parsed);

									for (const conv of conversations) {
										const messages = extractMessages(conv);
										if (messages.length < 2) continue;

										const session = this.buildSessionSummary(
											conv, messages, projectName, dbPath, row.key, entryPath
										);
										if (session) sessions.push(session);
									}
								} catch {
									// Skip unparseable
								}
							}
						}
					} finally {
						db.close();
					}
				} catch {
					// SQLite not available or DB corrupt
				}
			}
		}

		sessions.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
		return sessions;
	}

	/** Discover sessions from JSON files (Windsurf sometimes stores conversations as JSON) */
	private async discoverJsonSessions(dir: string, sessions: SessionSummary[]): Promise<void> {
		try {
			const files = await readdir(dir);
			for (const file of files) {
				if (!file.endsWith('.json') || !file.includes('cascade')) continue;
				try {
					const content = await readFile(join(dir, file), 'utf-8');
					const parsed = JSON.parse(content);
					const conversations = this.extractConversations(parsed);

					for (const conv of conversations) {
						const messages = extractMessages(conv);
						if (messages.length < 2) continue;

						const projectName = getWorkspaceName(dir);
						const session = this.buildSessionSummary(
							conv, messages, projectName, join(dir, file), file, dir
						);
						if (session) sessions.push(session);
					}
				} catch {
					// Skip
				}
			}
		} catch {
			// Dir not readable
		}
	}

	private extractConversations(parsed: unknown): WindsurfConversation[] {
		const conversations: WindsurfConversation[] = [];
		if (Array.isArray(parsed)) {
			conversations.push(...parsed);
		} else if (typeof parsed === 'object' && parsed !== null) {
			const obj = parsed as Record<string, unknown>;
			if (obj.conversations && Array.isArray(obj.conversations)) {
				conversations.push(...obj.conversations);
			} else if (obj.tabs && Array.isArray(obj.tabs)) {
				conversations.push(...obj.tabs);
			} else if (obj.messages || obj.turns) {
				conversations.push(obj as WindsurfConversation);
			}
		}
		return conversations;
	}

	private buildSessionSummary(
		conv: WindsurfConversation,
		messages: WindsurfMessage[],
		projectName: string,
		dbPath: string,
		conversationKey: string,
		workspaceDir: string
	): SessionSummary | null {
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
			if (msg.tokens) {
				if (role === 'user') inputTokens += msg.tokens;
				else if (role === 'assistant') outputTokens += msg.tokens;
			}

			// Count tool calls
			if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
				toolCallCount += msg.toolCalls.length;
			}
			if (msg.toolName || role === 'tool') {
				toolCallCount++;
			}
		}

		const slug = conv.title || conv.name ||
			getMessageText(messages.find((m) => getMessageRole(m) === 'user') || messages[0]).slice(0, 60) ||
			'Windsurf conversation';

		return {
			sessionId: `windsurf-${convId}`,
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
			provider: 'windsurf',
			providerMeta: {
				dbPath,
				conversationKey,
				conversationId: convId,
				workspaceDir
			}
		};
	}

	async parseSession(sessionId: string, meta: Record<string, string>): Promise<SessionTimeline> {
		const { dbPath, conversationKey, conversationId } = meta;

		// Try JSON file first
		if (dbPath.endsWith('.json')) {
			const content = await readFile(dbPath, 'utf-8');
			const parsed = JSON.parse(content);
			const conversations = this.extractConversations(parsed);
			const conv = conversations.find((c) => getConvId(c) === conversationId);
			if (conv) return buildTimeline(conv, sessionId, meta);
			throw new Error(`Conversation ${conversationId} not found`);
		}

		// SQLite DB
		const Database = (await import('better-sqlite3')).default;
		const db = new Database(dbPath, { readonly: true });
		try {
			const rows = db.prepare(
				'SELECT value FROM ItemTable WHERE key LIKE ?'
			).all(`%${conversationKey}%`) as Array<{ value: string | Buffer }>;

			for (const row of rows) {
				const raw = typeof row.value === 'string' ? row.value : row.value.toString('utf-8');
				const parsed = JSON.parse(raw);
				const conversations = this.extractConversations(parsed);
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
	conv: WindsurfConversation,
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
		if (msg.tokens) {
			if (role === 'user') inputTokens += msg.tokens;
			else if (role === 'assistant') outputTokens += msg.tokens;
		}

		// Handle tool calls embedded in assistant messages
		if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
			// First emit the text if there is any
			if (text.trim()) {
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: { eventType: 'assistant_text', text }
				});
				eventIndex++;
			}

			for (const tc of msg.toolCalls) {
				const toolName = tc.name || tc.function || 'unknown';
				let input: Record<string, unknown> = {};
				if (typeof tc.arguments === 'string') {
					try { input = JSON.parse(tc.arguments); } catch { input = { raw: tc.arguments }; }
				} else if (tc.arguments) {
					input = tc.arguments;
				}

				const result = tc.result || tc.output;
				const data: TimelineEventData = {
					eventType: 'tool_call',
					toolName,
					toolUseId: `ws-${eventIndex}`,
					input,
					...(result ? { result: { content: result, isError: false } } : {})
				};

				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data
				});
				eventIndex++;
				toolCallCount++;
			}
			continue;
		}

		// Handle standalone tool result messages
		if (role === 'tool' && (msg.toolName || msg.toolOutput)) {
			const data: TimelineEventData = {
				eventType: 'tool_call',
				toolName: msg.toolName || 'tool',
				toolUseId: `ws-${eventIndex}`,
				input: msg.toolInput || {},
				result: { content: msg.toolOutput || text, isError: false }
			};
			events.push({
				id: `evt-${eventIndex}`,
				index: eventIndex,
				timestamp,
				data
			});
			eventIndex++;
			toolCallCount++;
			continue;
		}

		if (!text.trim()) continue;

		let data: TimelineEventData;
		if (role === 'user') {
			data = { eventType: 'user_message', text };
		} else if (role === 'assistant') {
			data = { eventType: 'assistant_text', text };
		} else {
			data = { eventType: 'system', subtype: 'windsurf' };
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
		'Windsurf conversation';

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
		inputTokens,
		outputTokens,
		estimatedCost: estimateCost(model, inputTokens, outputTokens),
		filePath: meta.dbPath,
		provider: 'windsurf',
		providerMeta: meta
	};

	return { summary, events };
}
