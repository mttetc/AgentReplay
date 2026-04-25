import { describe, it, expect } from 'vitest';
import { toMarkdown, toJSON } from '$lib/utils/export';
import type { SessionTimeline, SessionSummary } from '$lib/types/timeline';

const summary: SessionSummary = {
	sessionId: 'test-123',
	project: 'my-project',
	slug: 'my-slug',
	startedAt: '2025-01-15T10:00:00Z',
	lastActiveAt: '2025-01-15T10:30:00Z',
	model: 'claude-sonnet-4-5-20250929',
	version: '1.0',
	eventCount: 3,
	toolCallCount: 1,
	inputTokens: 1000,
	outputTokens: 500,
	cacheReadTokens: 0,
	estimatedCost: 0.0105,
	errorCount: 0,
	filePath: '/tmp/test.jsonl',
	provider: 'claude-code'
};

const mockTimeline: SessionTimeline = {
	summary,
	events: [
		{
			id: 'evt-0',
			index: 0,
			timestamp: '2025-01-15T10:00:00Z',
			data: { eventType: 'user_message', text: 'Hello world' }
		},
		{
			id: 'evt-1',
			index: 1,
			timestamp: '2025-01-15T10:01:00Z',
			data: { eventType: 'assistant_text', text: 'Hi there!' },
			tokens: { input: 500, output: 250, cacheRead: 0, cacheCreation: 0 }
		},
		{
			id: 'evt-2',
			index: 2,
			timestamp: '2025-01-15T10:02:00Z',
			data: {
				eventType: 'tool_call',
				toolName: 'Bash',
				toolUseId: 'tu_1',
				input: { command: 'ls' },
				result: { content: 'file.ts', isError: false }
			},
			tokens: { input: 500, output: 250, cacheRead: 0, cacheCreation: 0 }
		}
	]
};

describe('toMarkdown', () => {
	const md = toMarkdown(mockTimeline);

	it('contains session slug in heading', () => {
		expect(md).toContain('# Session: my-slug');
	});

	it('contains project name', () => {
		expect(md).toContain('my-project');
	});

	it('contains a User section with user message text', () => {
		expect(md).toContain('### User');
		expect(md).toContain('Hello world');
	});

	it('contains a Claude section with assistant text', () => {
		expect(md).toContain('### Claude');
		expect(md).toContain('Hi there!');
	});

	it('contains a Tool: Bash section', () => {
		expect(md).toContain('### Tool: Bash');
	});

	it('contains the bash command', () => {
		expect(md).toContain('ls');
	});

	it('contains the tool result', () => {
		expect(md).toContain('file.ts');
	});
});

describe('toJSON', () => {
	const output = toJSON(mockTimeline);

	it('returns valid JSON', () => {
		expect(() => JSON.parse(output)).not.toThrow();
	});

	it('has session.id matching sessionId', () => {
		const parsed = JSON.parse(output);
		expect(parsed.session.id).toBe('test-123');
	});

	it('has session.project matching project', () => {
		const parsed = JSON.parse(output);
		expect(parsed.session.project).toBe('my-project');
	});

	it('has events array with length 3', () => {
		const parsed = JSON.parse(output);
		expect(parsed.events).toHaveLength(3);
	});

	it('events contain timestamp and eventType fields', () => {
		const parsed = JSON.parse(output);
		for (const event of parsed.events) {
			expect(event).toHaveProperty('timestamp');
			expect(event).toHaveProperty('eventType');
		}
	});
});
