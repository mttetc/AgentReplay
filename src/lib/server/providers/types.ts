import type { SessionSummary, SessionTimeline } from '$lib/types/timeline';

export type ProviderType = 'claude-code' | 'cursor' | 'windsurf' | 'aider' | 'copilot';

export interface SessionProvider {
	type: ProviderType;
	discoverSessions(): Promise<SessionSummary[]>;
	parseSession(sessionId: string, meta: Record<string, string>): Promise<SessionTimeline>;
}
