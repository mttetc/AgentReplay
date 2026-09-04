import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import type { SessionTimeline, TimelineEvent, ToolCallEvent } from '$lib/types/timeline';
import type { GitCommit } from './git-integration';
import type { SessionSurvival } from './code-survival';
import { estimateCost } from '$lib/utils/cost';
import { formatDurationBetween, shortPath } from '$lib/utils/format';

/**
 * LLM post-mortem — a qualitative reading of one session, grounded in the
 * quantitative evidence this app already computes.
 *
 * Design rules:
 *   1. The model never sees the raw log. It sees an evidence pack: user
 *      messages, tool errors, per-file operation sequences, detected loops,
 *      idle gaps, code survival and related commits — each item tagged with
 *      the event id it comes from.
 *   2. Every claim in the output must cite event ids. Ids that do not exist
 *      in the session are stripped server-side and counted, so the UI can say
 *      "N claims could not be tied to an event" instead of trusting prose.
 *   3. Nothing leaves the machine unless the user clicks "Generate". The
 *      provider is chosen by environment variables; with none set, the panel
 *      explains how to configure one.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type LlmProvider = 'anthropic' | 'ollama' | 'none';

export interface LlmConfig {
	provider: LlmProvider;
	model: string;
	baseUrl?: string;
	configured: boolean;
	/** Human-readable explanation when not configured. */
	reason?: string;
}

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';
const DEFAULT_OLLAMA_MODEL = 'qwen3';

export function getLlmConfig(): LlmConfig {
	const explicit = (env.AGENT_REPLAY_LLM_PROVIDER || '').toLowerCase();
	const hasAnthropicCreds = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
	const provider: LlmProvider =
		explicit === 'ollama' ? 'ollama' : explicit === 'anthropic' || hasAnthropicCreds ? 'anthropic' : 'none';

	if (provider === 'ollama') {
		return {
			provider,
			model: env.AGENT_REPLAY_LLM_MODEL || DEFAULT_OLLAMA_MODEL,
			baseUrl: env.OLLAMA_BASE_URL || 'http://localhost:11434',
			configured: true
		};
	}
	if (provider === 'anthropic') {
		return {
			provider,
			model: env.AGENT_REPLAY_LLM_MODEL || DEFAULT_ANTHROPIC_MODEL,
			configured: hasAnthropicCreds,
			reason: hasAnthropicCreds ? undefined : 'AGENT_REPLAY_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.'
		};
	}
	return {
		provider: 'none',
		model: '',
		configured: false,
		reason:
			'No LLM configured. Set ANTHROPIC_API_KEY to use the Claude API, or AGENT_REPLAY_LLM_PROVIDER=ollama (+ AGENT_REPLAY_LLM_MODEL) to use a local model.'
	};
}

// ---------------------------------------------------------------------------
// Evidence pack
// ---------------------------------------------------------------------------

export interface Evidence {
	session: {
		sessionId: string;
		provider: string;
		model: string;
		project: string;
		branch?: string;
		startedAt: string;
		duration: string;
		costUsd: number;
		events: number;
		toolCalls: number;
		toolErrors: number;
		userTurns: number;
		compactions: number;
		thinkingShare: number;
	};
	userMessages: Array<{ eventId: string; at: string; text: string }>;
	toolErrors: Array<{ eventId: string; tool: string; file?: string; error: string }>;
	fileActivity: Array<{ file: string; sequence: string; ops: number; eventIds: string[] }>;
	loops: Array<{ file: string; edits: number; eventIds: string[] }>;
	repeatedErrors: Array<{ tool: string; file?: string; count: number; eventIds: string[] }>;
	idleGaps: Array<{ fromEventId: string; toEventId: string; minutes: number }>;
	survival: null | {
		survivalPct: number;
		committedPct: number;
		agentLines: number;
		selfRevised: number;
		files: Array<{ file: string; status: string; survivalPct: number; agentLines: number; sampleGone: string[] }>;
	};
	commits: Array<{ hash: string; subject: string; files: number }>;
	/** Ids the model is allowed to cite. */
	validEventIds: string[];
}

const MAX_USER_MSG_CHARS = 500;
const MAX_ERROR_CHARS = 240;
const MAX_USER_MESSAGES = 60;
const MAX_TOOL_ERRORS = 40;
const MAX_FILES = 40;

function clip(text: string, max: number): string {
	const t = text.replace(/\s+/g, ' ').trim();
	return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function buildEvidence(
	timeline: SessionTimeline,
	survival: SessionSurvival | null,
	commits: GitCommit[]
): Evidence {
	const { summary, events } = timeline;

	const userMessages: Evidence['userMessages'] = [];
	const toolErrors: Evidence['toolErrors'] = [];
	const perFile = new Map<string, { sequence: string[]; eventIds: string[]; edits: number }>();
	const errorGroups = new Map<string, { tool: string; file?: string; eventIds: string[] }>();
	const idleGaps: Evidence['idleGaps'] = [];
	let compactions = 0;
	let thinkingChars = 0;
	let textChars = 0;
	let toolCalls = 0;

	let prev: TimelineEvent | null = null;
	for (const event of events) {
		if (prev) {
			const gapMs = new Date(event.timestamp).getTime() - new Date(prev.timestamp).getTime();
			if (gapMs >= 5 * 60_000) {
				idleGaps.push({ fromEventId: prev.id, toEventId: event.id, minutes: Math.round(gapMs / 60_000) });
			}
		}
		prev = event;

		switch (event.data.eventType) {
			case 'user_message':
				userMessages.push({ eventId: event.id, at: event.timestamp, text: clip(event.data.text, MAX_USER_MSG_CHARS) });
				break;
			case 'thinking':
				thinkingChars += event.data.thinking.length;
				break;
			case 'assistant_text':
				textChars += event.data.text.length;
				break;
			case 'compact_boundary':
				compactions++;
				break;
			case 'tool_call': {
				toolCalls++;
				const tc = event.data as ToolCallEvent;
				const input = tc.input as Record<string, unknown>;
				const file = typeof input.file_path === 'string' ? shortPath(input.file_path) : undefined;

				if (file && ['Read', 'Edit', 'Write'].includes(tc.toolName)) {
					const pf = perFile.get(file) || { sequence: [], eventIds: [], edits: 0 };
					pf.sequence.push(tc.toolName[0]);
					if (tc.toolName !== 'Read') pf.edits++;
					if (tc.result?.isError) pf.sequence.push('!');
					pf.eventIds.push(event.id);
					perFile.set(file, pf);
				}

				if (tc.result?.isError) {
					toolErrors.push({
						eventId: event.id,
						tool: tc.toolName,
						file,
						error: clip(tc.result.content, MAX_ERROR_CHARS)
					});
					const key = `${tc.toolName}:${file || ''}`;
					const g = errorGroups.get(key) || { tool: tc.toolName, file, eventIds: [] };
					g.eventIds.push(event.id);
					errorGroups.set(key, g);
				}
				break;
			}
		}
	}

	const fileActivity = [...perFile.entries()]
		.map(([file, pf]) => ({ file, sequence: pf.sequence.join(''), ops: pf.eventIds.length, eventIds: pf.eventIds }))
		.sort((a, b) => b.ops - a.ops)
		.slice(0, MAX_FILES);

	const loops = [...perFile.entries()]
		.filter(([, pf]) => pf.edits >= 3)
		.map(([file, pf]) => ({ file, edits: pf.edits, eventIds: pf.eventIds }));

	const repeatedErrors = [...errorGroups.values()]
		.filter((g) => g.eventIds.length >= 2)
		.map((g) => ({ tool: g.tool, file: g.file, count: g.eventIds.length, eventIds: g.eventIds }));

	return {
		session: {
			sessionId: summary.sessionId,
			provider: summary.provider,
			model: summary.model,
			project: summary.cwd || summary.project,
			branch: summary.gitBranch,
			startedAt: summary.startedAt,
			duration: formatDurationBetween(summary.startedAt, summary.lastActiveAt),
			costUsd: Math.round(summary.estimatedCost * 100) / 100,
			events: events.length,
			toolCalls,
			toolErrors: toolErrors.length,
			userTurns: userMessages.length,
			compactions,
			thinkingShare: thinkingChars + textChars > 0 ? Math.round((thinkingChars / (thinkingChars + textChars)) * 100) : 0
		},
		userMessages: userMessages.slice(0, MAX_USER_MESSAGES),
		toolErrors: toolErrors.slice(0, MAX_TOOL_ERRORS),
		fileActivity,
		loops,
		repeatedErrors,
		idleGaps: idleGaps.sort((a, b) => b.minutes - a.minutes).slice(0, 10),
		survival: survival
			? {
					survivalPct: survival.survivalPct,
					committedPct: survival.committedPct,
					agentLines: survival.agentLines,
					selfRevised: survival.selfRevised,
					files: survival.files
						.filter((f) => f.status !== 'unmeasurable' && f.status !== 'outside-repo')
						.slice(0, 20)
						.map((f) => ({
							file: f.relPath,
							status: f.status,
							survivalPct: f.survivalPct,
							agentLines: f.agentLines,
							sampleGone: f.sampleGone
						}))
				}
			: null,
		commits: commits.slice(0, 10).map((c) => ({ hash: c.shortHash, subject: c.subject, files: c.filesChanged.length })),
		validEventIds: events.map((e) => e.id)
	};
}

/** Render the evidence pack as compact text for the prompt. */
export function renderEvidence(ev: Evidence): string {
	const lines: string[] = [];
	const s = ev.session;
	lines.push('# Session');
	lines.push(
		`id=${s.sessionId} provider=${s.provider} model=${s.model} project=${s.project}${s.branch ? ` branch=${s.branch}` : ''}`
	);
	lines.push(
		`started=${s.startedAt} duration=${s.duration} cost=$${s.costUsd} events=${s.events} tool_calls=${s.toolCalls} tool_errors=${s.toolErrors} user_turns=${s.userTurns} compactions=${s.compactions} thinking_share=${s.thinkingShare}%`
	);

	lines.push('', '# User messages (chronological)');
	for (const m of ev.userMessages) lines.push(`[${m.eventId}] ${m.at.slice(11, 19)} ${m.text}`);

	lines.push('', '# Tool errors');
	if (ev.toolErrors.length === 0) lines.push('(none)');
	for (const e of ev.toolErrors) lines.push(`[${e.eventId}] ${e.tool}${e.file ? ` ${e.file}` : ''}: ${e.error}`);

	lines.push('', '# File activity (R=Read E=Edit W=Write !=error), most active first');
	if (ev.fileActivity.length === 0) lines.push('(none)');
	for (const f of ev.fileActivity) lines.push(`${f.file}: ${f.sequence} (${f.ops} ops; events ${f.eventIds.join(',')})`);

	lines.push('', '# Detected edit loops (3+ edits on one file)');
	if (ev.loops.length === 0) lines.push('(none)');
	for (const l of ev.loops) lines.push(`${l.file}: ${l.edits} edits (events ${l.eventIds.join(',')})`);

	lines.push('', '# Repeated errors (same tool, same file)');
	if (ev.repeatedErrors.length === 0) lines.push('(none)');
	for (const r of ev.repeatedErrors) lines.push(`${r.tool}${r.file ? ` ${r.file}` : ''} x${r.count} (events ${r.eventIds.join(',')})`);

	lines.push('', '# Idle gaps of 5+ minutes between consecutive events');
	if (ev.idleGaps.length === 0) lines.push('(none)');
	for (const g of ev.idleGaps) lines.push(`${g.minutes} min between ${g.fromEventId} and ${g.toEventId}`);

	lines.push('', '# Code survival (agent lines still in the repo now, measured against git)');
	if (!ev.survival) lines.push('(not measurable: no textual edits or no git repository)');
	else {
		const sv = ev.survival;
		lines.push(
			`overall: ${sv.survivalPct}% present, ${sv.committedPct}% committed, ${sv.agentLines} agent lines, ${sv.selfRevised} self-revised`
		);
		for (const f of sv.files) {
			lines.push(`${f.file}: ${f.status} ${f.survivalPct}% of ${f.agentLines} lines${f.sampleGone.length ? ` — gone e.g. "${f.sampleGone[0]}"` : ''}`);
		}
	}

	lines.push('', '# Related commits (time + file overlap)');
	if (ev.commits.length === 0) lines.push('(none)');
	for (const c of ev.commits) lines.push(`${c.hash} ${c.subject} (${c.files} files)`);

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const FrictionKind = z.enum([
	'edit-loop',
	'error-retry',
	'misunderstanding',
	'human-correction',
	'over-exploration',
	'scope-creep',
	'environment',
	'other'
]);

export const PostMortemSchema = z.object({
	headline: z.string().describe('One sentence: what this session was and how it went.'),
	narrative: z
		.array(
			z.object({
				phase: z.string().describe('Short label for this phase of the session.'),
				eventIds: z.array(z.string()).describe('Event ids this phase spans or is evidenced by.'),
				summary: z.string()
			})
		)
		.describe('Chronological account of what happened, 2 to 6 phases.'),
	friction: z
		.array(
			z.object({
				kind: FrictionKind,
				eventIds: z.array(z.string()),
				evidence: z.string().describe('What in the evidence pack shows this. Quote it.'),
				impact: z.string().describe('Cost in time, money or rework, using numbers from the evidence.')
			})
		)
		.describe('Where time or money was lost. Empty if the session was clean.'),
	humanInterventions: z
		.array(
			z.object({
				eventId: z.string().describe('The user message that redirected the agent.'),
				whatChanged: z.string()
			})
		)
		.describe('User messages after the first one that corrected, redirected or rejected the agent.'),
	outcome: z.object({
		codeKept: z.string().describe('What the survival data says about the agent output, in plain words.'),
		assessment: z.string().describe('Did the session achieve what the first message asked for? Evidence-based.')
	}),
	recommendations: z
		.array(
			z.object({
				target: z.enum(['prompt', 'claude-md', 'codebase', 'workflow']),
				text: z.string()
			})
		)
		.describe('At most 4, each actionable and tied to a friction item.'),
	confidence: z.enum(['low', 'medium', 'high']).describe('How well the evidence supports this analysis.')
});

export type PostMortem = z.infer<typeof PostMortemSchema>;

export interface PostMortemReport extends PostMortem {
	meta: {
		provider: LlmProvider;
		model: string;
		generatedAt: string;
		inputTokens: number;
		outputTokens: number;
		costUsd: number | null;
		/** Event ids the model cited that do not exist in this session (stripped). */
		droppedCitations: number;
		/** Narrative or friction items left with no valid citation. */
		unsupportedClaims: number;
	};
}

/** Strip citations to non-existent events and count what had to be removed. */
export function validateCitations(
	result: PostMortem,
	validIds: Set<string>
): { result: PostMortem; droppedCitations: number; unsupportedClaims: number } {
	let dropped = 0;
	let unsupported = 0;
	const keep = (ids: string[]) => {
		const ok = ids.filter((id) => validIds.has(id));
		dropped += ids.length - ok.length;
		if (ok.length === 0 && ids.length > 0) unsupported++;
		return ok;
	};
	const cleaned: PostMortem = {
		...result,
		narrative: result.narrative.map((n) => ({ ...n, eventIds: keep(n.eventIds) })),
		friction: result.friction.map((f) => ({ ...f, eventIds: keep(f.eventIds) })),
		humanInterventions: result.humanInterventions.filter((h) => {
			if (validIds.has(h.eventId)) return true;
			dropped++;
			return false;
		})
	};
	return { result: cleaned, droppedCitations: dropped, unsupportedClaims: unsupported };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are reviewing one AI coding-agent session for the engineer who ran it.
You receive an evidence pack: quantitative facts extracted from the session log and from git, each tagged with an event id like evt-12.

Write a post-mortem that is useful to that engineer. Rules:
- Ground every statement in the evidence pack and cite the event ids it rests on. Never invent event ids; only use ids that appear in the pack.
- Prefer the numbers already in the pack (durations, counts, percentages, dollars) over adjectives.
- "Friction" means time, money or rework that a better prompt, better repository guidance or a different workflow would have avoided. Do not list normal work as friction.
- Human interventions are user messages after the first one that correct, redirect or reject the agent. A follow-up request for new work is not an intervention.
- Code survival is the ground truth for outcome: lines the agent wrote that are still in the repository. Interpret it, do not restate it.
- If the evidence is thin, say so and lower your confidence rather than speculating.
- Be direct and specific. No praise, no filler.`;

export interface LlmCaller {
	(evidenceText: string, config: LlmConfig): Promise<{ output: unknown; inputTokens: number; outputTokens: number }>;
}

async function callAnthropic(evidenceText: string, config: LlmConfig) {
	const client = new Anthropic();
	const response = await client.messages.parse({
		model: config.model,
		max_tokens: 16000,
		system: SYSTEM_PROMPT,
		messages: [{ role: 'user', content: evidenceText }],
		output_config: { format: zodOutputFormat(PostMortemSchema), effort: 'medium' }
	});
	if (response.stop_reason === 'refusal') {
		throw new Error(`The model declined to analyze this session${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`);
	}
	if (!response.parsed_output) {
		throw new Error(`The model returned no structured output (stop_reason=${response.stop_reason}).`);
	}
	return {
		output: response.parsed_output,
		inputTokens: response.usage.input_tokens + (response.usage.cache_read_input_tokens || 0) + (response.usage.cache_creation_input_tokens || 0),
		outputTokens: response.usage.output_tokens
	};
}

async function callOllama(evidenceText: string, config: LlmConfig) {
	const res = await fetch(`${config.baseUrl}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: config.model,
			stream: false,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{ role: 'user', content: evidenceText }
			],
			format: z.toJSONSchema(PostMortemSchema),
			options: { temperature: 0.2 }
		}),
		signal: AbortSignal.timeout(10 * 60_000)
	});
	if (!res.ok) {
		throw new Error(`Ollama returned HTTP ${res.status} (${await res.text().catch(() => '')})`);
	}
	const body = (await res.json()) as {
		message?: { content?: string };
		prompt_eval_count?: number;
		eval_count?: number;
	};
	let parsed: unknown;
	try {
		parsed = JSON.parse(body.message?.content || '');
	} catch {
		throw new Error('Ollama did not return valid JSON. Try a larger model or one with structured-output support.');
	}
	return {
		output: PostMortemSchema.parse(parsed),
		inputTokens: body.prompt_eval_count || 0,
		outputTokens: body.eval_count || 0
	};
}

const callers: Record<Exclude<LlmProvider, 'none'>, LlmCaller> = {
	anthropic: callAnthropic,
	ollama: callOllama
};

export async function generatePostMortem(
	timeline: SessionTimeline,
	survival: SessionSurvival | null,
	commits: GitCommit[],
	config: LlmConfig = getLlmConfig(),
	caller?: LlmCaller
): Promise<PostMortemReport> {
	if (!config.configured || config.provider === 'none') {
		throw new Error(config.reason || 'No LLM configured.');
	}
	const evidence = buildEvidence(timeline, survival, commits);
	const text = renderEvidence(evidence);
	const call = caller || callers[config.provider];
	const { output, inputTokens, outputTokens } = await call(text, config);

	const parsed = PostMortemSchema.parse(output);
	const { result, droppedCitations, unsupportedClaims } = validateCitations(parsed, new Set(evidence.validEventIds));

	return {
		...result,
		meta: {
			provider: config.provider,
			model: config.model,
			generatedAt: new Date().toISOString(),
			inputTokens,
			outputTokens,
			costUsd: config.provider === 'anthropic' ? estimateCost(config.model, inputTokens, outputTokens) : null,
			droppedCitations,
			unsupportedClaims
		}
	};
}
