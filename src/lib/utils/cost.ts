export interface Pricing {
	input: number;
	cacheRead: number;
	cacheCreation: number;
	output: number;
}

/**
 * Per-million-tokens pricing (USD), keyed by model family.
 * Cache creation is the 5-minute TTL rate (1.25× input). Cache read is 0.1× input.
 */
const PRICING_BY_FAMILY: Record<'opus' | 'sonnet' | 'haiku', Pricing> = {
	opus: { input: 15, cacheRead: 1.5, cacheCreation: 18.75, output: 75 },
	sonnet: { input: 3, cacheRead: 0.3, cacheCreation: 3.75, output: 15 },
	haiku: { input: 0.8, cacheRead: 0.08, cacheCreation: 1, output: 4 }
};

/** Sonnet pricing — used as the default for any unmatched `claude-*` model. */
const DEFAULT_PRICING: Pricing = PRICING_BY_FAMILY.sonnet;

/**
 * Map an Anthropic model id to its pricing tier. Uses substring matching so new
 * minor versions (`claude-opus-4-7`, `claude-sonnet-4-6`, etc.) work without
 * needing an entry per release.
 */
export function pricingForModel(model: string): Pricing {
	const m = (model || '').toLowerCase();
	if (m.includes('opus')) return PRICING_BY_FAMILY.opus;
	if (m.includes('haiku')) return PRICING_BY_FAMILY.haiku;
	if (m.includes('sonnet')) return PRICING_BY_FAMILY.sonnet;
	return DEFAULT_PRICING;
}

export function estimateCost(
	model: string,
	inputTokens: number,
	outputTokens: number,
	cacheReadTokens = 0,
	cacheCreationTokens = 0
): number {
	const p = pricingForModel(model);
	return (
		inputTokens * p.input +
		cacheReadTokens * p.cacheRead +
		cacheCreationTokens * p.cacheCreation +
		outputTokens * p.output
	) / 1_000_000;
}
