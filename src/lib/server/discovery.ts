import { readdir, stat, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { CLAUDE_DIR } from './config';
import { estimateCost } from '$lib/utils/cost';
import { getIndexedSession, setIndexedSession } from './db';
import type { SessionSummary } from '$lib/types/timeline';
import type { RawEntry, RawAssistantEntry, RawUserEntry } from '$lib/types/raw';

/** Decode project directory name back to a readable path */
function decodeProjectName(dirName: string): string {
	return dirName.replace(/-/g, '/').replace(/^\//, '');
}

/** Scan all JSONL session files across all project directories */
export async function discoverSessions(): Promise<SessionSummary[]> {
	const sessions: SessionSummary[] = [];

	let projectDirs: string[];
	try {
		projectDirs = await readdir(CLAUDE_DIR);
	} catch {
		return [];
	}

	const allPromises: Promise<SessionSummary | null>[] = [];

	for (const projectDir of projectDirs) {
		const projectPath = join(CLAUDE_DIR, projectDir);
		const projectStat = await stat(projectPath).catch(() => null);
		if (!projectStat?.isDirectory()) continue;

		let files: string[];
		try {
			files = await readdir(projectPath);
		} catch {
			continue;
		}

		for (const file of files) {
			if (!file.endsWith('.jsonl')) continue;

			const filePath = join(projectPath, file);
			const sessionId = basename(file, '.jsonl');

			allPromises.push(
				buildSummaryWithCache(filePath, sessionId, projectDir).catch(() => null)
			);
		}
	}

	const results = await Promise.all(allPromises);
	for (const result of results) {
		if (result) sessions.push(result);
	}

	// Sort by most recent first
	sessions.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
	return sessions;
}

async function buildSummaryWithCache(
	filePath: string,
	sessionId: string,
	projectDir: string
): Promise<SessionSummary | null> {
	const fileStat = await stat(filePath).catch(() => null);
	if (!fileStat) return null;

	const mtimeMs = fileStat.mtimeMs;
	const cached = getIndexedSession(filePath);

	if (cached && cached.fileMtime === mtimeMs) {
		try {
			return JSON.parse(cached.summaryJson) as SessionSummary;
		} catch {
			// Corrupted cache entry, fall through to rebuild
		}
	}

	const summary = await buildSummary(filePath, sessionId, projectDir);
	if (summary) {
		setIndexedSession(sessionId, filePath, mtimeMs, 'claude-code', JSON.stringify(summary));
	}
	return summary;
}

async function buildSummary(
	filePath: string,
	sessionId: string,
	projectDir: string
): Promise<SessionSummary | null> {
	const content = await readFile(filePath, 'utf-8');
	const lines = content.split('\n').filter((l) => l.trim());

	if (lines.length === 0) return null;

	let slug = '';
	let model = '';
	let version = '';
	let gitBranch = '';
	let cwd = '';
	let startedAt = '';
	let lastActiveAt = '';
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheCreationTokens = 0;
	let toolCallCount = 0;
	let errorCount = 0;
	let eventCount = 0;

	for (const line of lines) {
		let entry: RawEntry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}

		const entryType: string = entry.type;
		if (entryType === 'progress' || entryType === 'queue-operation')
			continue;

		if (entry.type === 'user') {
			const userEntry = entry as RawUserEntry;
			if (!startedAt && userEntry.timestamp) startedAt = userEntry.timestamp;
			if (userEntry.timestamp) lastActiveAt = userEntry.timestamp;
			if (userEntry.slug && !slug) slug = userEntry.slug;
			if (userEntry.version && !version) version = userEntry.version;
			if (userEntry.gitBranch && !gitBranch) gitBranch = userEntry.gitBranch;
			if (userEntry.cwd && !cwd) cwd = userEntry.cwd;
			// Count tool errors from tool_result blocks
			const userContent = userEntry.message?.content;
			if (Array.isArray(userContent)) {
				for (const block of userContent) {
					if (block.type === 'tool_result' && (block as { is_error?: boolean }).is_error) {
						errorCount++;
					}
				}
			}
			eventCount++;
		}

		if (entry.type === 'assistant') {
			const assistantEntry = entry as RawAssistantEntry;
			if (assistantEntry.timestamp) lastActiveAt = assistantEntry.timestamp;
			if (assistantEntry.message.model && !model && assistantEntry.message.model !== 'synthetic')
				model = assistantEntry.message.model;

			const usage = assistantEntry.message.usage;
			if (usage) {
				inputTokens += usage.input_tokens || 0;
				cacheReadTokens += usage.cache_read_input_tokens || 0;
				cacheCreationTokens += usage.cache_creation_input_tokens || 0;
				outputTokens += usage.output_tokens || 0;
			}

			const content = assistantEntry.message.content;
			if (Array.isArray(content)) {
				for (const block of content) {
					if (block.type === 'tool_use') toolCallCount++;
				}
			}
			eventCount++;
		}
	}

	if (!startedAt) return null;

	return {
		sessionId,
		project: decodeProjectName(projectDir),
		slug,
		startedAt,
		lastActiveAt,
		model,
		version,
		eventCount,
		toolCallCount,
		errorCount,
		inputTokens,
		outputTokens,
		cacheReadTokens,
		cacheCreationTokens,
		estimatedCost: estimateCost(
			model,
			inputTokens,
			outputTokens,
			cacheReadTokens,
			cacheCreationTokens
		),
		filePath,
		provider: 'claude-code',
		...(gitBranch && { gitBranch }),
		...(cwd && { cwd })
	};
}
