import { exec } from 'child_process';
import { promisify } from 'util';
import type { TimelineEvent, ToolCallEvent } from '$lib/types/timeline';

const execAsync = promisify(exec);

// Use a separator unlikely to appear in commit messages
const SEP = '\x00';

export interface GitCommit {
	hash: string;
	shortHash: string;
	subject: string;
	author: string;
	date: string;
	filesChanged: string[];
}

/**
 * Find git commits that correlate with a session based on:
 * - Time overlap (commits made during the session)
 * - File overlap (commits touching files the session edited)
 */
export async function findRelatedCommits(
	projectPath: string,
	startedAt: string,
	lastActiveAt: string,
	events: TimelineEvent[]
): Promise<GitCommit[]> {
	const sessionFiles = new Set<string>();
	for (const event of events) {
		if (event.data.eventType !== 'tool_call') continue;
		const tc = event.data as ToolCallEvent;
		if (!['Write', 'Edit'].includes(tc.toolName)) continue;
		const filePath = tc.input.file_path as string;
		if (filePath) sessionFiles.add(filePath);
	}

	const gitDir = await findGitDir(projectPath);
	if (!gitDir) return [];

	const start = new Date(new Date(startedAt).getTime() - 60_000);
	const end = new Date(new Date(lastActiveAt).getTime() + 300_000);

	try {
		// Use NUL byte as field separator to avoid clashes with commit messages
		const format = `%H${SEP}%h${SEP}%s${SEP}%an${SEP}%aI`;
		const { stdout } = await execAsync(
			`git log --after="${start.toISOString()}" --before="${end.toISOString()}" --format="${format}" --name-only`,
			{ cwd: gitDir, timeout: 5000 }
		);

		if (!stdout.trim()) return [];

		return parseGitLog(stdout, sessionFiles);
	} catch {
		return [];
	}
}

function parseGitLog(stdout: string, sessionFiles: Set<string>): GitCommit[] {
	const commits: GitCommit[] = [];
	// Blocks are separated by blank lines (between format line and file list)
	const blocks = stdout.trim().split('\n\n');

	for (const block of blocks) {
		const lines = block.split('\n').filter(Boolean);
		if (lines.length === 0) continue;

		const parts = lines[0].split(SEP);
		if (parts.length < 5) continue;

		const hash = parts[0];
		const shortHash = parts[1];
		const subject = parts[2];
		const author = parts[3];
		const date = parts[4];

		// Validate date — skip if unparseable
		if (!date || isNaN(new Date(date).getTime())) continue;

		const filesChanged = lines.slice(1).filter(f => f.trim() && !f.includes(SEP));

		commits.push({ hash, shortHash, subject, author, date, filesChanged });
	}

	// Sort by file overlap (most relevant first), then by date
	commits.sort((a, b) => {
		const aOverlap = countFileOverlap(a.filesChanged, sessionFiles);
		const bOverlap = countFileOverlap(b.filesChanged, sessionFiles);
		if (bOverlap !== aOverlap) return bOverlap - aOverlap;
		return new Date(b.date).getTime() - new Date(a.date).getTime();
	});

	return commits.slice(0, 10);
}

function countFileOverlap(commitFiles: string[], sessionFiles: Set<string>): number {
	return commitFiles.filter(f =>
		[...sessionFiles].some(sf => {
			const sfBase = sf.split('/').pop() || '';
			return sf.endsWith(f) || f.endsWith(sfBase);
		})
	).length;
}

async function findGitDir(projectPath: string): Promise<string | null> {
	// Try the path as-is first (works when cwd is passed)
	for (const candidate of getCandidatePaths(projectPath)) {
		try {
			const { stdout } = await execAsync('git rev-parse --show-toplevel', {
				cwd: candidate,
				timeout: 3000
			});
			return stdout.trim();
		} catch {
			continue;
		}
	}
	return null;
}

function getCandidatePaths(projectPath: string): string[] {
	const candidates: string[] = [];

	// If it's already an absolute path, try it directly
	if (projectPath.startsWith('/')) {
		candidates.push(projectPath);
	}

	// Claude Code encodes: /Users/foo/my-project → -Users-foo-my-project
	// Naive decode (replace all - with /) breaks names with hyphens.
	// Strategy: try progressively replacing leading segments.
	const encoded = projectPath.startsWith('-') ? projectPath : `-${projectPath}`;
	const parts = encoded.split('-').filter(Boolean);

	// Try reconstructing the path by joining with / but keeping last N segments joined with -
	// e.g. for parts [Users, mttetc, Projects, agent, replay]:
	//   /Users/mttetc/Projects/agent-replay  (join last 2 with -)
	//   /Users/mttetc/Projects/agent/replay  (join all with /)
	for (let keepLast = 0; keepLast <= Math.min(parts.length - 2, 4); keepLast++) {
		const dirParts = parts.slice(0, parts.length - keepLast);
		const tailParts = parts.slice(parts.length - keepLast);
		const dir = '/' + dirParts.join('/');
		const tail = tailParts.length > 0 ? '-' + tailParts.join('-') : '';
		const full = dir + tail;
		if (!candidates.includes(full)) candidates.push(full);
	}

	// Also try the simple naive decode as last resort
	const naive = '/' + projectPath.replace(/-/g, '/');
	if (!candidates.includes(naive)) candidates.push(naive);

	return candidates;
}
