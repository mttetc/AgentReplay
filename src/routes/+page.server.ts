import type { PageServerLoad } from './$types';
import { discoverAllSessions } from '$lib/server/providers';

export const load: PageServerLoad = async () => {
	const sessions = await discoverAllSessions();
	return { sessions };
};
