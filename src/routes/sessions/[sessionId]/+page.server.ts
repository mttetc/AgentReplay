import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { findRelatedCommits } from '$lib/server/git-integration';
import { analyzeSessionOverhead } from '$lib/server/overhead-analysis';
import { analyzeCodeSurvival } from '$lib/server/code-survival';
import { loadTimeline, SessionLoadError } from '$lib/server/load-session';
import { getLlmConfig } from '$lib/server/postmortem';
import { getPostmortem } from '$lib/server/db';

export const load: PageServerLoad = async ({ params, url }) => {
	const query: Record<string, string> = {};
	for (const [key, value] of url.searchParams.entries()) query[key] = value;

	let timeline;
	try {
		timeline = await loadTimeline(params.sessionId, url.searchParams.get('provider'), query);
	} catch (e) {
		if (e instanceof SessionLoadError) throw error(e.status, e.message);
		throw error(500, e instanceof Error ? e.message : 'Unknown error');
	}

	// Prefer cwd (actual path) over project (decoded, may have broken hyphens)
	const gitPath = timeline.summary.cwd || query.project || timeline.summary.project;
	const [commits, overhead, survival] = await Promise.all([
		findRelatedCommits(
			gitPath,
			timeline.summary.startedAt,
			timeline.summary.lastActiveAt,
			timeline.events
		).catch(() => []),
		analyzeSessionOverhead(timeline).catch(() => null),
		analyzeCodeSurvival(timeline).catch(() => null)
	]);

	let postmortem = null;
	try {
		postmortem = getPostmortem(timeline.summary.sessionId);
	} catch {
		postmortem = null;
	}

	return {
		timeline,
		commits,
		overhead,
		survival,
		postmortem,
		llmConfig: getLlmConfig(),
		// Echoed back so the client can ask the API to (re)load the same session.
		sessionParams: query
	};
};
