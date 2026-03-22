import type { PageServerLoad } from './$types';
import { analyzeCodebase } from '$lib/server/codebase-analysis';

export const load: PageServerLoad = async ({ url }) => {
	const range = url.searchParams.get('range') || '30d';
	const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
	const daysBack = daysMap[range] ?? undefined;
	const analysis = await analyzeCodebase(daysBack);
	return { analysis, range };
};
