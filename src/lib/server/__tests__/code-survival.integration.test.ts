import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { analyzeCodeSurvival } from '../code-survival';
import type { SessionTimeline, TimelineEvent } from '$lib/types/timeline';

const exec = promisify(execFile);

/**
 * End-to-end check against a real git repository: the agent writes a file and
 * edits it, part of that is committed, a human then reworks the file.
 */
describe('analyzeCodeSurvival against a real git repo', () => {
	let repo = '';

	const agentWrite = [
		'export function alpha() { return 1; }',
		'export function beta() { return 2; }',
		'export function gamma() { return 3; }',
		'export function delta() { return 4; }',
		'export function epsilon() { return 5; }'
	];

	async function git(...args: string[]) {
		await exec('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd: repo });
	}

	beforeAll(async () => {
		repo = await mkdtemp(join(tmpdir(), 'agent-replay-survival-'));
		await git('init', '-q');
		await mkdir(join(repo, 'src'), { recursive: true });

		// Committed state: the agent's file after its own Edit (beta -> beta2),
		// minus epsilon which the human dropped before committing.
		await writeFile(
			join(repo, 'src', 'a.ts'),
			[
				'export function alpha() { return 1; }',
				'export function beta2() { return 22; }',
				'export function gamma() { return 3; }',
				'export function delta() { return 4; }'
			].join('\n') + '\n'
		);
		await git('add', '.');
		await git('commit', '-q', '-m', 'agent work');

		// Working tree: human rewrote delta (uncommitted), added their own line.
		await writeFile(
			join(repo, 'src', 'a.ts'),
			[
				'export function alpha() { return 1; }',
				'export function beta2() { return 22; }',
				'export function gamma() { return 3; }',
				'export function deltaByHuman() { return 40; }',
				'export function humanOnly() { return 0; }'
			].join('\n') + '\n'
		);
	});

	afterAll(async () => {
		if (repo) await rm(repo, { recursive: true, force: true });
	});

	it('classifies agent lines as committed / uncommitted / gone / self-revised', async () => {
		const events: TimelineEvent[] = [
			{
				id: 'evt-0',
				index: 0,
				timestamp: '2026-01-01T10:00:00.000Z',
				data: { eventType: 'user_message', text: 'write a.ts' }
			},
			{
				id: 'evt-1',
				index: 1,
				timestamp: '2026-01-01T10:01:00.000Z',
				data: {
					eventType: 'tool_call',
					toolName: 'Write',
					toolUseId: 't1',
					input: { file_path: join(repo, 'src', 'a.ts'), content: agentWrite.join('\n') + '\n' },
					result: { content: 'ok', isError: false }
				}
			},
			{
				id: 'evt-2',
				index: 2,
				timestamp: '2026-01-01T10:02:00.000Z',
				data: {
					eventType: 'tool_call',
					toolName: 'Edit',
					toolUseId: 't2',
					input: {
						file_path: join(repo, 'src', 'a.ts'),
						old_string: 'export function beta() { return 2; }',
						new_string: 'export function beta2() { return 22; }'
					},
					result: { content: 'ok', isError: false }
				}
			},
			{
				id: 'evt-3',
				index: 3,
				timestamp: '2026-01-01T10:03:00.000Z',
				data: {
					eventType: 'tool_call',
					toolName: 'Write',
					toolUseId: 't3',
					input: { file_path: join(tmpdir(), 'outside-the-repo.txt'), content: 'this line is outside the repository\n' },
					result: { content: 'ok', isError: false }
				}
			}
		];

		const timeline: SessionTimeline = {
			summary: {
				sessionId: 'integration',
				project: repo,
				slug: 'integration',
				startedAt: events[0].timestamp,
				lastActiveAt: events[3].timestamp,
				model: 'claude-opus-5',
				version: '2.0',
				eventCount: events.length,
				toolCallCount: 3,
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				estimatedCost: 0,
				errorCount: 0,
				filePath: '/dev/null',
				provider: 'claude-code',
				cwd: repo
			},
			events
		};

		const result = await analyzeCodeSurvival(timeline, undefined, false);
		expect(result).not.toBeNull();
		const r = result!;

		expect(r.headHash).toMatch(/^[0-9a-f]{40}$/);
		expect(r.filesSkipped.outsideRepo).toBe(1);

		const a = r.files.find((f) => f.relPath === 'src/a.ts')!;
		expect(a).toBeDefined();
		// Net agent lines: alpha, gamma, delta, epsilon, beta2 (beta was self-revised)
		expect(a.agentLines).toBe(5);
		expect(a.selfRevised).toBe(1);
		expect(a.committed).toBe(3); // alpha, beta2, gamma
		expect(a.uncommitted).toBe(0);
		expect(a.gone).toBe(2); // delta (rewritten by human), epsilon (dropped before commit)
		expect(a.survivalPct).toBe(60);
		expect(a.status).toBe('reworked');
		expect(a.sampleGone).toContain('export function delta() { return 4; }');

		expect(r.agentLines).toBe(5);
		expect(r.survivalPct).toBe(60);
		expect(r.committedPct).toBe(60);
		expect(r.verdict).toBe('reworked');
	});
});
