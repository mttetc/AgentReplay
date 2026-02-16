import type { SessionProvider, ProviderType } from './types';
import type { SessionSummary, SessionTimeline } from '$lib/types/timeline';
import { ClaudeCodeProvider } from './claude-code';
import { CursorProvider } from './cursor';

const providers: SessionProvider[] = [
	new ClaudeCodeProvider(),
	new CursorProvider()
];

const providerMap = new Map<ProviderType, SessionProvider>(
	providers.map((p) => [p.type, p])
);

/** Discover sessions from all providers in parallel */
export async function discoverAllSessions(): Promise<SessionSummary[]> {
	const results = await Promise.allSettled(
		providers.map((p) => p.discoverSessions())
	);

	const sessions: SessionSummary[] = [];
	for (const result of results) {
		if (result.status === 'fulfilled') {
			sessions.push(...result.value);
		}
	}

	sessions.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
	return sessions;
}

/** Parse a session using the correct provider */
export async function parseSessionByProvider(
	sessionId: string,
	provider: ProviderType,
	meta: Record<string, string>
): Promise<SessionTimeline> {
	const p = providerMap.get(provider);
	if (!p) throw new Error(`Unknown provider: ${provider}`);
	return p.parseSession(sessionId, meta);
}
