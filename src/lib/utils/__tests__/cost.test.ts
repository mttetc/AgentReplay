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
});
