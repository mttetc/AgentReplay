import { discoverAllSessions } from './providers';
import { parseSession } from './parser';
import { parseSessionByProvider } from './providers';
import type { ProviderType } from './providers/types';
import type { TimelineEvent, ToolCallEvent } from '$lib/types/timeline';
import { shortPath } from '$lib/utils/format';

export interface FileInsight {
	path: string;
	shortPath: string;
	totalCost: number;
	sessionCount: number;
	totalOps: number;
	reads: number;
	writes: number;
	edits: number;
	errors: number;
	loopSessions: number;
	avgOpsPerSession: number;
	/** Read:Edit ratio — high = agent is confused, exploring without progress */
	readEditRatio: number;
	/** Composite difficulty score 0-100 */
	difficultyScore: number;
	/** Error rate: errors / totalOps */
	errorRate: number;
	firstSeen: string;
	lastSeen: string;
	/** Which project this file belongs to */
	project: string;
	/** Sessions that touched this file */
	sessions: FileSessionLink[];
	/** Auto-generated recommendation if problematic */
	recommendation: string;
}

export interface SessionWaste {
	sessionId: string;
	slug: string;
	project: string;
	startedAt: string;
	totalCost: number;
	loops: Array<{ file: string; edits: number; estimatedWaste: number }>;
	repeatedErrors: Array<{ tool: string; file: string; count: number }>;
	thinkingRatio: number;
	wastedCost: number;
}

export interface AgentPattern {
	pattern: string;
	description: string;
	recommendation: string;
	count: number;
	files: string[];
	severity: 'info' | 'warning' | 'critical';
}

export interface ProjectInsight {
	project: string;
	sessionCount: number;
	totalCost: number;
	wastedCost: number;
	errorCount: number;
	loopCount: number;
	topFiles: FileInsight[];
	directories: DirectoryInsight[];
}

export interface DirectoryInsight {
	dir: string;
	cost: number;
	fileCount: number;
	errors: number;
	loops: number;
	files: FileInsight[];
}

export interface FileSessionLink {
	sessionId: string;
	slug: string;
	project: string;
	startedAt: string;
	cost: number;
	ops: number;
	errors: number;
}

export interface CodebaseAnalysis {
	/** All files with full insight data */
	allFiles: FileInsight[];
	/** Projects with drill-down data */
	projects: ProjectInsight[];
	hardestFiles: FileInsight[];
	wastefulSessions: SessionWaste[];
	patterns: AgentPattern[];
	/** Recent sessions with verdicts */
	recentSessions: Array<{
		sessionId: string;
		slug: string;
		project: string;
		startedAt: string;
		cost: number;
		errors: number;
		loops: number;
		verdict: 'clean' | 'errors' | 'loops' | 'wasteful';
	}>;
	totals: {
		totalFiles: number;
		totalCost: number;
		totalErrors: number;
		totalLoops: number;
		estimatedWaste: number;
		sessionsAnalyzed: number;
		avgDifficulty: number;
		/** Previous period cost for trend comparison */
		previousPeriodCost: number;
	};
}

const analysisCache = new Map<string, { data: CodebaseAnalysis; timestamp: number }>();
const ANALYSIS_CACHE_TTL = 120_000;

export async function analyzeCodebase(daysBack?: number): Promise<CodebaseAnalysis> {
	const cacheKey = String(daysBack ?? 'all');
	const cached = analysisCache.get(cacheKey);
	if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
		return cached.data;
	}

	const allSessions = await discoverAllSessions();
	const cutoff = daysBack ? new Date(Date.now() - daysBack * 86400000) : null;
	const sessions = cutoff ? allSessions.filter((s) => new Date(s.startedAt) >= cutoff) : allSessions;
	const fileMap = new Map<string, FileInsight>();
	const wastefulSessions: SessionWaste[] = [];
	const patternCounts = new Map<string, { count: number; files: Set<string> }>();
	const weeklyMap = new Map<string, { week: string; cost: number; errors: number; loops: number; sessions: number }>();
	let totalCost = 0;
	let totalErrors = 0;
	let totalLoops = 0;
	let sessionsAnalyzed = 0;

	const sessionsToAnalyze = sessions.slice(0, 100);

	for (const session of sessionsToAnalyze) {
		let events: TimelineEvent[];
		try {
			let timeline;
			if (session.provider === 'claude-code') {
				timeline = await parseSession(session.filePath, session.sessionId, session.project);
			} else if (session.providerMeta) {
				timeline = await parseSessionByProvider(session.sessionId, session.provider as ProviderType, session.providerMeta);
			} else {
				continue;
			}
			events = timeline.events;
			sessionsAnalyzed++;
		} catch {
			continue;
		}

		// Weekly tracking
		const weekStart = new Date(session.startedAt);
		weekStart.setDate(weekStart.getDate() - weekStart.getDay());
		const weekKey = weekStart.toISOString().slice(0, 10);
		if (!weeklyMap.has(weekKey)) weeklyMap.set(weekKey, { week: weekKey, cost: 0, errors: 0, loops: 0, sessions: 0 });
		const wk = weeklyMap.get(weekKey)!;
		wk.cost += session.estimatedCost;
		wk.sessions++;

		const sessionFiles = new Map<string, { reads: number; writes: number; edits: number; errors: number; tokens: number; sequence: string[] }>();
		const sessionErrors = new Map<string, Array<{ tool: string; file: string }>>();
		let thinkingChars = 0;
		let totalOutputTokens = 0;

		// Track operation sequences per file for pattern detection
		for (const event of events) {
			if (event.data.eventType === 'thinking') {
				thinkingChars += (event.data as { thinking: string }).thinking.length;
			}
			if (event.tokens) totalOutputTokens += event.tokens.output;
			if (event.data.eventType !== 'tool_call') continue;

			const tc = event.data as ToolCallEvent;
			const input = tc.input as Record<string, unknown>;
			if (!['Read', 'Write', 'Edit'].includes(tc.toolName)) continue;
			const filePath = (input.file_path as string) || '';
			if (!filePath) continue;

			if (!sessionFiles.has(filePath)) {
				sessionFiles.set(filePath, { reads: 0, writes: 0, edits: 0, errors: 0, tokens: 0, sequence: [] });
			}
			const sf = sessionFiles.get(filePath)!;
			if (tc.toolName === 'Read') { sf.reads++; sf.sequence.push('R'); }
			else if (tc.toolName === 'Write') { sf.writes++; sf.sequence.push('W'); }
			else if (tc.toolName === 'Edit') { sf.edits++; sf.sequence.push('E'); }
			if (tc.result?.isError) {
				sf.errors++;
				sf.sequence.push('!');
				const errorKey = `${tc.toolName}:${filePath}`;
				if (!sessionErrors.has(errorKey)) sessionErrors.set(errorKey, []);
				sessionErrors.get(errorKey)!.push({ tool: tc.toolName, file: filePath });
			}
			if (event.tokens) sf.tokens += event.tokens.input + event.tokens.output;
		}

		const pricing = session.model.includes('opus') ? { i: 15, o: 75 }
			: session.model.includes('haiku') ? { i: 0.8, o: 4 }
			: { i: 3, o: 15 };

		const loops: SessionWaste['loops'] = [];
		const repeatedErrors: SessionWaste['repeatedErrors'] = [];
		let sessionWaste = 0;

		for (const [filePath, sf] of sessionFiles) {
			const editCount = sf.writes + sf.edits;
			const opsCount = sf.reads + sf.writes + sf.edits;
			const costPerOp = sf.tokens > 0
				? (sf.tokens * ((pricing.i + pricing.o) / 2)) / 1_000_000
				: session.estimatedCost / Math.max(1, events.length) * opsCount;

			// Update global map
			if (!fileMap.has(filePath)) {
				const p = filePath.split('/');
				fileMap.set(filePath, {
					path: filePath,
					shortPath: p.slice(-2).join('/'),
					totalCost: 0, sessionCount: 0, totalOps: 0,
					reads: 0, writes: 0, edits: 0, errors: 0,
					loopSessions: 0, avgOpsPerSession: 0,
					readEditRatio: 0, difficultyScore: 0, errorRate: 0,
					firstSeen: session.startedAt, lastSeen: session.startedAt,
					project: session.project, sessions: [], recommendation: ''
				});
			}

			const fi = fileMap.get(filePath)!;
			fi.totalCost += costPerOp;
			fi.sessionCount++;
			fi.totalOps += opsCount;
			fi.reads += sf.reads;
			fi.writes += sf.writes;
			fi.edits += sf.edits;
			fi.errors += sf.errors;
			totalErrors += sf.errors;
			if (session.startedAt < fi.firstSeen) fi.firstSeen = session.startedAt;
			if (session.startedAt > fi.lastSeen) fi.lastSeen = session.startedAt;

			// Track which sessions touched this file
			fi.sessions.push({
				sessionId: session.sessionId,
				slug: session.slug,
				project: session.project,
				startedAt: session.startedAt,
				cost: costPerOp,
				ops: opsCount,
				errors: sf.errors
			});

			// Pattern detection from sequence
			const seq = sf.sequence.join('');
			if (seq.includes('E!E!')) {
				trackPattern(patternCounts, 'edit-fail-retry', filePath);
			}
			if (seq.includes('RRRR')) {
				trackPattern(patternCounts, 'excessive-reads', filePath);
			}
			if (seq.includes('E!E!E!')) {
				trackPattern(patternCounts, 'stuck-loop', filePath);
			}
			if (sf.reads >= 3 && editCount === 0) {
				trackPattern(patternCounts, 'read-only-exploration', filePath);
			}
			if (sf.reads === 0 && editCount >= 2) {
				trackPattern(patternCounts, 'blind-editing', filePath);
			}

			// Loop detection
			if (editCount >= 3) {
				fi.loopSessions++;
				totalLoops++;
				wk.loops++;
				const wastedEdits = editCount - 1;
				const waste = costPerOp * wastedEdits * 0.5;
				loops.push({ file: shortPath(filePath), edits: editCount, estimatedWaste: waste });
				sessionWaste += waste;
			}

			wk.errors += sf.errors;
		}

		for (const [, errors] of sessionErrors) {
			if (errors.length >= 2) {
				repeatedErrors.push({ tool: errors[0].tool, file: shortPath(errors[0].file), count: errors.length });
				sessionWaste += session.estimatedCost / Math.max(1, events.length) * errors.length * 0.5;
			}
		}

		const thinkingTokensEstimate = Math.round(thinkingChars / 4);
		const thinkingRatio = totalOutputTokens > 0 ? thinkingTokensEstimate / totalOutputTokens : 0;
		totalCost += session.estimatedCost;

		if (loops.length > 0 || repeatedErrors.length > 0 || thinkingRatio > 0.5) {
			wastefulSessions.push({
				sessionId: session.sessionId, slug: session.slug, project: session.project,
				startedAt: session.startedAt, totalCost: session.estimatedCost,
				loops, repeatedErrors, thinkingRatio, wastedCost: sessionWaste
			});
		}
	}

	// Compute derived metrics for each file
	const allFiles = [...fileMap.values()];
	const maxCost = Math.max(...allFiles.map((f) => f.totalCost), 0.001);
	const maxErrors = Math.max(...allFiles.map((f) => f.errors), 1);
	const maxLoops = Math.max(...allFiles.map((f) => f.loopSessions), 1);

	for (const fi of allFiles) {
		fi.avgOpsPerSession = fi.sessionCount > 0 ? fi.totalOps / fi.sessionCount : 0;
		fi.readEditRatio = (fi.writes + fi.edits) > 0 ? fi.reads / (fi.writes + fi.edits) : (fi.reads > 0 ? fi.reads : 0);
		fi.errorRate = fi.totalOps > 0 ? fi.errors / fi.totalOps : 0;

		// Difficulty score: weighted composite of cost, errors, loops, read:edit confusion
		const costScore = (fi.totalCost / maxCost) * 30;
		const errorScore = (fi.errors / maxErrors) * 30;
		const loopScore = (fi.loopSessions / maxLoops) * 25;
		const confusionScore = Math.min(fi.readEditRatio / 10, 1) * 15;
		fi.difficultyScore = Math.round(costScore + errorScore + loopScore + confusionScore);
	}

	// Generate per-file recommendations
	for (const fi of allFiles) {
		if (fi.loopSessions > 0 && fi.errors > 0) {
			fi.recommendation = 'Agent loops on edit — add inline comments explaining the structure';
		} else if (fi.loopSessions > 0) {
			fi.recommendation = 'Agent re-edits repeatedly — simplify the file or add CLAUDE.md hints';
		} else if (fi.errorRate > 0.3) {
			fi.recommendation = `${(fi.errorRate * 100).toFixed(0)}% fail rate — check for validation rules the agent misses`;
		} else if (fi.readEditRatio >= 5) {
			fi.recommendation = 'Agent reads many times but barely edits — file may be too complex';
		} else if (fi.readEditRatio >= 3 && fi.reads >= 4) {
			fi.recommendation = 'High read:edit ratio — consider splitting this file';
		}
	}

	// Build patterns
	const patterns: AgentPattern[] = [];
	const patternMeta: Record<string, { desc: string; rec: string; severity: AgentPattern['severity'] }> = {
		'stuck-loop': { desc: 'Agent fails 3+ consecutive edits — completely stuck', severity: 'critical',
			rec: 'Add CLAUDE.md hints or inline comments explaining the expected structure' },
		'edit-fail-retry': { desc: 'Agent edits, fails, retries — wrong approach or syntax', severity: 'warning',
			rec: 'Check for validation rules or syntax constraints the agent doesn\'t know about' },
		'blind-editing': { desc: 'Agent edits without reading first — causes errors', severity: 'warning',
			rec: 'Ensure prompts provide file context, or add a CLAUDE.md rule to read before editing' },
		'excessive-reads': { desc: 'Agent reads the same file 4+ times — confused', severity: 'info',
			rec: 'File may be too large or complex — consider splitting into smaller modules' },
		'read-only-exploration': { desc: 'Agent reads repeatedly but never edits', severity: 'info',
			rec: 'Add task-specific guidance in prompts to help the agent take action' }
	};
	for (const [key, data] of patternCounts) {
		const meta = patternMeta[key];
		if (meta && data.count > 0) {
			patterns.push({
				pattern: key,
				description: meta.desc,
				recommendation: meta.rec,
				count: data.count,
				files: [...data.files].slice(0, 5).map(shortPath),
				severity: meta.severity
			});
		}
	}
	patterns.sort((a, b) => {
		const sev = { critical: 3, warning: 2, info: 1 };
		return sev[b.severity] - sev[a.severity] || b.count - a.count;
	});

	// Build project-level aggregation with directory drill-down
	const projectMap = new Map<string, { sessions: Set<string>; cost: number; waste: number; errors: number; loops: number; files: Map<string, FileInsight> }>();
	for (const fi of allFiles) {
		const proj = fi.project || 'unknown';
		if (!projectMap.has(proj)) projectMap.set(proj, { sessions: new Set(), cost: 0, waste: 0, errors: 0, loops: 0, files: new Map() });
		const p = projectMap.get(proj)!;
		p.cost += fi.totalCost;
		p.errors += fi.errors;
		p.loops += fi.loopSessions;
		p.files.set(fi.path, fi);
		for (const s of fi.sessions) p.sessions.add(s.sessionId);
	}

	// Add waste per project from wasteful sessions
	for (const w of wastefulSessions) {
		const p = projectMap.get(w.project);
		if (p) p.waste += w.wastedCost;
	}

	const projects: ProjectInsight[] = [...projectMap.entries()].map(([project, data]) => {
		const projFiles = [...data.files.values()];
		// Build directories for this project
		const dirMap = new Map<string, FileInsight[]>();
		for (const fi of projFiles) {
			const parts = fi.path.split('/');
			const dir = parts.slice(0, -1).join('/') || '/';
			if (!dirMap.has(dir)) dirMap.set(dir, []);
			dirMap.get(dir)!.push(fi);
		}
		const directories: DirectoryInsight[] = [...dirMap.entries()].map(([dir, files]) => ({
			dir,
			cost: files.reduce((s, f) => s + f.totalCost, 0),
			fileCount: files.length,
			errors: files.reduce((s, f) => s + f.errors, 0),
			loops: files.reduce((s, f) => s + f.loopSessions, 0),
			files: [...files].sort((a, b) => b.difficultyScore - a.difficultyScore)
		})).sort((a, b) => b.cost - a.cost);

		return {
			project,
			sessionCount: data.sessions.size,
			totalCost: data.cost,
			wastedCost: data.waste,
			errorCount: data.errors,
			loopCount: data.loops,
			topFiles: [...projFiles].sort((a, b) => b.difficultyScore - a.difficultyScore).slice(0, 5),
			directories
		};
	}).sort((a, b) => b.totalCost - a.totalCost);

	// Recent sessions with verdicts
	const recentSessions = sessions.slice(0, 8).map((s) => {
		const waste = wastefulSessions.find((w) => w.sessionId === s.sessionId);
		let verdict: 'clean' | 'errors' | 'loops' | 'wasteful' = 'clean';
		if (waste && waste.wastedCost > 0) verdict = 'wasteful';
		else if (waste && waste.loops.length > 0) verdict = 'loops';
		else if (waste && waste.repeatedErrors.length > 0) verdict = 'errors';
		return {
			sessionId: s.sessionId, slug: s.slug, project: s.project,
			startedAt: s.startedAt, cost: s.estimatedCost,
			errors: waste?.repeatedErrors.length || 0,
			loops: waste?.loops.length || 0,
			verdict
		};
	});

	// Previous period cost for trend comparison
	const prevCutoff = daysBack ? new Date(Date.now() - daysBack * 2 * 86400000) : null;
	const currentCutoff = daysBack ? new Date(Date.now() - daysBack * 86400000) : null;
	let previousPeriodCost = 0;
	if (prevCutoff && currentCutoff) {
		const prevSessions = (await discoverAllSessions()).filter((s) => {
			const d = new Date(s.startedAt);
			return d >= prevCutoff && d < currentCutoff;
		});
		previousPeriodCost = prevSessions.reduce((s, sess) => s + sess.estimatedCost, 0);
	}

	const avgDifficulty = allFiles.length > 0 ? Math.round(allFiles.reduce((s, f) => s + f.difficultyScore, 0) / allFiles.length) : 0;

	const analysis: CodebaseAnalysis = {
		allFiles: [...allFiles].sort((a, b) => b.difficultyScore - a.difficultyScore),
		projects,
		hardestFiles: [...allFiles].sort((a, b) => b.difficultyScore - a.difficultyScore).slice(0, 20),
		wastefulSessions: wastefulSessions.sort((a, b) => b.wastedCost - a.wastedCost).slice(0, 20),
		patterns,
		recentSessions,
		totals: {
			totalFiles: fileMap.size, totalCost, totalErrors, totalLoops,
			estimatedWaste: wastefulSessions.reduce((s, w) => s + w.wastedCost, 0),
			sessionsAnalyzed, avgDifficulty, previousPeriodCost
		}
	};

	analysisCache.set(cacheKey, { data: analysis, timestamp: Date.now() });
	return analysis;
}

function trackPattern(map: Map<string, { count: number; files: Set<string> }>, key: string, file: string) {
	if (!map.has(key)) map.set(key, { count: 0, files: new Set() });
	const p = map.get(key)!;
	p.count++;
	p.files.add(file);
}
