import { describe, it, expect } from 'vitest';
import { estimateCost } from '$lib/utils/cost';

describe('estimateCost', () => {
	it('calculates cost for claude-opus-4-6', () => {
		const cost = estimateCost('claude-opus-4-6', 1000, 500);
		expect(cost).toBe((1000 * 15 + 500 * 75) / 1_000_000);
	});

	it('calculates cost for claude-sonnet-4-5-20250929', () => {
		const cost = estimateCost('claude-sonnet-4-5-20250929', 2000, 1000);
		expect(cost).toBe((2000 * 3 + 1000 * 15) / 1_000_000);
	});

	it('calculates cost for claude-haiku-4-5-20251001', () => {
		const cost = estimateCost('claude-haiku-4-5-20251001', 5000, 2000);
		expect(cost).toBe((5000 * 0.8 + 2000 * 4) / 1_000_000);
	});

	it('falls back to default (sonnet) pricing for unknown models', () => {
		const cost = estimateCost('unknown-model-v1', 1000, 500);
		expect(cost).toBe((1000 * 3 + 500 * 15) / 1_000_000);
	});

	it('returns 0 for zero tokens', () => {
		expect(estimateCost('claude-opus-4-6', 0, 0)).toBe(0);
	});

	it('handles large token counts correctly', () => {
		const cost = estimateCost('claude-opus-4-6', 1_000_000, 500_000);
		expect(cost).toBe((1_000_000 * 15 + 500_000 * 75) / 1_000_000);
	});

	it('calculates cost with cache read tokens at reduced rate', () => {
		const cost = estimateCost('claude-sonnet-4-5-20250929', 1000, 500, 2000);
		expect(cost).toBe((1000 * 3 + 500 * 15 + 2000 * 0.3) / 1_000_000);
	});

	it('cache tokens are much cheaper than regular input', () => {
		const costAsInput = estimateCost('claude-sonnet-4-5-20250929', 1000, 0);
		const costAsCache = estimateCost('claude-sonnet-4-5-20250929', 0, 0, 1000);
		expect(costAsCache).toBeCloseTo(costAsInput * 0.1, 10);
	});

	it('handles zero cache tokens explicitly', () => {
		const withoutArg = estimateCost('claude-opus-4-6', 1000, 500);
		const withZero = estimateCost('claude-opus-4-6', 1000, 500, 0);
		expect(withZero).toBe(withoutArg);
	});

	it('matches Opus pricing for newer Opus model ids by prefix', () => {
		const cost = estimateCost('claude-opus-4-7', 1000, 500);
		expect(cost).toBe((1000 * 15 + 500 * 75) / 1_000_000);
	});

	it('matches Sonnet pricing for newer Sonnet model ids by prefix', () => {
		const cost = estimateCost('claude-sonnet-4-6', 1000, 500);
		expect(cost).toBe((1000 * 3 + 500 * 15) / 1_000_000);
	});

	it('charges cache_creation tokens at 1.25x input rate (Sonnet)', () => {
		const cost = estimateCost('claude-sonnet-4-5-20250929', 0, 0, 0, 1000);
		expect(cost).toBeCloseTo((1000 * 3.75) / 1_000_000, 10);
	});

	it('charges cache_creation tokens at 1.25x input rate (Opus)', () => {
		const cost = estimateCost('claude-opus-4-7', 0, 0, 0, 1000);
		expect(cost).toBeCloseTo((1000 * 18.75) / 1_000_000, 10);
	});
});
