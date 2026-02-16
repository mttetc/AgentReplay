/** Pricing per million tokens (USD) — approximate as of early 2025 */
const PRICING: Record<string, { input: number; output: number }> = {
	'claude-opus-4-6': { input: 15, output: 75 },
	'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
	'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
	// Older models
	'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
	'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
	'claude-3-opus-20240229': { input: 15, output: 75 },
	'claude-3-sonnet-20240229': { input: 3, output: 15 }
};

const DEFAULT_PRICING = { input: 3, output: 15 };

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
	const pricing = PRICING[model] || DEFAULT_PRICING;
	return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
