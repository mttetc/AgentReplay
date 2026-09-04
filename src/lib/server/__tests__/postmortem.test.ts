import { describe, it, expect, vi } from 'vitest';

// $env/dynamic/private is a SvelteKit virtual module; stub it for unit tests.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

import {
	buildEvidence,
	renderEvidence,
	validateCitations,
	generatePostMortem,
	PostMortemSchema,
	type PostMortem
} from '../postmortem';
import type { SessionTimeline, TimelineEvent } from '$lib/types/timeline';

function ev(index: number, minutesFromStart: number, data: TimelineEvent['data']): TimelineEvent {
	return {
		id: `evt-${index}`,
		index,
		timestamp: new Date(Date.UTC(2026, 0, 1, 10, minutesFromStart)).toISOString(),
		data
	};
}

const timeline: SessionTimeline = {
	summary: {
		sessionId: 'abc',
		project: '/repo',
		slug: 'fix-login',
		startedAt: new Date(Date.UTC(2026, 0, 1, 10, 0)).toISOString(),
		lastActiveAt: new Date(Date.UTC(2026, 0, 1, 10, 30)).toISOString(),
		model: 'claude-opus-4-6',
		version: '2.0',
		eventCount: 6,
		toolCallCount: 3,
		inputTokens: 1000,
		outputTokens: 500,
		cacheReadTokens: 0,
		estimatedCost: 0.42,
		errorCount: 1,
		filePath: '/tmp/abc.jsonl',
		provider: 'claude-code',
		cwd: '/repo'
	},
	events: [
		ev(0, 0, { eventType: 'user_message', text: 'Fix the login bug in auth.ts' }),
		ev(1, 1, { eventType: 'tool_call', toolName: 'Read', toolUseId: 't1', input: { file_path: '/repo/src/auth.ts' }, result: { content: '...', isError: false } }),
		ev(2, 2, {
			eventType: 'tool_call',
			toolName: 'Edit',
			toolUseId: 't2',
			input: { file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' },
			result: { content: 'String not found', isError: true }
		}),
		ev(3, 3, {
			eventType: 'tool_call',
			toolName: 'Edit',
			toolUseId: 't3',
			input: { file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' },
			result: { content: 'String not found', isError: true }
		}),
		ev(4, 12, { eventType: 'user_message', text: 'No, the bug is in the token refresh, not the form' }),
		ev(5, 13, { eventType: 'assistant_text', text: 'Understood.' })
	]
};

describe('buildEvidence', () => {
	const evidence = buildEvidence(timeline, null, []);

	it('collects user messages, errors and file sequences with event ids', () => {
		expect(evidence.userMessages.map((m) => m.eventId)).toEqual(['evt-0', 'evt-4']);
		expect(evidence.toolErrors).toHaveLength(2);
		expect(evidence.fileActivity[0].sequence).toBe('RE!E!');
		expect(evidence.repeatedErrors[0]).toMatchObject({ tool: 'Edit', count: 2, eventIds: ['evt-2', 'evt-3'] });
		expect(evidence.idleGaps[0]).toMatchObject({ fromEventId: 'evt-3', toEventId: 'evt-4', minutes: 9 });
		expect(evidence.validEventIds).toHaveLength(6);
	});

	it('renders as compact text carrying the event ids', () => {
		const text = renderEvidence(evidence);
		expect(text).toContain('[evt-4]');
		expect(text).toContain('RE!E!');
		expect(text).toContain('not measurable');
	});
});

describe('validateCitations', () => {
	it('strips ids that do not exist and counts unsupported claims', () => {
		const result: PostMortem = {
			headline: 'h',
			narrative: [{ phase: 'p', eventIds: ['evt-0', 'evt-99'], summary: 's' }],
			friction: [{ kind: 'error-retry', eventIds: ['evt-77'], evidence: 'e', impact: 'i' }],
			humanInterventions: [{ eventId: 'evt-4', whatChanged: 'w' }, { eventId: 'evt-50', whatChanged: 'x' }],
			outcome: { codeKept: 'c', assessment: 'a' },
			recommendations: [],
			confidence: 'medium'
		};
		const valid = new Set(['evt-0', 'evt-1', 'evt-2', 'evt-3', 'evt-4', 'evt-5']);
		const out = validateCitations(result, valid);
		expect(out.result.narrative[0].eventIds).toEqual(['evt-0']);
		expect(out.result.friction[0].eventIds).toEqual([]);
		expect(out.result.humanInterventions).toHaveLength(1);
		expect(out.droppedCitations).toBe(3);
		expect(out.unsupportedClaims).toBe(1);
	});
});

describe('generatePostMortem', () => {
	it('refuses to run without a configured provider', async () => {
		await expect(
			generatePostMortem(timeline, null, [], { provider: 'none', model: '', configured: false, reason: 'nope' })
		).rejects.toThrow('nope');
	});

	it('wraps the model output with metadata and validated citations', async () => {
		const fakeOutput: PostMortem = {
			headline: 'Two failed edits then a redirect.',
			narrative: [{ phase: 'Attempt', eventIds: ['evt-2', 'evt-3'], summary: 'Edits failed.' }],
			friction: [{ kind: 'error-retry', eventIds: ['evt-2', 'evt-3', 'evt-404'], evidence: 'Edit x2', impact: '2 min' }],
			humanInterventions: [{ eventId: 'evt-4', whatChanged: 'Pointed at token refresh.' }],
			outcome: { codeKept: 'Not measurable.', assessment: 'Unclear.' },
			recommendations: [{ target: 'prompt', text: 'Name the function.' }],
			confidence: 'medium'
		};
		const report = await generatePostMortem(
			timeline,
			null,
			[],
			{ provider: 'anthropic', model: 'claude-opus-5', configured: true },
			async (text) => {
				expect(text).toContain('# User messages');
				return { output: fakeOutput, inputTokens: 1200, outputTokens: 300 };
			}
		);
		expect(PostMortemSchema.safeParse(report).success).toBe(true);
		expect(report.friction[0].eventIds).toEqual(['evt-2', 'evt-3']);
		expect(report.meta.droppedCitations).toBe(1);
		expect(report.meta.provider).toBe('anthropic');
		expect(report.meta.costUsd).toBeGreaterThan(0);
	});
});
