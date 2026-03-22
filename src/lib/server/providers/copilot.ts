import { join } from 'path';
import { homedir } from 'os';
import { readdir, readFile, stat } from 'fs/promises';
import type { SessionProvider } from './types';
import type { SessionSummary, SessionTimeline, TimelineEvent, TimelineEventData } from '$lib/types/timeline';

/**
 * GitHub Copilot Chat stores conversation data in VS Code's workspace storage:
 *   ~/Library/Application Support/Code/User/workspaceStorage/  (macOS)
 *   ~/.config/Code/User/workspaceStorage/  (Linux)
 *   %APPDATA%/Code/User/workspaceStorage/  (Windows)
 *
 * The conversations can be found in:
 *   - state.vscdb (SQLite) with key patterns like 'interactive.sessions' or 'chat.sessions'
 *   - JSON files in globalStorage/github.copilot-chat/
 */

function getVSCodeStoragePaths(): string[] {
	const home = homedir();
	const platform = process.platform;

	if (platform === 'darwin') {
		return [
			join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'github.copilot-chat'),
			join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage', 'github.copilot-chat')
		];
	}
	if (platform === 'linux') {
		return [
			join(home, '.config', 'Code', 'User', 'globalStorage', 'github.copilot-chat'),
			join(home, '.config', 'Code - Insiders', 'User', 'globalStorage', 'github.copilot-chat')
		];
	}
	if (platform === 'win32') {
		const appdata = process.env.APPDATA || join(home, 'AppData', 'Roaming');
		return [
			join(appdata, 'Code', 'User', 'globalStorage', 'github.copilot-chat'),
			join(appdata, 'Code - Insiders', 'User', 'globalStorage', 'github.copilot-chat')
		];
	}
	return [];
}

interface CopilotMessage {
	role: string;
	content: string;
	name?: string;
	timestamp?: number;
}

interface CopilotConversation {
	id?: string;
	title?: string;
	messages?: CopilotMessage[];
	turns?: Array<{
		request?: string | { message?: string; text?: string };
		response?: string | { message?: string; text?: string };
		timestamp?: number;
	}>;
	createdAt?: number;
	updatedAt?: number;
	lastInteraction?: number;
}

function getMessageText(msg: CopilotMessage | { request?: string | { message?: string; text?: string }; response?: string | { message?: string; text?: string } }): string {
	if ('content' in msg) return msg.content || '';
	if ('request' in msg) {
		const req = msg.request;
		if (typeof req === 'string') return req;
		if (req && typeof req === 'object') return req.message || req.text || '';
	}
	return '';
}

export class CopilotProvider implements SessionProvider {
	type = 'copilot' as const;

	async discoverSessions(): Promise<SessionSummary[]> {
		const sessions: SessionSummary[] = [];
		const storagePaths = getVSCodeStoragePaths();

		for (const storagePath of storagePaths) {
			try {
				await this.scanCopilotStorage(storagePath, sessions);
			} catch {
				continue;
			}
		}

		sessions.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
		return sessions;
	}

	private async scanCopilotStorage(dir: string, sessions: SessionSummary[]): Promise<void> {
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!entry.endsWith('.json')) continue;
			const filePath = join(dir, entry);

			try {
				const content = await readFile(filePath, 'utf-8');
				const parsed = JSON.parse(content);

				const conversations: CopilotConversation[] = [];
				if (Array.isArray(parsed)) {
					conversations.push(...parsed);
				} else if (parsed.conversations && Array.isArray(parsed.conversations)) {
					conversations.push(...parsed.conversations);
				} else if (parsed.sessions && Array.isArray(parsed.sessions)) {
					conversations.push(...parsed.sessions);
				} else if (parsed.messages || parsed.turns) {
					conversations.push(parsed);
				}

				for (const conv of conversations) {
					const messageCount = (conv.messages?.length || 0) + (conv.turns?.length || 0) * 2;
					if (messageCount < 2) continue;

					const id = conv.id || `copilot-${Buffer.from(filePath + (conv.title || '')).toString('base64url').slice(0, 16)}`;
					const ts = conv.createdAt || conv.lastInteraction || conv.updatedAt;
					const startedAt = ts ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString() : new Date().toISOString();
					const endTs = conv.updatedAt || conv.lastInteraction || conv.createdAt;
					const lastActiveAt = endTs ? new Date(endTs > 1e12 ? endTs : endTs * 1000).toISOString() : startedAt;

					const slug = conv.title || 'Copilot Chat';

					sessions.push({
						sessionId: `copilot-${id}`,
						project: 'Copilot Chat',
						slug,
						startedAt,
						lastActiveAt,
						model: 'gpt-4',
						version: '',
						eventCount: messageCount,
						toolCallCount: 0,
						errorCount: 0,
						inputTokens: 0,
						outputTokens: 0,
						cacheReadTokens: 0,
						estimatedCost: 0,
						filePath,
						provider: 'copilot',
						providerMeta: {
							filePath,
							conversationId: id
						}
					});
				}
			} catch {
				// Skip unreadable
			}
		}
	}

	async parseSession(sessionId: string, meta: Record<string, string>): Promise<SessionTimeline> {
		const { filePath, conversationId } = meta;
		const content = await readFile(filePath, 'utf-8');
		const parsed = JSON.parse(content);

		let conversations: CopilotConversation[] = [];
		if (Array.isArray(parsed)) {
			conversations = parsed;
		} else if (parsed.conversations) {
			conversations = parsed.conversations;
		} else if (parsed.sessions) {
			conversations = parsed.sessions;
		} else if (parsed.messages || parsed.turns) {
			conversations = [parsed];
		}

		const conv = conversations.find(c => (c.id || '') === conversationId) || conversations[0];
		if (!conv) throw new Error(`Conversation ${conversationId} not found`);

		const events: TimelineEvent[] = [];
		let eventIndex = 0;
		const now = new Date().toISOString();

		// Parse messages format
		if (conv.messages && Array.isArray(conv.messages)) {
			for (const msg of conv.messages) {
				const timestamp = msg.timestamp
					? new Date(msg.timestamp > 1e12 ? msg.timestamp : msg.timestamp * 1000).toISOString()
					: now;

				let data: TimelineEventData;
				if (msg.role === 'user') {
					data = { eventType: 'user_message', text: msg.content || '' };
				} else if (msg.role === 'assistant') {
					data = { eventType: 'assistant_text', text: msg.content || '' };
				} else {
					data = { eventType: 'system', subtype: msg.role || 'copilot' };
				}

				events.push({ id: `evt-${eventIndex}`, index: eventIndex, timestamp, data });
				eventIndex++;
			}
		}

		// Parse turns format
		if (conv.turns && Array.isArray(conv.turns)) {
			for (const turn of conv.turns) {
				const timestamp = turn.timestamp
					? new Date(turn.timestamp > 1e12 ? turn.timestamp : turn.timestamp * 1000).toISOString()
					: now;

				if (turn.request) {
					const text = typeof turn.request === 'string' ? turn.request : (turn.request.message || turn.request.text || '');
					if (text.trim()) {
						events.push({
							id: `evt-${eventIndex}`, index: eventIndex, timestamp,
							data: { eventType: 'user_message', text }
						});
						eventIndex++;
					}
				}

				if (turn.response) {
					const text = typeof turn.response === 'string' ? turn.response : (turn.response.message || turn.response.text || '');
					if (text.trim()) {
						events.push({
							id: `evt-${eventIndex}`, index: eventIndex, timestamp,
							data: { eventType: 'assistant_text', text }
						});
						eventIndex++;
					}
				}
			}
		}

		const ts = conv.createdAt || conv.lastInteraction;
		const startedAt = ts ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString() : now;
		const endTs = conv.updatedAt || conv.lastInteraction;
		const lastActiveAt = endTs ? new Date(endTs > 1e12 ? endTs : endTs * 1000).toISOString() : startedAt;

		const summary: SessionSummary = {
			sessionId,
			project: 'Copilot Chat',
			slug: conv.title || 'Copilot Chat',
			startedAt,
			lastActiveAt,
			model: 'gpt-4',
			version: '',
			eventCount: events.length,
			toolCallCount: 0,
			errorCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			estimatedCost: 0,
			filePath,
			provider: 'copilot',
			providerMeta: meta
		};

		return { summary, events };
	}
}
