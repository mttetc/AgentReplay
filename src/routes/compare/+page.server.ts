import type { PageServerLoad } from './$types';
import { parseSession } from '$lib/server/parser';
import { error, redirect } from '@sveltejs/kit';
import { CLAUDE_DIR } from '$lib/server/config';
import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';

const sessionIdSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);

function decodeProjectName(dirName: string): string {
	return dirName.replace(/-/g, '/').replace(/^\//, '');
}

async function findAndParse(sessionId: string) {
	let projectDirs: string[];
	try {
		projectDirs = await readdir(CLAUDE_DIR);
	} catch {
		throw error(500, 'Cannot read Claude sessions directory');
	}

	for (const projectDir of projectDirs) {
		const candidate = join(CLAUDE_DIR, projectDir, `${sessionId}.jsonl`);
		try {
			await access(candidate);
			const project = decodeProjectName(projectDir);
			return await parseSession(candidate, sessionId, project);
		} catch {
			continue;
		}
	}

	throw error(404, `Session ${sessionId} not found`);
}

export const load: PageServerLoad = async ({ url }) => {
	const aResult = sessionIdSchema.safeParse(url.searchParams.get('a'));
	const bResult = sessionIdSchema.safeParse(url.searchParams.get('b'));

	if (!aResult.success || !bResult.success) {
		throw redirect(302, '/');
	}

	const [timelineA, timelineB] = await Promise.all([
		findAndParse(aResult.data),
		findAndParse(bResult.data)
	]);

	return { timelineA, timelineB };
};
