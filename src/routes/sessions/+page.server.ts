import type { PageServerLoad } from './$types';
import { discoverAllSessions } from '$lib/server/providers';

export const load: PageServerLoad = async () => {
	const { sessions, providerErrors } = await discoverAllSessions();
	return { sessions, providerErrors };
};
