import { describe, it, expect } from 'vitest';
import {
	formatDuration,
	formatDurationBetween,
	formatNumber,
	formatCost,
	shortModel,
	truncate,
	shortPath,
	inferLanguage
} from '$lib/utils/format';

describe('formatDuration', () => {
	it('formats milliseconds when under 1 second', () => {
		expect(formatDuration(500)).toBe('500ms');
		expect(formatDuration(0)).toBe('0ms');
		expect(formatDuration(999)).toBe('999ms');
	});

	it('formats seconds when under 1 minute', () => {
		expect(formatDuration(1000)).toBe('1s');
		expect(formatDuration(30_000)).toBe('30s');
		expect(formatDuration(59_999)).toBe('59s');
	});

	it('formats minutes and seconds when under 1 hour', () => {
		expect(formatDuration(60_000)).toBe('1m 0s');
		expect(formatDuration(90_000)).toBe('1m 30s');
		expect(formatDuration(3_599_000)).toBe('59m 59s');
	});

	it('formats hours and minutes', () => {
		expect(formatDuration(3_600_000)).toBe('1h 0m');
		expect(formatDuration(5_400_000)).toBe('1h 30m');
		expect(formatDuration(7_260_000)).toBe('2h 1m');
	});
});

describe('formatDurationBetween', () => {
	it('formats duration between two ISO timestamps', () => {
		const start = '2025-01-01T00:00:00Z';
		const end = '2025-01-01T00:05:30Z';
		expect(formatDurationBetween(start, end)).toBe('5m 30s');
	});

	it('returns "0s" for zero or negative duration', () => {
		const t = '2025-01-01T00:00:00Z';
		expect(formatDurationBetween(t, t)).toBe('0s');

		const earlier = '2024-12-31T23:59:00Z';
		expect(formatDurationBetween(t, earlier)).toBe('0s');
	});
});

describe('formatNumber', () => {
	it('returns raw number when under 1000', () => {
		expect(formatNumber(0)).toBe('0');
		expect(formatNumber(999)).toBe('999');
	});

	it('formats thousands with K suffix', () => {
		expect(formatNumber(1000)).toBe('1.0K');
		expect(formatNumber(1500)).toBe('1.5K');
		expect(formatNumber(999_999)).toBe('1000.0K');
	});

	it('formats millions with M suffix', () => {
		expect(formatNumber(1_000_000)).toBe('1.00M');
		expect(formatNumber(2_500_000)).toBe('2.50M');
	});
});

describe('formatCost', () => {
	it('returns "<$0.01" for costs under a cent', () => {
		expect(formatCost(0)).toBe('<$0.01');
		expect(formatCost(0.005)).toBe('<$0.01');
		expect(formatCost(0.0099)).toBe('<$0.01');
	});

	it('formats costs to two decimal places', () => {
		expect(formatCost(0.01)).toBe('$0.01');
		expect(formatCost(1.5)).toBe('$1.50');
		expect(formatCost(99.999)).toBe('$100.00');
	});
});

describe('shortModel', () => {
	it('shortens opus model names', () => {
		expect(shortModel('claude-opus-4-6')).toBe('Opus 4.6');
	});

	it('shortens sonnet model names', () => {
		expect(shortModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
	});

	it('shortens haiku model names', () => {
		expect(shortModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
	});

	it('returns "Unknown" for empty or synthetic models', () => {
		expect(shortModel('')).toBe('Unknown');
		expect(shortModel('synthetic')).toBe('Unknown');
	});

	it('returns the raw model string for unrecognized models', () => {
		expect(shortModel('gpt-4')).toBe('gpt-4');
	});
});

describe('truncate', () => {
	it('returns short text unchanged', () => {
		expect(truncate('hello', 10)).toBe('hello');
		expect(truncate('exact', 5)).toBe('exact');
	});

	it('truncates long text with ellipsis', () => {
		expect(truncate('hello world', 8)).toBe('hello w…');
		expect(truncate('abcdef', 4)).toBe('abc…');
	});
});

describe('shortPath', () => {
	it('returns last two path segments', () => {
		expect(shortPath('/a/b/c/d.ts')).toBe('c/d.ts');
		expect(shortPath('/Users/me/project/src/index.ts')).toBe('src/index.ts');
	});

	it('handles paths with fewer than two segments', () => {
		expect(shortPath('file.ts')).toBe('file.ts');
	});
});

describe('inferLanguage', () => {
	it('maps known extensions to languages', () => {
		expect(inferLanguage('file.ts')).toBe('typescript');
		expect(inferLanguage('file.py')).toBe('python');
		expect(inferLanguage('file.rs')).toBe('rust');
		expect(inferLanguage('file.go')).toBe('go');
		expect(inferLanguage('file.svelte')).toBe('svelte');
		expect(inferLanguage('file.json')).toBe('json');
	});

	it('returns "text" for unknown extensions', () => {
		expect(inferLanguage('file.xyz')).toBe('text');
		expect(inferLanguage('file.unknown')).toBe('text');
	});
});
