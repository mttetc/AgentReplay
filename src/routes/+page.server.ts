import type { PageServerLoad } from './$types';
import { analyzeCodebase } from '$lib/server/codebase-analysis';
import { analyzeOverhead } from '$lib/server/overhead-analysis';
import { z } from 'zod';

const rangeSchema = z.enum(['7d', '30d', '90d', 'all']).catch('30d');

export const load: PageServerLoad = async ({ url }) => {
	const range = rangeSchema.parse(url.searchParams.get('range') || '30d');
	const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
	const daysBack = daysMap[range] ?? undefined;
	const [analysis, overhead] = await Promise.all([
		analyzeCodebase(daysBack),
		analyzeOverhead(daysBack ?? 30)
	]);
	return { analysis, overhead, range };
};
