import { json } from '@sveltejs/kit';
import { getAnnotations, setAnnotation, importAnnotationsFromLocalStorage } from '$lib/server/db';

/** GET /api/annotations?sessionId=xxx — get all annotations for a session */
export const GET = async ({ url }: { url: URL }) => {
	const sessionId = url.searchParams.get('sessionId');
	if (!sessionId) {
		return json({ error: 'sessionId required' }, { status: 400 });
	}

	const annotations = getAnnotations(sessionId);
	return json(annotations);
};

/** POST /api/annotations — set or delete an annotation */
export const POST = async ({ request }: { request: Request }) => {
	const body = await request.json();

	// Migration endpoint: import from localStorage
	if (body.migrate && body.data) {
		const count = importAnnotationsFromLocalStorage(body.data);
		return json({ migrated: count });
	}

	const { sessionId, eventId, text } = body;
	if (!sessionId || !eventId) {
		return json({ error: 'sessionId and eventId required' }, { status: 400 });
	}

	setAnnotation(sessionId, eventId, text || '');
	return json({ ok: true });
};
