import type { PageServerLoad } from './$types';
import { discoverAllSessions } from '$lib/server/providers';
import { parseSessionByProvider } from '$lib/server/providers';
import { parseSession } from '$lib/server/parser';
import { CLAUDE_DIR } from '$lib/server/config';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import type { SessionSummary, SessionTimeline } from '$lib/types/timeline';
import type { ProviderType } from '$lib/server/providers/types';

export const load: PageServerLoad = async ({ url }) => {
	const sessions = await discoverAllSessions();
	const selectedSessionId = url.searchParams.get('session');

	// Load selected session timeline if requested
	let selectedTimeline: SessionTimeline | null = null;
	if (selectedSessionId) {
		const session = sessions.find((s) => s.sessionId === selectedSessionId);
		if (session) {
			try {
				if (session.provider === 'claude-code') {
					selectedTimeline = await parseSession(session.filePath, session.sessionId, session.project);
				} else if (session.providerMeta) {
					selectedTimeline = await parseSessionByProvider(
						session.sessionId,
						session.provider as ProviderType,
						session.providerMeta
					);
				}
			} catch {
				// Failed to load session, continue with global view
			}
		}
	}

	// Aggregations
	const dailyMap = new Map<string, { cost: number; sessions: number }>();
	const weeklyMap = new Map<string, { cost: number; sessions: number }>();
	const modelMap = new Map<string, { sessions: number; cost: number; tokens: number }>();
	const providerMap = new Map<string, { sessions: number; cost: number }>();
	let totalCost = 0, totalInputTokens = 0, totalOutputTokens = 0, totalToolCalls = 0, totalDuration = 0;

	for (const s of sessions) {
		// Daily
		const date = s.startedAt ? s.startedAt.slice(0, 10) : 'unknown';
		const daily = dailyMap.get(date) || { cost: 0, sessions: 0 };
		daily.cost += s.estimatedCost;
		daily.sessions++;
		dailyMap.set(date, daily);

		// Weekly
		if (s.startedAt) {
			const d = new Date(s.startedAt);
			const weekStart = new Date(d);
			weekStart.setDate(d.getDate() - d.getDay());
			const weekKey = weekStart.toISOString().slice(0, 10);
			const weekly = weeklyMap.get(weekKey) || { cost: 0, sessions: 0 };
			weekly.cost += s.estimatedCost;
			weekly.sessions++;
			weeklyMap.set(weekKey, weekly);
		}

		// Model
		const model = s.model || 'unknown';
		const m = modelMap.get(model) || { sessions: 0, cost: 0, tokens: 0 };
		m.sessions++;
		m.cost += s.estimatedCost;
		m.tokens += s.inputTokens + s.outputTokens;
		modelMap.set(model, m);

		// Provider
		const provider = s.provider || 'unknown';
		const p = providerMap.get(provider) || { sessions: 0, cost: 0 };
		p.sessions++;
		p.cost += s.estimatedCost;
		providerMap.set(provider, p);

		// Totals
		totalCost += s.estimatedCost;
		totalInputTokens += s.inputTokens;
		totalOutputTokens += s.outputTokens;
		totalToolCalls += s.toolCallCount;
		const dur = new Date(s.lastActiveAt).getTime() - new Date(s.startedAt).getTime();
		if (dur > 0) totalDuration += dur;
	}

	return {
		sessions,
		selectedTimeline,
		selectedSessionId,
		dailyCosts: [...dailyMap.entries()].map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date)),
		weeklyTrend: [...weeklyMap.entries()].map(([week, d]) => ({ week, ...d })).sort((a, b) => a.week.localeCompare(b.week)),
		modelUsage: [...modelMap.entries()].map(([model, d]) => ({ model, ...d })).sort((a, b) => b.cost - a.cost),
		providerUsage: [...providerMap.entries()].map(([provider, d]) => ({ provider, ...d })).sort((a, b) => b.sessions - a.sessions),
		totals: {
			sessions: sessions.length,
			totalCost,
			totalInputTokens,
			totalOutputTokens,
			totalToolCalls,
			avgSessionDuration: sessions.length > 0 ? totalDuration / sessions.length : 0,
			avgCostPerSession: sessions.length > 0 ? totalCost / sessions.length : 0
		}
	};
};
