import type { SessionProvider, ProviderType } from './types';
import type { SessionSummary, SessionTimeline } from '$lib/types/timeline';
import { ClaudeCodeProvider } from './claude-code';
import { CursorProvider } from './cursor';
import { WindsurfProvider } from './windsurf';
import { AiderProvider } from './aider';
import { CopilotProvider } from './copilot';

const providers: SessionProvider[] = [
	new ClaudeCodeProvider(),
	new CursorProvider(),
	new WindsurfProvider(),
	new AiderProvider(),
	new CopilotProvider()
];

const providerMap = new Map<ProviderType, SessionProvider>(
	providers.map((p) => [p.type, p])
);

/** Cache for discovery results */
let cachedSessions: SessionSummary[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

/** Discover sessions from all providers in parallel (cached) */
export async function discoverAllSessions(): Promise<SessionSummary[]> {
	const now = Date.now();
	if (cachedSessions && (now - cacheTimestamp) < CACHE_TTL_MS) {
		return cachedSessions;
	}

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

	cachedSessions = sessions;
	cacheTimestamp = now;

	return sessions;
}

/** Invalidate the discovery cache so the next call fetches fresh data */
export function invalidateDiscoveryCache() {
	cachedSessions = null;
	cacheTimestamp = 0;
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
