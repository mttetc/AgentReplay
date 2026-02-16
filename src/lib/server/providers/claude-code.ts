import type { SessionProvider } from './types';
import type { SessionSummary, SessionTimeline } from '$lib/types/timeline';
import { discoverSessions } from '$lib/server/discovery';
import { parseSession } from '$lib/server/parser';

export class ClaudeCodeProvider implements SessionProvider {
	type = 'claude-code' as const;

	async discoverSessions(): Promise<SessionSummary[]> {
		return discoverSessions();
	}

	async parseSession(sessionId: string, meta: Record<string, string>): Promise<SessionTimeline> {
		return parseSession(meta.filePath, sessionId, meta.project);
	}
}
