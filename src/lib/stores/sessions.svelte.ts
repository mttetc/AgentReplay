import type { SessionSummary } from '$lib/types/timeline';

let cached = $state<SessionSummary[] | null>(null);
let fetchedAt = $state(0);

const CLIENT_TTL = 60_000; // 1 minute

export function getCachedSessions(): SessionSummary[] | null {
	if (cached && (Date.now() - fetchedAt) < CLIENT_TTL) {
		return cached;
	}
	return null;
}

export function setCachedSessions(sessions: SessionSummary[]) {
	cached = sessions;
	fetchedAt = Date.now();
}
