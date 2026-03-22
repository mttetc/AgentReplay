import { describe, it, expect, beforeEach } from 'vitest';
import { parseSession } from '$lib/server/parser';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../__tests__/fixtures');

// Each test uses a unique sessionId to avoid hitting the 30s cache
let testCounter = 0;
function uniqueSessionId(prefix: string): string {
	return `${prefix}-${Date.now()}-${testCounter++}`;
}

describe('parseSession', () => {
	describe('simple session', () => {
		it('parses a simple user + assistant exchange', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('simple'), 'my-project');

			expect(result.events).toHaveLength(2);
			expect(result.events[0].data.eventType).toBe('user_message');
			expect(result.events[1].data.eventType).toBe('assistant_text');
		});

		it('extracts slug from user entry', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('slug'), 'my-project');

			expect(result.summary.slug).toBe('test-project');
		});

		it('extracts model containing sonnet', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('model'), 'my-project');

			expect(result.summary.model).toContain('sonnet');
		});

		it('reports correct token counts', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('tokens'), 'my-project');

			expect(result.summary.inputTokens).toBe(100);
			expect(result.summary.outputTokens).toBe(50);
		});

		it('computes a positive estimated cost', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('cost'), 'my-project');

			expect(result.summary.estimatedCost).toBeGreaterThan(0);
		});

		it('sets provider to claude-code', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('provider'), 'my-project');

			expect(result.summary.provider).toBe('claude-code');
		});

		it('returns user_message text and assistant_text text', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('text'), 'my-project');

			const userEvent = result.events[0];
			const assistantEvent = result.events[1];

			expect(userEvent.data.eventType === 'user_message' && userEvent.data.text).toBe(
				'Hello, help me with my project'
			);
			expect(
				assistantEvent.data.eventType === 'assistant_text' && assistantEvent.data.text
			).toBe("I'll help you with your project.");
		});
	});

	describe('tool session', () => {
		it('parses a tool_call event with correct toolName', async () => {
			const filePath = path.join(fixturesDir, 'tool-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('tool'), 'my-project');

			const toolEvent = result.events.find((e) => e.data.eventType === 'tool_call');
			expect(toolEvent).toBeDefined();
			expect(toolEvent!.data.eventType === 'tool_call' && toolEvent!.data.toolName).toBe(
				'Bash'
			);
		});

		it('matches tool_result to tool_use by ID', async () => {
			const filePath = path.join(fixturesDir, 'tool-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('tool-result'), 'my-project');

			const toolEvent = result.events.find((e) => e.data.eventType === 'tool_call');
			expect(toolEvent).toBeDefined();

			if (toolEvent!.data.eventType === 'tool_call') {
				expect(toolEvent!.data.result).toBeDefined();
				expect(toolEvent!.data.result!.content).toContain('file1.ts');
				expect(toolEvent!.data.result!.isError).toBe(false);
			}
		});

		it('reports toolCallCount of 1', async () => {
			const filePath = path.join(fixturesDir, 'tool-session.jsonl');
			const result = await parseSession(
				filePath,
				uniqueSessionId('tool-count'),
				'my-project'
			);

			expect(result.summary.toolCallCount).toBe(1);
		});
	});

	describe('streamed session', () => {
		it('reassembles streamed assistant entries into a single turn', async () => {
			const filePath = path.join(fixturesDir, 'streamed-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('stream'), 'my-project');

			// 1 user_message + 2 assistant_text blocks (both text blocks from the merged turn)
			const userEvents = result.events.filter((e) => e.data.eventType === 'user_message');
			const assistantEvents = result.events.filter(
				(e) => e.data.eventType === 'assistant_text'
			);

			expect(userEvents).toHaveLength(1);
			expect(assistantEvents).toHaveLength(2);
		});

		it('includes text from both streamed entries', async () => {
			const filePath = path.join(fixturesDir, 'streamed-session.jsonl');
			const result = await parseSession(filePath, uniqueSessionId('stream-text'), 'my-project');

			const texts = result.events
				.filter((e) => e.data.eventType === 'assistant_text')
				.map((e) => (e.data.eventType === 'assistant_text' ? e.data.text : ''));

			expect(texts.some((t) => t.includes('process data'))).toBe(true);
			expect(texts.some((t) => t.includes('incrementally'))).toBe(true);
		});
	});

	describe('malformed session', () => {
		it('does not throw on malformed input', async () => {
			const filePath = path.join(fixturesDir, 'malformed.jsonl');

			await expect(
				parseSession(filePath, uniqueSessionId('malformed'), 'my-project')
			).resolves.toBeDefined();
		});

		it('skips invalid JSON lines and filtered entry types', async () => {
			const filePath = path.join(fixturesDir, 'malformed.jsonl');
			const result = await parseSession(
				filePath,
				uniqueSessionId('malformed-skip'),
				'my-project'
			);

			// Only the valid user + assistant entries should produce events
			expect(result.events).toHaveLength(2);
		});

		it('still parses the valid user and assistant entries', async () => {
			const filePath = path.join(fixturesDir, 'malformed.jsonl');
			const result = await parseSession(
				filePath,
				uniqueSessionId('malformed-valid'),
				'my-project'
			);

			expect(result.events[0].data.eventType).toBe('user_message');
			expect(result.events[1].data.eventType).toBe('assistant_text');
		});
	});

	describe('summary fields', () => {
		it('passes through sessionId and project', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const sid = uniqueSessionId('summary-ids');
			const result = await parseSession(filePath, sid, 'my-project');

			expect(result.summary.sessionId).toBe(sid);
			expect(result.summary.project).toBe('my-project');
		});

		it('has valid ISO date strings for startedAt and lastActiveAt', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(
				filePath,
				uniqueSessionId('summary-dates'),
				'my-project'
			);

			const startedAtDate = new Date(result.summary.startedAt);
			expect(startedAtDate.getTime()).not.toBeNaN();

			const lastActiveAtDate = new Date(result.summary.lastActiveAt);
			expect(lastActiveAtDate.getTime()).not.toBeNaN();
		});

		it('has eventCount matching events.length', async () => {
			const filePath = path.join(fixturesDir, 'simple-session.jsonl');
			const result = await parseSession(
				filePath,
				uniqueSessionId('summary-count'),
				'my-project'
			);

			expect(result.summary.eventCount).toBe(result.events.length);
		});
	});
});
