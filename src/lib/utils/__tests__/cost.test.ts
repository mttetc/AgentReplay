import { describe, it, expect } from 'vitest';
import { estimateCost, modelVersion, pricingForModel } from '$lib/utils/cost';

describe('modelVersion', () => {
	it('reads major.minor and ignores date suffixes', () => {
		expect(modelVersion('claude-opus-4-6')).toBe(4.6);
		expect(modelVersion('claude-sonnet-5')).toBe(5);
		expect(modelVersion('claude-haiku-4-5-20251001')).toBe(4.5);
		expect(modelVersion('claude-opus-4-1-20250805')).toBe(4.1);
		expect(modelVersion('synthetic')).toBeNull();
	});
});

describe('pricingForModel', () => {
	it('prices current Opus at $5/$25 and legacy Opus at $15/$75', () => {
		expect(pricingForModel('claude-opus-4-6').input).toBe(5);
		expect(pricingForModel('claude-opus-5').output).toBe(25);
		expect(pricingForModel('claude-opus-4-1-20250805').input).toBe(15);
	});

	it('prices Sonnet 5 at $2/$10 and Sonnet 4.x at $3/$15', () => {
		expect(pricingForModel('claude-sonnet-5').input).toBe(2);
		expect(pricingForModel('claude-sonnet-4-6').input).toBe(3);
	});

	it('prices Haiku 4.5 at $1/$5 and older Haiku at $0.8/$4', () => {
		expect(pricingForModel('claude-haiku-4-5-20251001').input).toBe(1);
		expect(pricingForModel('claude-3-5-haiku-20241022').input).toBe(0.8);
	});

	it('prices Fable and Mythos at $10/$50', () => {
		expect(pricingForModel('claude-fable-5-1').input).toBe(10);
		expect(pricingForModel('claude-mythos-5-1').output).toBe(50);
	});
});

describe('estimateCost', () => {
	it('calculates cost for claude-opus-4-6', () => {
		const cost = estimateCost('claude-opus-4-6', 1000, 500);
		expect(cost).toBe((1000 * 5 + 500 * 25) / 1_000_000);
	});

	it('calculates cost for claude-sonnet-4-5-20250929', () => {
		const cost = estimateCost('claude-sonnet-4-5-20250929', 2000, 1000);
		expect(cost).toBe((2000 * 3 + 1000 * 15) / 1_000_000);
	});

	it('calculates cost for claude-haiku-4-5-20251001', () => {
		const cost = estimateCost('claude-haiku-4-5-20251001', 5000, 2000);
		expect(cost).toBe((5000 * 1 + 2000 * 5) / 1_000_000);
	});

	it('falls back to default (Sonnet 4.x) pricing for unknown models', () => {
		const cost = estimateCost('unknown-model-v1', 1000, 500);
		expect(cost).toBe((1000 * 3 + 500 * 15) / 1_000_000);
	});

	it('returns 0 for zero tokens', () => {
		expect(estimateCost('claude-opus-4-6', 0, 0)).toBe(0);
	});

	it('handles large token counts correctly', () => {
		const cost = estimateCost('claude-opus-4-6', 1_000_000, 500_000);
		expect(cost).toBe((1_000_000 * 5 + 500_000 * 25) / 1_000_000);
	});

	it('calculates cost with cache read tokens at reduced rate', () => {
		const cost = estimateCost('claude-sonnet-4-5-20250929', 1000, 500, 2000);
		expect(cost).toBeCloseTo((1000 * 3 + 500 * 15 + 2000 * 0.3) / 1_000_000, 12);
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

	it('matches current Opus pricing for newer Opus model ids', () => {
		const cost = estimateCost('claude-opus-4-7', 1000, 500);
		expect(cost).toBe((1000 * 5 + 500 * 25) / 1_000_000);
	});

	it('matches Sonnet 4.x pricing for sonnet-4-6', () => {
		const cost = estimateCost('claude-sonnet-4-6', 1000, 500);
		expect(cost).toBe((1000 * 3 + 500 * 15) / 1_000_000);
	});

	it('charges cache_creation tokens at 1.25x input rate (Sonnet)', () => {
		const cost = estimateCost('claude-sonnet-4-5-20250929', 0, 0, 0, 1000);
		expect(cost).toBeCloseTo((1000 * 3.75) / 1_000_000, 10);
	});

	it('charges cache_creation tokens at 1.25x input rate (Opus)', () => {
		const cost = estimateCost('claude-opus-4-7', 0, 0, 0, 1000);
		expect(cost).toBeCloseTo((1000 * 6.25) / 1_000_000, 10);
	});
});
