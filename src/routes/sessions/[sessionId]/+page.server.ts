import type { PageServerLoad } from './$types';
import { parseSession } from '$lib/server/parser';
import { parseSessionByProvider } from '$lib/server/providers';
import { error } from '@sveltejs/kit';
import { CLAUDE_DIR } from '$lib/server/config';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import type { ProviderType } from '$lib/server/providers/types';

function decodeProjectName(dirName: string): string {
	return dirName.replace(/-/g, '/').replace(/^\//, '');
}

export const load: PageServerLoad = async ({ params, url }) => {
	const { sessionId } = params;
	const provider = (url.searchParams.get('provider') || 'claude-code') as ProviderType;

	// Cursor sessions: route through provider with metadata
	if (provider === 'cursor') {
		const meta: Record<string, string> = {};
		for (const [key, value] of url.searchParams.entries()) {
			if (key !== 'provider') meta[key] = value;
		}

		try {
			const timeline = await parseSessionByProvider(sessionId, 'cursor', meta);
			return { timeline };
		} catch (e) {
			throw error(500, `Failed to parse Cursor session: ${e instanceof Error ? e.message : 'Unknown error'}`);
		}
	}

	// Claude Code sessions: existing logic
	let filePath = url.searchParams.get('file');
	let project = url.searchParams.get('project') || '';

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
		return { timeline };
	} catch (e) {
		throw error(500, `Failed to parse session: ${e instanceof Error ? e.message : 'Unknown error'}`);
	}
};
