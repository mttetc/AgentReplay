import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getTags, setTag, removeTag, getAllTags } from '$lib/server/db';

/** No script tags, no null bytes */
const safeId = z.string().min(1).max(500).regex(/^[^<\x00]*$/);
const safeTag = z.string().min(1).max(50).regex(/^[a-zA-Z0-9_\- ]+$/);

/** GET /api/tags?sessionId=xxx — get tags for a session */
/** GET /api/tags — get all tags with counts */
export const GET = async ({ url }: { url: URL }) => {
	const sessionId = url.searchParams.get('sessionId');
	if (sessionId) {
		const parsed = safeId.safeParse(sessionId);
		if (!parsed.success) {
			return json({ error: 'Invalid sessionId' }, { status: 400 });
		}
		return json(getTags(parsed.data));
	}
	return json(getAllTags());
};

const AddTagBody = z.object({ sessionId: safeId, tag: safeTag });
const RemoveTagBody = z.object({ sessionId: safeId, tag: safeTag, action: z.literal('remove') });
const PostBody = z.union([RemoveTagBody, AddTagBody]);

/** POST /api/tags — add or remove a tag */
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
		removeTag(body.sessionId, body.tag);
	} else {
		setTag(body.sessionId, body.tag);
	}
	return json({ ok: true });
};
