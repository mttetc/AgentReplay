import type { PageServerLoad } from './$types';
import { parseSession } from '$lib/server/parser';
import { parseSessionByProvider } from '$lib/server/providers';
import { error } from '@sveltejs/kit';
import { CLAUDE_DIR } from '$lib/server/config';
import { readdir, access } from 'fs/promises';
import { join, resolve } from 'path';
import type { ProviderType } from '$lib/server/providers/types';
import { findRelatedCommits } from '$lib/server/git-integration';
import { analyzeSessionOverhead } from '$lib/server/overhead-analysis';
import { z } from 'zod';

const VALID_PROVIDERS: ProviderType[] = ['claude-code', 'cursor', 'windsurf', 'aider', 'copilot'];
const sessionIdSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
const providerSchema = z.enum(['claude-code', 'cursor', 'windsurf', 'aider', 'copilot']);

function decodeProjectName(dirName: string): string {
	return dirName.replace(/-/g, '/').replace(/^\//, '');
}

export const load: PageServerLoad = async ({ params, url }) => {
	const sessionIdResult = sessionIdSchema.safeParse(params.sessionId);
	if (!sessionIdResult.success) {
		throw error(400, 'Invalid session ID');
	}
	const sessionId = sessionIdResult.data;

	const providerResult = providerSchema.safeParse(url.searchParams.get('provider') || 'claude-code');
	if (!providerResult.success) {
		throw error(400, `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
	}
	const provider = providerResult.data;

	// Non-Claude-Code sessions: route through provider with metadata
	if (provider !== 'claude-code') {
		const meta: Record<string, string> = {};
		for (const [key, value] of url.searchParams.entries()) {
			if (key !== 'provider') meta[key] = value;
		}

		try {
			const timeline = await parseSessionByProvider(sessionId, provider, meta);
			const [commits, overhead] = await Promise.all([
				findRelatedCommits(
					timeline.summary.cwd || meta.project || timeline.summary.project,
					timeline.summary.startedAt,
					timeline.summary.lastActiveAt,
					timeline.events
				).catch(() => []),
				analyzeSessionOverhead(timeline).catch(() => null)
			]);
			return { timeline, commits, overhead };
		} catch (e) {
			throw error(500, `Failed to parse ${provider} session: ${e instanceof Error ? e.message : 'Unknown error'}`);
		}
	}

	// Claude Code sessions: existing logic
	let filePath = url.searchParams.get('file');
	let project = url.searchParams.get('project') || '';

	// Validate file path is within CLAUDE_DIR to prevent path traversal
	if (filePath) {
		const resolved = resolve(filePath);
		if (!resolved.startsWith(CLAUDE_DIR)) {
			throw error(400, 'Invalid file path');
		}
	}

	if (!filePath) {
		let projectDirs: string[];
		try {
			projectDirs = await readdir(CLAUDE_DIR);
		} catch {
			throw error(500, 'Cannot read Claude sessions directory');
		}

		for (const projectDir of projectDirs) {
			const candidate = join(CLAUDE_DIR, projectDir, `${sessionId}.jsonl`);
			try {
				await access(candidate);
				filePath = candidate;
				project = decodeProjectName(projectDir);
				break;
			} catch {
				continue;
			}
		}

		if (!filePath) {
			throw error(404, `Session ${sessionId} not found`);
		}
	}

	try {
		const timeline = await parseSession(filePath, sessionId, project);

		// Prefer cwd (actual path) over project (decoded, may have broken hyphens)
		const gitPath = timeline.summary.cwd || project;
		const [commits, overhead] = await Promise.all([
			findRelatedCommits(
				gitPath,
				timeline.summary.startedAt,
				timeline.summary.lastActiveAt,
				timeline.events
			).catch(() => []),
			analyzeSessionOverhead(timeline).catch(() => null)
		]);

		return { timeline, commits, overhead };
	} catch (e) {
		throw error(500, `Failed to parse session: ${e instanceof Error ? e.message : 'Unknown error'}`);
	}
};
