import { json } from '@sveltejs/kit';
import { discoverAllSessions } from '$lib/server/providers';

export async function GET() {
	const sessions = await discoverAllSessions();
	return json(sessions, {
		headers: { 'Cache-Control': 'private, max-age=10' }
	});
}
