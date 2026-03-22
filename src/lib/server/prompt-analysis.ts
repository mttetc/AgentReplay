import type { TimelineEvent } from '$lib/types/timeline';

export interface PromptPattern {
	pattern: string;
	title: string;
	description: string;
	suggestion: string;
	severity: 'info' | 'warning' | 'critical';
	occurrences: number;
	examples: string[];
	impactEstimate: string;
}

export function analyzePrompts(
	sessionsData: Array<{
		events: TimelineEvent[];
		sessionId: string;
		cost: number;
		errorCount: number;
	}>
): PromptPattern[] {
	const patterns: PromptPattern[] = [];

	const vagueSessions: Array<{ prompt: string; sessionId: string; cost: number }> = [];
	const retryingSessions: Array<{ prompt: string; sessionId: string; cost: number }> = [];
	const noContextSessions: Array<{ prompt: string; sessionId: string; cost: number }> = [];
	const longPromptSessions: Array<{ prompt: string; sessionId: string; cost: number }> = [];
	const multiTaskSessions: Array<{
		prompt: string;
		sessionId: string;
		cost: number;
		errorCount: number;
	}> = [];

	for (const session of sessionsData) {
		const userMessages = session.events
			.filter((e) => e.data.eventType === 'user_message')
			.map((e) => (e.data.eventType === 'user_message' ? e.data.text : ''));

		if (userMessages.length === 0) continue;

		const firstPrompt = userMessages[0];

		// 1. Vague request: first prompt is very short (<30 chars) or has no specific nouns
		if (
			firstPrompt.length < 30 &&
			!firstPrompt.match(
				/\b(file|function|class|component|test|bug|error|api|page|route)\b/i
			)
		) {
			vagueSessions.push({
				prompt: firstPrompt,
				sessionId: session.sessionId,
				cost: session.cost
			});
		}

		// 2. Retry same request: user sends very similar messages multiple times
		for (let i = 1; i < userMessages.length; i++) {
			const prev = userMessages[i - 1].toLowerCase().trim();
			const curr = userMessages[i].toLowerCase().trim();
			if (prev.length > 10 && curr.length > 10) {
				const prevWords = new Set(prev.split(/\s+/));
				const currWords = new Set(curr.split(/\s+/));
				const shared = [...prevWords].filter((w) => currWords.has(w)).length;
				const similarity = shared / Math.max(prevWords.size, currWords.size);
				if (similarity > 0.7) {
					retryingSessions.push({
						prompt: curr,
						sessionId: session.sessionId,
						cost: session.cost
					});
					break;
				}
			}
		}

		// 3. No file/context reference: first prompt doesn't mention any file or path
		if (
			firstPrompt.length > 50 &&
			!firstPrompt.match(
				/\.(ts|js|py|rs|go|svelte|vue|jsx|tsx|css|html|json|yaml|md|sh)\b/
			) &&
			!firstPrompt.match(/\//)
		) {
			noContextSessions.push({
				prompt: firstPrompt,
				sessionId: session.sessionId,
				cost: session.cost
			});
		}

		// 4. Overly long first prompt (>2000 chars) - agent may get confused
		if (firstPrompt.length > 2000) {
			longPromptSessions.push({
				prompt: firstPrompt,
				sessionId: session.sessionId,
				cost: session.cost
			});
		}

		// 5. Multi-task in one prompt: contains "and also", "plus also", "additionally", or numbered list
		if (
			firstPrompt.match(/\b(and also|plus also|additionally|furthermore)\b/i) ||
			firstPrompt.match(/^\s*\d+[.)]/m)
		) {
			if (session.errorCount > 0) {
				multiTaskSessions.push({
					prompt: firstPrompt,
					sessionId: session.sessionId,
					cost: session.cost,
					errorCount: session.errorCount
				});
			}
		}
	}

	// Build patterns from detected issues
	if (vagueSessions.length >= 2) {
		const totalWaste = vagueSessions.reduce((s, v) => s + v.cost, 0);
		patterns.push({
			pattern: 'vague-request',
			title: 'Vague initial prompts',
			description: `${vagueSessions.length} sessions started with very short, unspecific prompts. The agent spends extra tokens exploring and figuring out what you want.`,
			suggestion:
				'Be specific in your first message. Include the file path, function name, or exact behavior you want. Example: "Fix the login validation in src/auth.ts -- it accepts empty passwords" instead of "fix the login".',
			severity: vagueSessions.length >= 5 ? 'critical' : 'warning',
			occurrences: vagueSessions.length,
			examples: vagueSessions.slice(0, 2).map((v) => v.prompt.slice(0, 100)),
			impactEstimate: `~$${totalWaste.toFixed(2)} in extra exploration across ${vagueSessions.length} sessions`
		});
	}

	if (retryingSessions.length >= 2) {
		const totalWaste = retryingSessions.reduce((s, v) => s + v.cost, 0);
		patterns.push({
			pattern: 'retry-same-prompt',
			title: 'Repeated similar prompts',
			description: `${retryingSessions.length} sessions had you re-sending very similar messages. This usually means the agent didn't understand the first time.`,
			suggestion:
				'When the agent misunderstands, don\'t repeat -- rephrase. Add context about what went wrong: "That\'s not what I meant. I want X, not Y. The file is at Z."',
			severity: retryingSessions.length >= 4 ? 'critical' : 'warning',
			occurrences: retryingSessions.length,
			examples: retryingSessions.slice(0, 2).map((v) => v.prompt.slice(0, 100)),
			impactEstimate: `~$${totalWaste.toFixed(2)} in repeated work across ${retryingSessions.length} sessions`
		});
	}

	if (noContextSessions.length >= 3) {
		const totalCost = noContextSessions.reduce((s, v) => s + v.cost, 0);
		patterns.push({
			pattern: 'no-file-context',
			title: 'Prompts without file references',
			description: `${noContextSessions.length} sessions started without mentioning specific files or paths. The agent has to search the codebase first, which costs tokens.`,
			suggestion:
				'Reference specific files in your prompt. The agent works much faster when it knows where to look. Use "in src/components/Auth.svelte" or "the function handleLogin in auth.ts".',
			severity: 'info',
			occurrences: noContextSessions.length,
			examples: noContextSessions.slice(0, 2).map((v) => v.prompt.slice(0, 100)),
			impactEstimate: `~$${(totalCost * 0.15).toFixed(2)} estimated in extra search across ${noContextSessions.length} sessions`
		});
	}

	if (longPromptSessions.length >= 2) {
		patterns.push({
			pattern: 'overly-long-prompt',
			title: 'Very long initial prompts',
			description: `${longPromptSessions.length} sessions started with prompts over 2000 characters. Long prompts can confuse the agent about priorities.`,
			suggestion:
				'Break complex tasks into smaller, focused prompts. Start with the most important change, then iterate. The agent handles incremental work better than massive specs.',
			severity: 'info',
			occurrences: longPromptSessions.length,
			examples: longPromptSessions.slice(0, 2).map((v) => v.prompt.slice(0, 100) + '...'),
			impactEstimate: `${longPromptSessions.length} sessions with potential focus issues`
		});
	}

	if (multiTaskSessions.length >= 2) {
		const totalErrors = multiTaskSessions.reduce((s, v) => s + v.errorCount, 0);
		patterns.push({
			pattern: 'multi-task-prompt',
			title: 'Multiple tasks in one prompt',
			description: `${multiTaskSessions.length} sessions combined multiple tasks in one prompt and had errors. Agents handle one task at a time better.`,
			suggestion:
				'One prompt, one task. Instead of "add auth AND update the API AND write tests", do them in separate messages. You can reference the previous work.',
			severity: 'warning',
			occurrences: multiTaskSessions.length,
			examples: multiTaskSessions.slice(0, 2).map((v) => v.prompt.slice(0, 100)),
			impactEstimate: `${totalErrors} errors across ${multiTaskSessions.length} multi-task sessions`
		});
	}

	// Sort by severity then occurrences
	const severityOrder = { critical: 0, warning: 1, info: 2 };
	patterns.sort(
		(a, b) => severityOrder[a.severity] - severityOrder[b.severity] || b.occurrences - a.occurrences
	);

	return patterns;
}
