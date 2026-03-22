import { json } from '@sveltejs/kit';
import { getAnnotations, setAnnotation, importAnnotationsFromLocalStorage } from '$lib/server/db';

function isValidId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 500;
}

function isValidMigrationData(
	data: unknown
): data is Record<string, Array<{ eventId: string; text: string; createdAt: string }>> {
	if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
	for (const [, value] of Object.entries(data)) {
		if (!Array.isArray(value)) return false;
		for (const item of value) {
			if (
				typeof item !== 'object' ||
				item === null ||
				typeof item.eventId !== 'string' ||
				typeof item.text !== 'string' ||
				typeof item.createdAt !== 'string'
			) {
				return false;
			}
		}
	}
	return true;
}

/** GET /api/annotations?sessionId=xxx — get all annotations for a session */
export const GET = async ({ url }: { url: URL }) => {
	const sessionId = url.searchParams.get('sessionId');
	if (!sessionId || !isValidId(sessionId)) {
		return json({ error: 'sessionId required' }, { status: 400 });
	}

	const annotations = getAnnotations(sessionId);
	return json(annotations);
};

/** POST /api/annotations — set or delete an annotation */
export const POST = async ({ request }: { request: Request }) => {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	// Migration endpoint: import from localStorage
	if (body.migrate && body.data) {
		if (!isValidMigrationData(body.data)) {
			return json({ error: 'Invalid migration data' }, { status: 400 });
		}
		const count = importAnnotationsFromLocalStorage(body.data);
		return json({ migrated: count });
	}

	const { sessionId, eventId, text } = body;
	if (!isValidId(sessionId) || !isValidId(eventId)) {
		return json({ error: 'sessionId and eventId required (non-empty strings, max 500 chars)' }, { status: 400 });
	}

	const annotationText = typeof text === 'string' ? text.slice(0, 10000) : '';
	setAnnotation(sessionId, eventId, annotationText);
	return json({ ok: true });
};
