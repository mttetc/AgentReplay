import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getAnnotations, setAnnotation, importAnnotationsFromLocalStorage } from '$lib/server/db';

/** No script tags, no null bytes */
const safeId = z.string().min(1).max(500).regex(/^[^<\x00]*$/);
const safeText = z.string().max(10_000).regex(/^[^<\x00]*$/);

const AnnotationEntry = z.object({
	eventId: safeId,
	text: safeText,
	createdAt: safeText
});

const AnnotationBody = z.object({
	sessionId: safeId,
	eventId: safeId,
	text: safeText.optional().default('')
});

const MigrationBody = z.object({
	migrate: z.literal(true),
	data: z.record(safeId, z.array(AnnotationEntry))
});

const PostBody = z.union([MigrationBody, AnnotationBody]);

/** GET /api/annotations?sessionId=xxx — get all annotations for a session */
export const GET = async ({ url }: { url: URL }) => {
	const sessionId = url.searchParams.get('sessionId');
	const parsed = safeId.safeParse(sessionId);
	if (!parsed.success) {
		return json({ error: 'sessionId required' }, { status: 400 });
	}

	const annotations = getAnnotations(parsed.data);
	return json(annotations);
};

/** POST /api/annotations — set or delete an annotation */
export const POST = async ({ request }: { request: Request }) => {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const parsed = PostBody.safeParse(rawBody);
	if (!parsed.success) {
		return json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 });
	}

	const body = parsed.data;

	if ('migrate' in body) {
		const migrationData: Record<string, Array<{ eventId: string; text: string; createdAt: string }>> = body.data;
		const count = importAnnotationsFromLocalStorage(migrationData);
		return json({ migrated: count });
	}

	setAnnotation(body.sessionId, body.eventId, body.text);
	return json({ ok: true });
};
