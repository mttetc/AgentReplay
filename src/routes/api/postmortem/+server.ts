import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { loadTimeline, SessionLoadError, sessionIdSchema } from '$lib/server/load-session';
import { findRelatedCommits } from '$lib/server/git-integration';
import { analyzeCodeSurvival } from '$lib/server/code-survival';
import { generatePostMortem, getLlmConfig, type PostMortemReport } from '$lib/server/postmortem';
import { getPostmortem, setPostmortem, deletePostmortem } from '$lib/server/db';

const safeValue = z.string().max(2000).regex(/^[^<\x00]*$/);

const PostBody = z.object({
	sessionId: sessionIdSchema,
	provider: z.string().max(40).optional(),
	params: z.record(z.string().max(100), safeValue).default({})
});

/** Sessions currently being analyzed — one generation at a time per session. */
const inFlight = new Set<string>();

/** GET /api/postmortem?sessionId=xxx — stored report (if any) plus LLM configuration */
export const GET = async ({ url }: { url: URL }) => {
	const parsed = sessionIdSchema.safeParse(url.searchParams.get('sessionId'));
	if (!parsed.success) return json({ error: 'sessionId required' }, { status: 400 });
	const stored = getPostmortem(parsed.data);
	return json({
		report: stored ? (JSON.parse(stored.reportJson) as PostMortemReport) : null,
		config: getLlmConfig()
	});
};

/** POST /api/postmortem — (re)generate the report for one session. Sends the evidence pack to the configured LLM. */
export const POST = async ({ request }: { request: Request }) => {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const parsed = PostBody.safeParse(rawBody);
	if (!parsed.success) {
		return json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 });
	}
	const { sessionId, provider, params } = parsed.data;

	const config = getLlmConfig();
	if (!config.configured) return json({ error: config.reason }, { status: 409 });
	if (inFlight.has(sessionId)) return json({ error: 'A post-mortem is already being generated for this session.' }, { status: 429 });

	inFlight.add(sessionId);
	try {
		const timeline = await loadTimeline(sessionId, provider || null, params);
		const gitPath = timeline.summary.cwd || params.project || timeline.summary.project;
		const [commits, survival] = await Promise.all([
			findRelatedCommits(gitPath, timeline.summary.startedAt, timeline.summary.lastActiveAt, timeline.events).catch(() => []),
			analyzeCodeSurvival(timeline).catch(() => null)
		]);
		const report = await generatePostMortem(timeline, survival, commits, config);
		setPostmortem(sessionId, config.provider, config.model, JSON.stringify(report));
		return json({ report, config });
	} catch (e) {
		if (e instanceof SessionLoadError) return json({ error: e.message }, { status: e.status });
		return json({ error: e instanceof Error ? e.message : 'Post-mortem generation failed' }, { status: 502 });
	} finally {
		inFlight.delete(sessionId);
	}
};

/** DELETE /api/postmortem?sessionId=xxx — forget the stored report */
export const DELETE = async ({ url }: { url: URL }) => {
	const parsed = sessionIdSchema.safeParse(url.searchParams.get('sessionId'));
	if (!parsed.success) return json({ error: 'sessionId required' }, { status: 400 });
	deletePostmortem(parsed.data);
	return json({ ok: true });
};
