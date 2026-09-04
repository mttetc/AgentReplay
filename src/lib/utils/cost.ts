export interface Pricing {
	input: number;
	cacheRead: number;
	cacheCreation: number;
	output: number;
}

/**
 * Per-million-tokens pricing (USD) for the Anthropic first-party API.
 * Cache creation is the 5-minute TTL rate (1.25× input). Cache read is 0.1× input.
 *
 * Prices changed across generations, so matching is family + version aware:
 *   - Opus 4.5 and later (4.6, 4.7, 4.8, 5)  $5 / $25
 *   - Opus 4.1 and earlier                     $15 / $75
 *   - Sonnet 5                                 $2 / $10
 *   - Sonnet 4.x and earlier                   $3 / $15
 *   - Haiku 4.5                                $1 / $5
 *   - Haiku 3.5 and earlier                    $0.8 / $4
 *   - Fable / Mythos                           $10 / $50
 */
function tier(input: number, output: number): Pricing {
	return { input, cacheRead: input * 0.1, cacheCreation: input * 1.25, output };
}

const OPUS_CURRENT = tier(5, 25);
const OPUS_LEGACY = tier(15, 75);
const SONNET_5 = tier(2, 10);
const SONNET_LEGACY = tier(3, 15);
const HAIKU_45 = tier(1, 5);
const HAIKU_LEGACY = tier(0.8, 4);
const FABLE = tier(10, 50);

/** Sonnet 4.x pricing — used as the default for any unmatched model. */
const DEFAULT_PRICING: Pricing = SONNET_LEGACY;

/** Extract "major.minor" from ids like claude-opus-4-6, claude-sonnet-5, claude-haiku-4-5-20251001. */
export function modelVersion(model: string): number | null {
	const m = model.toLowerCase();
	// Family first: claude-opus-4-6, claude-sonnet-5, claude-haiku-4-5-20251001
	let match = m.match(/(?:opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:-(\d{1,2}))?(?:-|$)/);
	// Version first (older ids): claude-3-5-haiku-20241022, claude-3-opus-20240229
	if (!match) match = m.match(/claude-(\d{1,2})(?:-(\d{1,2}))?-(?:opus|sonnet|haiku)/);
	if (!match) return null;
	const major = parseInt(match[1], 10);
	const minor = match[2] ? parseInt(match[2], 10) : 0;
	return major + minor / 10;
}

/**
 * Map an Anthropic model id to its pricing tier. Substring matching on the
 * family plus a version threshold, so new minor releases work without an
 * entry per model.
 */
export function pricingForModel(model: string): Pricing {
	const m = (model || '').toLowerCase();
	const v = modelVersion(m);
	if (m.includes('fable') || m.includes('mythos')) return FABLE;
	if (m.includes('opus')) return v !== null && v >= 4.5 ? OPUS_CURRENT : OPUS_LEGACY;
	if (m.includes('haiku')) return v !== null && v >= 4.5 ? HAIKU_45 : HAIKU_LEGACY;
	if (m.includes('sonnet')) return v !== null && v >= 5 ? SONNET_5 : SONNET_LEGACY;
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
