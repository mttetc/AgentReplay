import { describe, it, expect } from 'vitest';
import {
	normalizeLine,
	isSignificant,
	significantLines,
	extractAgentEdits,
	computeFileNets,
	classifyFile,
	summarize,
	aggregateSurvival
} from '../code-survival';
import type { TimelineEvent } from '$lib/types/timeline';

function toolCall(
	index: number,
	toolName: string,
	input: Record<string, unknown>,
	isError = false
): TimelineEvent {
	return {
		id: `evt-${index}`,
		index,
		timestamp: new Date(2026, 0, 1, 10, index).toISOString(),
		data: {
			eventType: 'tool_call',
			toolName,
			toolUseId: `tu-${index}`,
			input,
			result: { content: isError ? 'boom' : 'ok', isError }
		}
	};
}

describe('line normalization', () => {
	it('collapses whitespace and trims', () => {
		expect(normalizeLine('   const  x =\t1;  ')).toBe('const x = 1;');
	});

	it('ignores structural noise', () => {
		expect(isSignificant('}')).toBe(false);
		expect(isSignificant('});')).toBe(false);
		expect(isSignificant('// ----')).toBe(false);
		expect(isSignificant('return x;')).toBe(true);
	});

	it('dedupes identical lines', () => {
		const set = significantLines('foo(bar);\nfoo(bar);\n  foo(bar);  ');
		expect(set.size).toBe(1);
	});
});

describe('extractAgentEdits', () => {
	it('reads Edit and Write payloads and skips errors', () => {
		const events = [
			toolCall(0, 'Edit', {
				file_path: '/repo/a.ts',
				old_string: 'const a = 1;\nconst b = 2;',
				new_string: 'const a = 10;\nconst b = 2;\nconst c = 3;'
			}),
			toolCall(1, 'Write', { file_path: '/repo/b.ts', content: 'export const b = 1;\n' }),
			toolCall(2, 'Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' }, true),
			toolCall(3, 'Read', { file_path: '/repo/a.ts' })
		];
		const edits = extractAgentEdits(events);
		expect(edits).toHaveLength(2);
		expect(edits[0].added.sort()).toEqual(['const a = 10;', 'const c = 3;']);
		expect(edits[0].removed).toEqual(['const a = 1;']);
		expect(edits[1].toolName).toBe('Write');
		expect(edits[1].added).toEqual(['export const b = 1;']);
	});
});

describe('computeFileNets', () => {
	it('counts lines the agent replaced itself as self-revised', () => {
		const events = [
			toolCall(0, 'Edit', { file_path: '/repo/a.ts', old_string: '', new_string: 'const first = 1;' }),
			toolCall(1, 'Edit', {
				file_path: '/repo/a.ts',
				old_string: 'const first = 1;',
				new_string: 'const second = 2;'
			})
		];
		const nets = computeFileNets(extractAgentEdits(events));
		const fn = nets.get('/repo/a.ts')!;
		expect([...fn.net.keys()]).toEqual(['const second = 2;']);
		expect(fn.selfRevised).toBe(1);
		expect(fn.editCount).toBe(2);
	});

	it('treats Write as a full replacement', () => {
		const events = [
			toolCall(0, 'Edit', { file_path: '/repo/a.ts', old_string: '', new_string: 'const gone = 1;' }),
			toolCall(1, 'Write', { file_path: '/repo/a.ts', content: 'const kept = 2;\nconst also = 3;' })
		];
		const fn = computeFileNets(extractAgentEdits(events)).get('/repo/a.ts')!;
		expect([...fn.net.keys()].sort()).toEqual(['const also = 3;', 'const kept = 2;']);
		expect(fn.selfRevised).toBe(1);
	});
});

describe('classifyFile', () => {
	const events = [
		toolCall(0, 'Write', {
			file_path: '/repo/src/x.ts',
			content: ['export function one() {}', 'export function two() {}', 'export function three() {}', 'export function four() {}'].join('\n')
		})
	];
	const fn = computeFileNets(extractAgentEdits(events)).get('/repo/src/x.ts')!;

	it('splits lines into committed / uncommitted / gone', () => {
		const result = classifyFile(fn, 'src/x.ts', {
			head: significantLines('export function one() {}\nexport function two() {}'),
			workingTree: significantLines(
				'export function one() {}\nexport function two() {}\nexport function three() {}\nexport function human() {}'
			)
		});
		expect(result.committed).toBe(2);
		expect(result.uncommitted).toBe(1);
		expect(result.gone).toBe(1);
		expect(result.survivalPct).toBe(75);
		expect(result.status).toBe('mostly-kept');
		expect(result.sampleGone).toEqual(['export function four() {}']);
	});

	it('flags a deleted file', () => {
		const result = classifyFile(fn, 'src/x.ts', { head: null, workingTree: null });
		expect(result.status).toBe('file-missing');
		expect(result.gone).toBe(4);
	});

	it('counts a line deleted from the working tree as gone even if HEAD still has it', () => {
		const result = classifyFile(fn, 'src/x.ts', {
			head: significantLines('export function one() {}\nexport function two() {}'),
			workingTree: significantLines('export function one() {}')
		});
		expect(result.committed).toBe(1);
		expect(result.gone).toBe(3);
	});

	it('flags a file the agent fully rewrote itself later', () => {
		const result = classifyFile(fn, 'src/x.ts', {
			head: significantLines('totally different'),
			workingTree: significantLines('totally different')
		});
		expect(result.status).toBe('discarded');
		expect(result.survivalPct).toBe(0);
	});
});

describe('summarize + aggregateSurvival', () => {
	it('computes session-level and cross-session rates', () => {
		const events = [
			toolCall(0, 'Write', { file_path: '/repo/a.ts', content: 'line number one;\nline number two;' }),
			toolCall(1, 'Write', { file_path: '/repo/b.ts', content: 'line number three;\nline number four;' })
		];
		const nets = computeFileNets(extractAgentEdits(events));
		const files = [
			classifyFile(nets.get('/repo/a.ts')!, 'a.ts', {
				head: significantLines('line number one;\nline number two;'),
				workingTree: significantLines('line number one;\nline number two;')
			}),
			classifyFile(nets.get('/repo/b.ts')!, 'b.ts', {
				head: significantLines(''),
				workingTree: significantLines('line number three;')
			})
		];
		const session = summarize('/repo', 'abc', files, { outsideRepo: 0, unmeasurable: 0 });
		expect(session.agentLines).toBe(4);
		expect(session.committed).toBe(2);
		expect(session.uncommitted).toBe(1);
		expect(session.gone).toBe(1);
		expect(session.survivalPct).toBe(75);
		expect(session.committedPct).toBe(50);
		expect(session.verdict).toBe('mostly-kept');
		// worst file first
		expect(session.files[0].relPath).toBe('b.ts');

		const agg = aggregateSurvival([
			{ sessionId: 's1', slug: 'one', project: 'p', startedAt: '2026-01-01', survival: session },
			{ sessionId: 's2', slug: 'two', project: 'p', startedAt: '2026-01-02', survival: null }
		]);
		expect(agg.sessionsMeasured).toBe(1);
		expect(agg.sessionsWithoutData).toBe(1);
		expect(agg.survivalPct).toBe(75);
		expect(agg.byProject[0]).toEqual({ project: 'p', sessions: 1, agentLines: 4, survivalPct: 75 });
	});
});
