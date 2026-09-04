import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, realpath } from 'fs/promises';
import { join, relative, isAbsolute, dirname, basename } from 'path';
import type { SessionTimeline, TimelineEvent, ToolCallEvent } from '$lib/types/timeline';
import { findGitDir } from './git-integration';
import { getCachedAnalysis, setCachedAnalysis } from './db';

const execFileAsync = promisify(execFile);

/**
 * Code survival — the one outcome metric that session logs alone cannot give you.
 *
 * For every Edit/Write the agent made, we take the lines it produced, follow them
 * into the repository as it is *now*, and classify each one:
 *
 *   - committed   : present in the working tree and in HEAD
 *   - uncommitted : present in the working tree but not yet in HEAD
 *   - gone        : no longer in the working tree (rewritten by a human,
 *                   reverted, or superseded by a later session)
 *
 * Lines the agent wrote and then replaced *itself* during the session are
 * counted separately as "self-revised" — they are churn, not human rework.
 *
 * The comparison is line-based and whitespace-insensitive. Very short lines
 * (`}`, `);`, `end`) are ignored because they carry no authorship signal.
 * That makes the metric a slight under-count of true survival on files with
 * lots of boilerplate, and that is the direction we want to err in.
 */

/** A line must have at least this many characters after normalization to count. */
export const MIN_SIGNIFICANT_LENGTH = 6;

export type LineStatus = 'committed' | 'uncommitted' | 'gone';

export type FileSurvivalStatus =
	| 'kept' // ≥ 95% of agent lines still present
	| 'mostly-kept' // ≥ 70%
	| 'reworked' // > 0% but < 70%
	| 'discarded' // 0% present, file still exists
	| 'file-missing' // file no longer exists in the working tree
	| 'outside-repo' // edited path is not inside the session's git repository
	| 'unmeasurable'; // no significant lines to track (binary, tiny edits, etc.)

export interface AgentEdit {
	eventId: string;
	toolName: 'Edit' | 'Write';
	filePath: string;
	/** Normalized significant lines this edit introduced. */
	added: string[];
	/** Normalized significant lines this edit removed (Edit only). */
	removed: string[];
	/** Write replaces the whole file; the full normalized content is kept for net computation. */
	fullContent?: Set<string>;
}

export interface FileNet {
	filePath: string;
	/** Line → eventId that last introduced it. */
	net: Map<string, string>;
	/** Lines the agent wrote and later replaced itself in this session. */
	selfRevised: number;
	editCount: number;
	eventIds: string[];
}

export interface FileSurvival {
	path: string;
	relPath: string;
	status: FileSurvivalStatus;
	editCount: number;
	agentLines: number;
	committed: number;
	uncommitted: number;
	gone: number;
	selfRevised: number;
	/** 0–100, present now (committed + uncommitted) / agentLines. */
	survivalPct: number;
	/** Up to three examples of lines that did not survive, for the UI. */
	sampleGone: string[];
	eventIds: string[];
}

export interface SessionSurvival {
	repoRoot: string;
	headHash: string;
	measuredAt: string;
	files: FileSurvival[];
	filesSkipped: { outsideRepo: number; unmeasurable: number };
	agentLines: number;
	committed: number;
	uncommitted: number;
	gone: number;
	selfRevised: number;
	/** 0–100, share of agent lines still present in the working tree. */
	survivalPct: number;
	/** 0–100, share of agent lines that reached a commit. */
	committedPct: number;
	/** Interpretation of the numbers, spelled out so the UI never has to guess. */
	verdict: 'kept' | 'mostly-kept' | 'reworked' | 'discarded' | 'no-data';
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested, no I/O)
// ---------------------------------------------------------------------------

/** Collapse whitespace so indentation changes and trailing spaces don't count as rewrites. */
export function normalizeLine(line: string): string {
	return line.trim().replace(/\s+/g, ' ');
}

/** A line is significant if it is long enough and contains at least one letter or digit. */
export function isSignificant(normalized: string): boolean {
	return normalized.length >= MIN_SIGNIFICANT_LENGTH && /[A-Za-z0-9]/.test(normalized);
}

/** Normalize a blob of text into its set of significant lines. */
export function significantLines(text: string): Set<string> {
	const out = new Set<string>();
	for (const raw of text.split('\n')) {
		const n = normalizeLine(raw);
		if (isSignificant(n)) out.add(n);
	}
	return out;
}

/**
 * Pull every successful Edit/Write out of a timeline and reduce it to the
 * lines it added and removed. Only tool calls with a textual payload qualify:
 * Claude Code provides `old_string`/`new_string` for Edit and `content` for
 * Write. Other providers usually expose only the file path, and are skipped.
 */
export function extractAgentEdits(events: TimelineEvent[]): AgentEdit[] {
	const edits: AgentEdit[] = [];
	for (const event of events) {
		if (event.data.eventType !== 'tool_call') continue;
		const tc = event.data as ToolCallEvent;
		if (tc.result?.isError) continue;
		const input = tc.input as Record<string, unknown>;
		const filePath = typeof input.file_path === 'string' ? input.file_path : '';
		if (!filePath) continue;

		if (tc.toolName === 'Edit') {
			const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
			const newStr = typeof input.new_string === 'string' ? input.new_string : '';
			if (!newStr && !oldStr) continue;
			const oldSet = significantLines(oldStr);
			const newSet = significantLines(newStr);
			edits.push({
				eventId: event.id,
				toolName: 'Edit',
				filePath,
				added: [...newSet].filter((l) => !oldSet.has(l)),
				removed: [...oldSet].filter((l) => !newSet.has(l))
			});
		} else if (tc.toolName === 'Write') {
			const content = typeof input.content === 'string' ? input.content : '';
			const set = significantLines(content);
			edits.push({
				eventId: event.id,
				toolName: 'Write',
				filePath,
				added: [...set],
				removed: [],
				fullContent: set
			});
		}
	}
	return edits;
}

/**
 * Replay the agent's edits per file, in order, to get the lines it *net*
 * contributed by the end of the session. Lines the agent removed again are
 * counted as self-revised rather than attributed to a human.
 */
export function computeFileNets(edits: AgentEdit[]): Map<string, FileNet> {
	const nets = new Map<string, FileNet>();
	for (const edit of edits) {
		let fn = nets.get(edit.filePath);
		if (!fn) {
			fn = { filePath: edit.filePath, net: new Map(), selfRevised: 0, editCount: 0, eventIds: [] };
			nets.set(edit.filePath, fn);
		}
		fn.editCount++;
		fn.eventIds.push(edit.eventId);

		if (edit.toolName === 'Write' && edit.fullContent) {
			// A Write replaces the file: anything we previously attributed that is
			// not in the new content was revised away by the agent itself.
			for (const line of [...fn.net.keys()]) {
				if (!edit.fullContent.has(line)) {
					fn.net.delete(line);
					fn.selfRevised++;
				}
			}
			for (const line of edit.added) {
				if (!fn.net.has(line)) fn.net.set(line, edit.eventId);
			}
			continue;
		}

		for (const line of edit.removed) {
			if (fn.net.has(line)) {
				fn.net.delete(line);
				fn.selfRevised++;
			}
		}
		for (const line of edit.added) {
			fn.net.set(line, edit.eventId);
		}
	}
	return nets;
}

export interface FileSnapshot {
	/** Normalized significant lines of the file at HEAD, or null if absent there. */
	head: Set<string> | null;
	/** Normalized significant lines of the working-tree file, or null if missing. */
	workingTree: Set<string> | null;
}

/** Classify one file's net lines against what the repository holds now. */
export function classifyFile(
	fn: FileNet,
	relPath: string,
	snapshot: FileSnapshot
): FileSurvival {
	const agentLines = fn.net.size;
	const base: Omit<FileSurvival, 'status' | 'survivalPct'> = {
		path: fn.filePath,
		relPath,
		editCount: fn.editCount,
		agentLines,
		committed: 0,
		uncommitted: 0,
		gone: 0,
		selfRevised: fn.selfRevised,
		sampleGone: [],
		eventIds: fn.eventIds
	};

	if (agentLines === 0) {
		return { ...base, status: 'unmeasurable', survivalPct: 0 };
	}
	if (snapshot.workingTree === null) {
		return { ...base, gone: agentLines, status: 'file-missing', survivalPct: 0 };
	}

	for (const line of fn.net.keys()) {
		const inWorkingTree = snapshot.workingTree.has(line);
		const inHead = snapshot.head?.has(line) ?? false;
		if (inWorkingTree && inHead) base.committed++;
		else if (inWorkingTree) base.uncommitted++;
		else {
			// Absent from the working tree: gone, even if HEAD still has it
			// (that just means the deletion is not committed yet).
			base.gone++;
			if (base.sampleGone.length < 3) base.sampleGone.push(line);
		}
	}

	const present = base.committed + base.uncommitted;
	const survivalPct = Math.round((present / agentLines) * 100);
	let status: FileSurvivalStatus;
	if (survivalPct >= 95) status = 'kept';
	else if (survivalPct >= 70) status = 'mostly-kept';
	else if (present > 0) status = 'reworked';
	else status = 'discarded';

	return { ...base, status, survivalPct };
}

export function summarize(
	repoRoot: string,
	headHash: string,
	files: FileSurvival[],
	skipped: { outsideRepo: number; unmeasurable: number }
): SessionSurvival {
	const measured = files.filter((f) => f.status !== 'unmeasurable' && f.status !== 'outside-repo');
	const agentLines = measured.reduce((s, f) => s + f.agentLines, 0);
	const committed = measured.reduce((s, f) => s + f.committed, 0);
	const uncommitted = measured.reduce((s, f) => s + f.uncommitted, 0);
	const gone = measured.reduce((s, f) => s + f.gone, 0);
	const selfRevised = files.reduce((s, f) => s + f.selfRevised, 0);
	const survivalPct = agentLines > 0 ? Math.round(((committed + uncommitted) / agentLines) * 100) : 0;
	const committedPct = agentLines > 0 ? Math.round((committed / agentLines) * 100) : 0;

	let verdict: SessionSurvival['verdict'];
	if (agentLines === 0) verdict = 'no-data';
	else if (survivalPct >= 95) verdict = 'kept';
	else if (survivalPct >= 70) verdict = 'mostly-kept';
	else if (survivalPct > 0) verdict = 'reworked';
	else verdict = 'discarded';

	// Worst files first: the UI wants to show what was thrown away.
	const sorted = [...files].sort((a, b) => {
		const rank = (f: FileSurvival) =>
			f.status === 'unmeasurable' || f.status === 'outside-repo' ? 2 : 0;
		return rank(a) - rank(b) || a.survivalPct - b.survivalPct || b.agentLines - a.agentLines;
	});

	return {
		repoRoot,
		headHash,
		measuredAt: new Date().toISOString(),
		files: sorted,
		filesSkipped: skipped,
		agentLines,
		committed,
		uncommitted,
		gone,
		selfRevised,
		survivalPct,
		committedPct,
		verdict
	};
}

// ---------------------------------------------------------------------------
// Git I/O
// ---------------------------------------------------------------------------

export interface RepoReader {
	head(repoRoot: string): Promise<string | null>;
	showHead(repoRoot: string, relPath: string): Promise<string | null>;
	readWorkingTree(repoRoot: string, relPath: string): Promise<string | null>;
}

async function git(repoRoot: string, args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('git', args, {
			cwd: repoRoot,
			timeout: 5000,
			maxBuffer: 16 * 1024 * 1024
		});
		return stdout;
	} catch {
		return null;
	}
}

export const gitRepoReader: RepoReader = {
	async head(repoRoot) {
		const out = await git(repoRoot, ['rev-parse', 'HEAD']);
		return out ? out.trim() : null;
	},
	async showHead(repoRoot, relPath) {
		return git(repoRoot, ['show', `HEAD:${relPath}`]);
	},
	async readWorkingTree(repoRoot, relPath) {
		try {
			return await readFile(join(repoRoot, relPath), 'utf-8');
		} catch {
			return null;
		}
	}
};

/**
 * Resolve symlinks so that a repo root reported by git (already canonical) and
 * a file path recorded by the agent compare correctly. Deleted files resolve
 * through their parent directory.
 */
async function canonicalPath(p: string): Promise<string> {
	try {
		return await realpath(p);
	} catch {
		try {
			return join(await realpath(dirname(p)), basename(p));
		} catch {
			return p;
		}
	}
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_VERSION = 1;

/**
 * Measure how much of the agent's code from this session is still in the repo.
 * Returns null when nothing can be measured (no repo, no textual edits).
 */
export async function analyzeCodeSurvival(
	timeline: SessionTimeline,
	reader: RepoReader = gitRepoReader,
	useCache = true
): Promise<SessionSurvival | null> {
	const edits = extractAgentEdits(timeline.events);
	if (edits.length === 0) return null;

	const projectPath = timeline.summary.cwd || timeline.summary.project;
	if (!projectPath) return null;
	const repoRoot = await findGitDir(projectPath);
	if (!repoRoot) return null;

	const headHash = (await reader.head(repoRoot)) || 'no-head';
	const cacheKey = `survival:v${CACHE_VERSION}:${timeline.summary.sessionId}:${headHash}`;
	if (useCache) {
		const cached = getCachedAnalysis(cacheKey);
		if (cached) {
			try {
				return JSON.parse(cached) as SessionSurvival;
			} catch {
				// fall through and recompute
			}
		}
	}

	const nets = computeFileNets(edits);
	const files: FileSurvival[] = [];
	const skipped = { outsideRepo: 0, unmeasurable: 0 };
	const canonicalRoot = await canonicalPath(repoRoot);

	for (const fn of nets.values()) {
		const abs = await canonicalPath(isAbsolute(fn.filePath) ? fn.filePath : join(repoRoot, fn.filePath));
		const rel = relative(canonicalRoot, abs);
		if (rel.startsWith('..') || isAbsolute(rel)) {
			skipped.outsideRepo++;
			files.push({
				path: fn.filePath,
				relPath: rel,
				status: 'outside-repo',
				editCount: fn.editCount,
				agentLines: fn.net.size,
				committed: 0,
				uncommitted: 0,
				gone: 0,
				selfRevised: fn.selfRevised,
				survivalPct: 0,
				sampleGone: [],
				eventIds: fn.eventIds
			});
			continue;
		}
		if (fn.net.size === 0) {
			skipped.unmeasurable++;
			files.push(classifyFile(fn, rel, { head: null, workingTree: null }));
			continue;
		}

		const [headText, wtText] = await Promise.all([
			reader.showHead(repoRoot, rel),
			reader.readWorkingTree(repoRoot, rel)
		]);
		files.push(
			classifyFile(fn, rel, {
				head: headText === null ? null : significantLines(headText),
				workingTree: wtText === null ? null : significantLines(wtText)
			})
		);
	}

	const result = summarize(repoRoot, headHash, files, skipped);
	if (useCache) {
		try {
			setCachedAnalysis(cacheKey, JSON.stringify(result), CACHE_TTL_MS);
		} catch {
			// cache is best-effort
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Cross-session aggregate for the dashboard
// ---------------------------------------------------------------------------

export interface SurvivalAggregate {
	sessionsMeasured: number;
	sessionsWithoutData: number;
	agentLines: number;
	committed: number;
	uncommitted: number;
	gone: number;
	selfRevised: number;
	survivalPct: number;
	committedPct: number;
	byProject: Array<{
		project: string;
		sessions: number;
		agentLines: number;
		survivalPct: number;
	}>;
	/** Sessions whose code was mostly thrown away — worth a post-mortem. */
	lowestSessions: Array<{
		sessionId: string;
		slug: string;
		project: string;
		startedAt: string;
		agentLines: number;
		survivalPct: number;
	}>;
}

export function aggregateSurvival(
	entries: Array<{
		sessionId: string;
		slug: string;
		project: string;
		startedAt: string;
		survival: SessionSurvival | null;
	}>
): SurvivalAggregate {
	const measured = entries.filter(
		(e): e is typeof e & { survival: SessionSurvival } =>
			e.survival !== null && e.survival.agentLines > 0
	);
	const sum = (k: 'agentLines' | 'committed' | 'uncommitted' | 'gone' | 'selfRevised') =>
		measured.reduce((s, e) => s + e.survival[k], 0);
	const agentLines = sum('agentLines');
	const committed = sum('committed');
	const uncommitted = sum('uncommitted');

	const projMap = new Map<string, { sessions: number; agentLines: number; present: number }>();
	for (const e of measured) {
		const p = projMap.get(e.project) || { sessions: 0, agentLines: 0, present: 0 };
		p.sessions++;
		p.agentLines += e.survival.agentLines;
		p.present += e.survival.committed + e.survival.uncommitted;
		projMap.set(e.project, p);
	}

	return {
		sessionsMeasured: measured.length,
		sessionsWithoutData: entries.length - measured.length,
		agentLines,
		committed,
		uncommitted,
		gone: sum('gone'),
		selfRevised: sum('selfRevised'),
		survivalPct: agentLines > 0 ? Math.round(((committed + uncommitted) / agentLines) * 100) : 0,
		committedPct: agentLines > 0 ? Math.round((committed / agentLines) * 100) : 0,
		byProject: [...projMap.entries()]
			.map(([project, p]) => ({
				project,
				sessions: p.sessions,
				agentLines: p.agentLines,
				survivalPct: p.agentLines > 0 ? Math.round((p.present / p.agentLines) * 100) : 0
			}))
			.sort((a, b) => b.agentLines - a.agentLines),
		lowestSessions: measured
			.filter((e) => e.survival.agentLines >= 10)
			.sort((a, b) => a.survival.survivalPct - b.survival.survivalPct)
			.slice(0, 5)
			.map((e) => ({
				sessionId: e.sessionId,
				slug: e.slug,
				project: e.project,
				startedAt: e.startedAt,
				agentLines: e.survival.agentLines,
				survivalPct: e.survival.survivalPct
			}))
	};
}

// ---------------------------------------------------------------------------
// Dashboard entry point
// ---------------------------------------------------------------------------

/** How many recent sessions the dashboard measures. Each one costs a few git calls on first load. */
const AGGREGATE_SESSION_LIMIT = 40;

/**
 * Measure survival across recent Claude Code sessions. Other providers do not
 * expose the edited text, so they cannot be measured and are reported as such.
 */
export async function analyzeSurvivalAcrossSessions(daysBack?: number): Promise<SurvivalAggregate> {
	const { discoverAllSessions } = await import('./providers');
	const { parseSession } = await import('./parser');

	const { sessions } = await discoverAllSessions();
	const cutoff = daysBack ? Date.now() - daysBack * 86400000 : 0;
	const candidates = sessions
		.filter((s) => s.provider === 'claude-code' && new Date(s.startedAt).getTime() >= cutoff)
		.slice(0, AGGREGATE_SESSION_LIMIT);

	const entries = [];
	for (const s of candidates) {
		try {
			const timeline = await parseSession(s.filePath, s.sessionId, s.project);
			const survival = await analyzeCodeSurvival(timeline);
			entries.push({ sessionId: s.sessionId, slug: s.slug, project: s.project, startedAt: s.startedAt, survival });
		} catch {
			entries.push({ sessionId: s.sessionId, slug: s.slug, project: s.project, startedAt: s.startedAt, survival: null });
		}
	}
	return aggregateSurvival(entries);
}
