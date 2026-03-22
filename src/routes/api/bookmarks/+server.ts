import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getBookmarks, addBookmark, removeBookmark } from '$lib/server/db';

/** No script tags, no null bytes */
const safeId = z.string().min(1).max(500).regex(/^[^<\x00]*$/);
const safeLabel = z.string().min(1).max(200).regex(/^[^<\x00]*$/);

/** GET /api/bookmarks?sessionId=xxx — get bookmarks for a session */
export const GET = async ({ url }: { url: URL }) => {
	const parsed = safeId.safeParse(url.searchParams.get('sessionId'));
	if (!parsed.success) {
		return json({ error: 'sessionId required' }, { status: 400 });
	}
	return json(getBookmarks(parsed.data));
};

const AddBody = z.object({ sessionId: safeId, eventId: safeId.nullable(), label: safeLabel });
const RemoveBody = z.object({ id: z.number().int().positive(), action: z.literal('remove') });
const PostBody = z.union([RemoveBody, AddBody]);

/** POST /api/bookmarks — add or remove a bookmark */
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
	if ('action' in body && body.action === 'remove') {
		removeBookmark(body.id);
		return json({ ok: true });
	}
	const addBody = body as z.infer<typeof AddBody>;
	const id = addBookmark(addBody.sessionId, addBody.eventId, addBody.label);
	return json({ ok: true, id });
};
