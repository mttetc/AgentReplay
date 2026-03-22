import { discoverAllSessions } from './providers';
import { parseSession } from './parser';
import { parseSessionByProvider } from './providers';
import type { ProviderType } from './providers/types';
import type { TimelineEvent, ToolCallEvent } from '$lib/types/timeline';
import { shortPath, shortModel } from '$lib/utils/format';
import { analyzePrompts, type PromptPattern } from './prompt-analysis';

function formatCostRaw(cost: number): string {
	if (cost < 0.01) return '<$0.01';
	return `$${cost.toFixed(2)}`;
}

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

export interface TrendDataPoint {
	date: string;
	cost: number;
	errors: number;
	sessions: number;
	loops: number;
}

export interface Insights {
	/** Most expensive single session */
	costliestSession: { slug: string; sessionId: string; project: string; cost: number } | null;
	/** File with highest difficulty score */
	hardestFile: { path: string; difficultyScore: number; recommendation: string } | null;
	/** Cost trend: up, down, flat */
	costTrend: { direction: 'up' | 'down' | 'flat'; pctChange: number };
	/** One-liner headline */
	headline: string;
	/** Average cost per session */
	avgCostPerSession: number;
	/** Average errors per session */
	avgErrorsPerSession: number;
}

export interface ModelBenchmark {
	model: string;
	modelId: string;
	sessionCount: number;
	avgCost: number;
	totalCost: number;
	avgErrorRate: number;
	avgLoopRate: number;
	avgDuration: number;
	avgToolCalls: number;
	successRate: number;
	avgTokensPerSession: number;
	/** Cost efficiency: lower = better value. (avgCost / successRate) * 100 */
	costEfficiency: number;
	recommendation: string;
}

export interface ToolStat {
	toolName: string;
	callCount: number;
	errorCount: number;
	errorRate: number; // 0-100
	avgTokensPerCall: number; // 0 if no token data
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
	/** Daily trend data for charts */
	trends: TrendDataPoint[];
	/** Top-level insights for onboarding wow moment */
	insights: Insights;
	/** Per-tool usage statistics */
	toolStats: ToolStat[];
	/** Per-model benchmarks for comparison */
	modelBenchmarks: ModelBenchmark[];
	/** Prompt pattern analysis — actionable suggestions for better prompts */
	promptPatterns: PromptPattern[];
}

const analysisCache = new Map<string, { data: CodebaseAnalysis; timestamp: number }>();
const ANALYSIS_CACHE_TTL = 120_000;

export async function analyzeCodebase(daysBack?: number): Promise<CodebaseAnalysis> {
	const cacheKey = String(daysBack ?? 'all');
	const cached = analysisCache.get(cacheKey);
	if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
		return cached.data;
	}

	const { sessions: allSessions } = await discoverAllSessions();
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
	const toolStatsMap = new Map<string, { calls: number; errors: number; totalTokens: number }>();
	const promptAnalysisData: Array<{ events: TimelineEvent[]; sessionId: string; cost: number; errorCount: number }> = [];
	const modelSessionData: Array<{
		model: string;
		cost: number;
		errors: number;
		loops: number;
		duration: number;
		toolCalls: number;
		tokens: number;
	}> = [];

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
			promptAnalysisData.push({ events, sessionId: session.sessionId, cost: session.estimatedCost, errorCount: session.errorCount });
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
		let sessionErrorCount = 0;
		let sessionLoopCount = 0;
		let sessionToolCallCount = 0;

		// Track operation sequences per file for pattern detection
		for (const event of events) {
			if (event.data.eventType === 'thinking') {
				thinkingChars += (event.data as { thinking: string }).thinking.length;
			}
			if (event.tokens) totalOutputTokens += event.tokens.output;
			if (event.data.eventType !== 'tool_call') continue;

			const tc = event.data as ToolCallEvent;
			sessionToolCallCount++;
			if (tc.result?.isError) sessionErrorCount++;

			// Aggregate per-tool stats across all sessions
			if (!toolStatsMap.has(tc.toolName)) {
				toolStatsMap.set(tc.toolName, { calls: 0, errors: 0, totalTokens: 0 });
			}
			const ts = toolStatsMap.get(tc.toolName)!;
			ts.calls++;
			if (tc.result?.isError) ts.errors++;
			if (event.tokens) ts.totalTokens += event.tokens.input + event.tokens.output;

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
				sessionLoopCount++;
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

		// Track per-session data for model benchmarking
		const duration = new Date(session.lastActiveAt).getTime() - new Date(session.startedAt).getTime();
		modelSessionData.push({
			model: session.model,
			cost: session.estimatedCost,
			errors: sessionErrorCount,
			loops: sessionLoopCount,
			duration: Math.max(0, duration),
			toolCalls: sessionToolCallCount,
			tokens: session.inputTokens + session.outputTokens
		});
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
		const prevSessions = (await discoverAllSessions()).sessions.filter((s) => {
			const d = new Date(s.startedAt);
			return d >= prevCutoff && d < currentCutoff;
		});
		previousPeriodCost = prevSessions.reduce((s, sess) => s + sess.estimatedCost, 0);
	}

	const avgDifficulty = allFiles.length > 0 ? Math.round(allFiles.reduce((s, f) => s + f.difficultyScore, 0) / allFiles.length) : 0;

	// Build daily trend data
	const dailyMap = new Map<string, TrendDataPoint>();
	for (const session of sessionsToAnalyze) {
		const day = session.startedAt.slice(0, 10);
		if (!dailyMap.has(day)) dailyMap.set(day, { date: day, cost: 0, errors: 0, sessions: 0, loops: 0 });
		const dp = dailyMap.get(day)!;
		dp.cost += session.estimatedCost;
		dp.sessions++;
	}
	// Merge error/loop data from weekly tracking
	for (const [, wk] of weeklyMap) {
		// Distribute weekly errors/loops to their days (approximation)
		const day = wk.week;
		if (dailyMap.has(day)) {
			dailyMap.get(day)!.errors += wk.errors;
			dailyMap.get(day)!.loops += wk.loops;
		}
	}
	const trends = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

	// Build insights
	const costliestSession = sessionsToAnalyze.length > 0
		? sessionsToAnalyze.reduce((max, s) => s.estimatedCost > max.estimatedCost ? s : max, sessionsToAnalyze[0])
		: null;

	const sortedFiles = [...allFiles].sort((a, b) => b.difficultyScore - a.difficultyScore);
	const hardestFile = sortedFiles.length > 0 ? sortedFiles[0] : null;

	const pctChange = previousPeriodCost > 0
		? ((totalCost - previousPeriodCost) / previousPeriodCost) * 100
		: 0;
	const costTrend = {
		direction: (Math.abs(pctChange) < 5 ? 'flat' : pctChange > 0 ? 'up' : 'down') as 'up' | 'down' | 'flat',
		pctChange: Math.round(pctChange)
	};

	const avgCostPerSession = sessionsAnalyzed > 0 ? totalCost / sessionsAnalyzed : 0;
	const avgErrorsPerSession = sessionsAnalyzed > 0 ? totalErrors / sessionsAnalyzed : 0;

	// Generate headline
	let headline = '';
	if (sessionsAnalyzed === 0) {
		headline = 'No sessions found. Run some AI coding sessions to see insights.';
	} else if (costTrend.direction === 'up' && Math.abs(costTrend.pctChange) > 20) {
		headline = `Spending is up ${costTrend.pctChange}% vs last period — ${formatCostRaw(totalCost)} across ${sessionsAnalyzed} sessions.`;
	} else if (costTrend.direction === 'down' && Math.abs(costTrend.pctChange) > 20) {
		headline = `Spending is down ${Math.abs(costTrend.pctChange)}% — getting more efficient.`;
	} else if (totalLoops > 3) {
		headline = `${totalLoops} edit loops detected — some files are causing the agent to spin.`;
	} else if (totalErrors > sessionsAnalyzed * 2) {
		headline = `High error rate (${totalErrors} errors across ${sessionsAnalyzed} sessions) — check the patterns below.`;
	} else {
		headline = `${sessionsAnalyzed} sessions analyzed, ${formatCostRaw(totalCost)} spent. ${wastefulSessions.length > 0 ? `${wastefulSessions.length} sessions had waste.` : 'Clean run overall.'}`;
	}

	const insights: Insights = {
		costliestSession: costliestSession ? {
			slug: costliestSession.slug,
			sessionId: costliestSession.sessionId,
			project: costliestSession.project,
			cost: costliestSession.estimatedCost
		} : null,
		hardestFile: hardestFile ? {
			path: hardestFile.path,
			difficultyScore: hardestFile.difficultyScore,
			recommendation: hardestFile.recommendation
		} : null,
		costTrend,
		headline,
		avgCostPerSession,
		avgErrorsPerSession
	};

	// Build per-tool stats sorted by call count descending
	const toolStats: ToolStat[] = [...toolStatsMap.entries()]
		.map(([toolName, s]) => ({
			toolName,
			callCount: s.calls,
			errorCount: s.errors,
			errorRate: s.calls > 0 ? Math.round((s.errors / s.calls) * 100) : 0,
			avgTokensPerCall: s.calls > 0 ? Math.round(s.totalTokens / s.calls) : 0
		}))
		.sort((a, b) => b.callCount - a.callCount);

	const promptPatterns = analyzePrompts(promptAnalysisData);

	// Build model benchmarks from per-session data
	const modelAggMap = new Map<string, {
		modelId: string;
		sessions: number;
		totalCost: number;
		totalErrors: number;
		totalLoops: number;
		totalDuration: number;
		totalToolCalls: number;
		totalTokens: number;
		errorFreeSessions: number;
	}>();

	for (const sd of modelSessionData) {
		const name = shortModel(sd.model);
		if (name === 'Unknown') continue;

		const existing = modelAggMap.get(name) || {
			modelId: sd.model,
			sessions: 0, totalCost: 0, totalErrors: 0, totalLoops: 0,
			totalDuration: 0, totalToolCalls: 0, totalTokens: 0, errorFreeSessions: 0
		};

		existing.sessions++;
		existing.totalCost += sd.cost;
		existing.totalErrors += sd.errors;
		existing.totalLoops += sd.loops;
		existing.totalDuration += sd.duration;
		existing.totalToolCalls += sd.toolCalls;
		existing.totalTokens += sd.tokens;
		if (sd.errors === 0) existing.errorFreeSessions++;

		modelAggMap.set(name, existing);
	}

	const modelBenchmarks: ModelBenchmark[] = [...modelAggMap.entries()]
		.filter(([, d]) => d.sessions >= 1)
		.map(([model, d]) => {
			const mAvgCost = d.totalCost / d.sessions;
			const mAvgErrorRate = d.totalToolCalls > 0
				? (d.totalErrors / d.totalToolCalls) * 100
				: 0;
			const mAvgLoopRate = d.totalLoops / d.sessions;
			const mAvgDuration = d.totalDuration / d.sessions;
			const mAvgToolCalls = d.totalToolCalls / d.sessions;
			const mSuccessRate = (d.errorFreeSessions / d.sessions) * 100;
			const mAvgTokens = d.totalTokens / d.sessions;
			const mCostEff = mSuccessRate > 0
				? (mAvgCost / mSuccessRate) * 100
				: mAvgCost * 100;

			return {
				model,
				modelId: d.modelId,
				sessionCount: d.sessions,
				avgCost: mAvgCost,
				totalCost: d.totalCost,
				avgErrorRate: Math.round(mAvgErrorRate * 10) / 10,
				avgLoopRate: Math.round(mAvgLoopRate * 10) / 10,
				avgDuration: mAvgDuration,
				avgToolCalls: Math.round(mAvgToolCalls),
				successRate: Math.round(mSuccessRate),
				avgTokensPerSession: Math.round(mAvgTokens),
				costEfficiency: Math.round(mCostEff * 100) / 100,
				recommendation: ''
			};
		})
		.sort((a, b) => a.costEfficiency - b.costEfficiency);

	// Generate model recommendations
	if (modelBenchmarks.length > 0) {
		const bestSuccess = Math.max(...modelBenchmarks.map((m) => m.successRate));
		const lowestModelCost = Math.min(...modelBenchmarks.map((m) => m.avgCost));
		const highestModelCost = Math.max(...modelBenchmarks.map((m) => m.avgCost));
		const highestModelErrorRate = Math.max(...modelBenchmarks.map((m) => m.avgErrorRate));

		for (const mb of modelBenchmarks) {
			if (mb.successRate > 90 && mb.avgCost <= lowestModelCost * 1.2) {
				mb.recommendation = 'Best value -- high success, low cost';
			} else if (mb.successRate === bestSuccess && bestSuccess > 0) {
				mb.recommendation = 'Most reliable -- fewest errors';
			} else if (mb.avgCost >= highestModelCost * 0.9 && mb.successRate < bestSuccess * 0.9) {
				mb.recommendation = 'Expensive -- consider downgrading';
			} else if (mb.avgErrorRate >= highestModelErrorRate * 0.9 && highestModelErrorRate > 5) {
				mb.recommendation = 'Error-prone -- may need better prompts';
			} else if (mb.sessionCount < 3) {
				mb.recommendation = 'Limited data -- need more sessions';
			} else {
				mb.recommendation = 'Balanced performance';
			}
		}
	}

	const analysis: CodebaseAnalysis = {
		allFiles: sortedFiles,
		projects,
		hardestFiles: sortedFiles.slice(0, 20),
		wastefulSessions: wastefulSessions.sort((a, b) => b.wastedCost - a.wastedCost).slice(0, 20),
		patterns,
		recentSessions,
		totals: {
			totalFiles: fileMap.size, totalCost, totalErrors, totalLoops,
			estimatedWaste: wastefulSessions.reduce((s, w) => s + w.wastedCost, 0),
			sessionsAnalyzed, avgDifficulty, previousPeriodCost
		},
		trends,
		insights,
		toolStats,
		modelBenchmarks,
		promptPatterns
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
