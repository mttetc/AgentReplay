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

export interface DiscoveryResult {
	sessions: SessionSummary[];
	providerErrors: Array<{ provider: string; error: string }>;
}

/** Cache for discovery results */
let cachedResult: DiscoveryResult | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

/** Discover sessions from all providers in parallel (cached) */
export async function discoverAllSessions(): Promise<DiscoveryResult> {
	const now = Date.now();
	if (cachedResult && (now - cacheTimestamp) < CACHE_TTL_MS) {
		return cachedResult;
	}

	const results = await Promise.allSettled(
		providers.map((p) => p.discoverSessions())
	);

	const sessions: SessionSummary[] = [];
	const providerErrors: Array<{ provider: string; error: string }> = [];
	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		if (result.status === 'fulfilled') {
			sessions.push(...result.value);
		} else {
			providerErrors.push({
				provider: providers[i].type,
				error: result.reason instanceof Error ? result.reason.message : String(result.reason)
			});
		}
	}

	sessions.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());

	cachedResult = { sessions, providerErrors };
	cacheTimestamp = now;

	return cachedResult;
}

/** Invalidate the discovery cache so the next call fetches fresh data */
export function invalidateDiscoveryCache() {
	cachedResult = null;
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
