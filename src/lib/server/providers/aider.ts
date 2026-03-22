import { homedir } from 'os';
import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, dirname } from 'path';
import type { SessionProvider } from './types';
import type { SessionSummary, SessionTimeline, TimelineEvent, TimelineEventData } from '$lib/types/timeline';

/**
 * Aider stores conversation history in markdown files:
 *   .aider.chat.history.md — full chat history
 *   .aider.input.history — input history (commands)
 *
 * The chat history format is:
 *   #### /user-command or text
 *   > assistant response
 *
 * Aider also creates .aider.tags.cache.* files and .aider.conf.yml
 */

const AIDER_HISTORY_FILE = '.aider.chat.history.md';

/** Common directories where projects with Aider are likely found */
function getSearchPaths(): string[] {
	const home = homedir();
	return [
		join(home, 'Projects'),
		join(home, 'projects'),
		join(home, 'repos'),
		join(home, 'src'),
		join(home, 'code'),
		join(home, 'dev'),
		join(home, 'Developer'),
		join(home, 'workspace'),
		home
	];
}

interface AiderMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp?: string;
	filesReferenced: string[];
}

function parseAiderHistory(content: string): AiderMessage[] {
	const messages: AiderMessage[] = [];
	const lines = content.split('\n');
	let currentRole: 'user' | 'assistant' | 'system' = 'system';
	let currentContent: string[] = [];
	let currentFiles: string[] = [];

	for (const line of lines) {
		// User message: starts with #### (heading)
		if (line.startsWith('#### ')) {
			// Flush previous message
			if (currentContent.length > 0) {
				messages.push({
					role: currentRole,
					content: currentContent.join('\n').trim(),
					filesReferenced: currentFiles
				});
			}

			currentRole = 'user';
			currentContent = [line.slice(5)]; // Remove "#### "
			currentFiles = [];

			// Detect file references in user commands
			// /add file.py, /read file.py, etc.
			const fileMatch = line.match(/\/(?:add|read|drop|edit)\s+(.+)/);
			if (fileMatch) {
				currentFiles.push(...fileMatch[1].split(/\s+/).filter(Boolean));
			}
			continue;
		}

		// Assistant response: starts with > (blockquote) or is indented after user message
		if (line.startsWith('> ')) {
			if (currentRole !== 'assistant') {
				// Flush user message
				if (currentContent.length > 0) {
					messages.push({
						role: currentRole,
						content: currentContent.join('\n').trim(),
						filesReferenced: currentFiles
					});
				}
				currentRole = 'assistant';
				currentContent = [];
				currentFiles = [];
			}
			currentContent.push(line.slice(2));

			// Detect file references in assistant responses
			const fileRefs = line.match(/`([^`]+\.\w{1,8})`/g);
			if (fileRefs) {
				for (const ref of fileRefs) {
					currentFiles.push(ref.replace(/`/g, ''));
				}
			}
			continue;
		}

		// Continuation of current message
		if (line.trim() === '' && currentContent.length > 0) {
			// Empty line might separate messages
			currentContent.push('');
		} else if (line.trim()) {
			currentContent.push(line);
		}
	}

	// Flush last message
	if (currentContent.length > 0) {
		messages.push({
			role: currentRole,
			content: currentContent.join('\n').trim(),
			filesReferenced: currentFiles
		});
	}

	return messages.filter(m => m.content.trim());
}

export class AiderProvider implements SessionProvider {
	type = 'aider' as const;

	async discoverSessions(): Promise<SessionSummary[]> {
		const sessions: SessionSummary[] = [];
		const searchPaths = getSearchPaths();

		for (const searchPath of searchPaths) {
			await this.scanDirectory(searchPath, sessions, 0);
		}

		// Deduplicate by file path
		const seen = new Set<string>();
		const unique = sessions.filter(s => {
			if (seen.has(s.filePath)) return false;
			seen.add(s.filePath);
			return true;
		});

		unique.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
		return unique;
	}

	private async scanDirectory(dir: string, sessions: SessionSummary[], depth: number): Promise<void> {
		if (depth > 2) return; // Don't recurse too deep

		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			return;
		}

		// Check if this directory has an Aider history file
		if (entries.includes(AIDER_HISTORY_FILE)) {
			const filePath = join(dir, AIDER_HISTORY_FILE);
			try {
				const fileStat = await stat(filePath);
				const content = await readFile(filePath, 'utf-8');
				const messages = parseAiderHistory(content);

				if (messages.length >= 2) {
					const projectName = basename(dir);
					sessions.push({
						sessionId: `aider-${Buffer.from(filePath).toString('base64url').slice(0, 16)}`,
						project: projectName,
						slug: `Aider: ${projectName}`,
						startedAt: new Date(fileStat.birthtimeMs).toISOString(),
						lastActiveAt: new Date(fileStat.mtimeMs).toISOString(),
						model: 'unknown',
						version: '',
						eventCount: messages.length,
						toolCallCount: messages.filter(m => m.filesReferenced.length > 0).length,
						errorCount: 0,
						inputTokens: 0,
						outputTokens: 0,
						estimatedCost: 0,
						filePath,
						provider: 'aider',
						providerMeta: { filePath, projectDir: dir }
					});
				}
			} catch {
				// Skip unreadable files
			}
		}

		// Recurse into subdirectories (but not hidden dirs or node_modules)
		for (const entry of entries) {
			if (entry.startsWith('.') || entry === 'node_modules' || entry === 'vendor' || entry === '.git') continue;
			const entryPath = join(dir, entry);
			try {
				const s = await stat(entryPath);
				if (s.isDirectory()) {
					await this.scanDirectory(entryPath, sessions, depth + 1);
				}
			} catch {
				continue;
			}
		}
	}

	async parseSession(sessionId: string, meta: Record<string, string>): Promise<SessionTimeline> {
		const { filePath, projectDir } = meta;
		const content = await readFile(filePath, 'utf-8');
		const messages = parseAiderHistory(content);

		const events: TimelineEvent[] = [];
		let eventIndex = 0;
		const fileStat = await stat(filePath);

		for (const msg of messages) {
			const timestamp = new Date(fileStat.mtimeMs).toISOString();

			if (msg.role === 'user') {
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: { eventType: 'user_message', text: msg.content }
				});
				eventIndex++;

				// Create tool call events for file references
				for (const file of msg.filesReferenced) {
					events.push({
						id: `evt-${eventIndex}`,
						index: eventIndex,
						timestamp,
						data: {
							eventType: 'tool_call',
							toolName: 'Edit',
							toolUseId: `aider-${eventIndex}`,
							input: { file_path: join(projectDir || '', file) },
							result: { content: `Referenced: ${file}`, isError: false }
						}
					});
					eventIndex++;
				}
			} else if (msg.role === 'assistant') {
				events.push({
					id: `evt-${eventIndex}`,
					index: eventIndex,
					timestamp,
					data: { eventType: 'assistant_text', text: msg.content }
				});
				eventIndex++;

				// Parse code blocks as file edits
				const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
				let match;
				while ((match = codeBlockRegex.exec(msg.content)) !== null) {
					const lang = match[1];
					const code = match[2].trim();
					if (code && msg.filesReferenced.length > 0) {
						events.push({
							id: `evt-${eventIndex}`,
							index: eventIndex,
							timestamp,
							data: {
								eventType: 'tool_call',
								toolName: 'Write',
								toolUseId: `aider-write-${eventIndex}`,
								input: {
									file_path: msg.filesReferenced[0],
									content: code
								},
								result: { content: code, isError: false }
							}
						});
						eventIndex++;
					}
				}
			}
		}

		const projectName = basename(projectDir || dirname(filePath));

		const summary: SessionSummary = {
			sessionId,
			project: projectName,
			slug: `Aider: ${projectName}`,
			startedAt: new Date(fileStat.birthtimeMs).toISOString(),
			lastActiveAt: new Date(fileStat.mtimeMs).toISOString(),
			model: 'unknown',
			version: '',
			eventCount: events.length,
			toolCallCount: events.filter(e => e.data.eventType === 'tool_call').length,
			errorCount: 0,
			inputTokens: 0,
			outputTokens: 0,
			estimatedCost: 0,
			filePath,
			provider: 'aider',
			providerMeta: meta
		};

		return { summary, events };
	}
}
