import { readdir, access } from 'fs/promises';
import { join, resolve } from 'path';
import { z } from 'zod';
import { CLAUDE_DIR } from './config';
import { parseSession } from './parser';
import { parseSessionByProvider } from './providers';
import type { ProviderType } from './providers/types';
import type { SessionTimeline } from '$lib/types/timeline';

/**
 * Shared session loader used by the session page and the API routes, so that
 * both resolve a session from the same URL-style parameters:
 *   sessionId + provider (+ file/project for Claude Code, + provider meta otherwise)
 */

export const VALID_PROVIDERS: ProviderType[] = ['claude-code', 'cursor', 'windsurf', 'aider', 'copilot'];
export const sessionIdSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
export const providerSchema = z.enum(['claude-code', 'cursor', 'windsurf', 'aider', 'copilot']);

export class SessionLoadError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

function decodeProjectName(dirName: string): string {
	return dirName.replace(/-/g, '/').replace(/^\//, '');
}

export async function loadTimeline(
	rawSessionId: string,
	rawProvider: string | null,
	params: Record<string, string>
): Promise<SessionTimeline> {
	const sessionIdResult = sessionIdSchema.safeParse(rawSessionId);
	if (!sessionIdResult.success) throw new SessionLoadError(400, 'Invalid session ID');
	const sessionId = sessionIdResult.data;

	const providerResult = providerSchema.safeParse(rawProvider || 'claude-code');
	if (!providerResult.success) {
		throw new SessionLoadError(400, `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}`);
	}
	const provider = providerResult.data;

	if (provider !== 'claude-code') {
		const meta: Record<string, string> = {};
		for (const [key, value] of Object.entries(params)) {
			if (key !== 'provider') meta[key] = value;
		}
		try {
			return await parseSessionByProvider(sessionId, provider, meta);
		} catch (e) {
			throw new SessionLoadError(
				500,
				`Failed to parse ${provider} session: ${e instanceof Error ? e.message : 'Unknown error'}`
			);
		}
	}

	let filePath = params.file || '';
	let project = params.project || '';

	if (filePath) {
		const resolved = resolve(filePath);
		if (!resolved.startsWith(CLAUDE_DIR)) throw new SessionLoadError(400, 'Invalid file path');
	}

	if (!filePath) {
		let projectDirs: string[];
		try {
			projectDirs = await readdir(CLAUDE_DIR);
		} catch {
			throw new SessionLoadError(500, 'Cannot read Claude sessions directory');
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
		if (!filePath) throw new SessionLoadError(404, `Session ${sessionId} not found`);
	}

	try {
		return await parseSession(filePath, sessionId, project);
	} catch (e) {
		throw new SessionLoadError(
			500,
			`Failed to parse session: ${e instanceof Error ? e.message : 'Unknown error'}`
		);
	}
}
