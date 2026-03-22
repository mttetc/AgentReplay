<script lang="ts">
	import type { PromptPattern } from '$lib/server/prompt-analysis';

	let { patterns }: { patterns: PromptPattern[] } = $props();
	let expandedPattern: string | null = $state(null);

	function severityColor(severity: PromptPattern['severity']): string {
		if (severity === 'critical') return 'border-red-500/20 bg-red-500/5';
		if (severity === 'warning') return 'border-amber-500/20 bg-amber-500/5';
		return 'border-blue-500/20 bg-blue-500/5';
	}

	function severityBadge(severity: PromptPattern['severity']): string {
		if (severity === 'critical') return 'bg-red-500/15 text-red-400 border-red-500/25';
		if (severity === 'warning') return 'bg-amber-500/10 text-amber-400 border-amber-500/25';
		return 'bg-blue-500/10 text-blue-400 border-blue-500/25';
	}

	function severityLabel(severity: PromptPattern['severity']): string {
		if (severity === 'critical') return 'Critical';
		if (severity === 'warning') return 'Warning';
		return 'Info';
	}

	function toggle(pattern: string) {
		expandedPattern = expandedPattern === pattern ? null : pattern;
	}
</script>

<div class="mb-6">
	<div class="flex items-center gap-2 mb-3">
		<span class="text-xs text-surface-400 font-medium">Prompt patterns</span>
		<span class="text-[10px] text-surface-500">{patterns.length} detected</span>
	</div>
	<div class="space-y-2">
		{#each patterns as p (p.pattern)}
			<button
				onclick={() => toggle(p.pattern)}
				class="w-full text-left border rounded-lg px-4 py-3 transition-all {severityColor(p.severity)} {expandedPattern === p.pattern ? 'ring-1 ring-surface-700' : ''}"
			>
				<div class="flex items-center gap-2 mb-1">
					<span class="border rounded text-[9px] px-1.5 py-0.5 font-medium {severityBadge(p.severity)}">{severityLabel(p.severity)}</span>
					<span class="text-surface-200 text-sm font-medium flex-1">{p.title}</span>
					<span class="text-surface-500 text-xs tabular-nums">{p.occurrences} sessions</span>
				</div>

				<p class="text-surface-400 text-xs leading-relaxed">{p.description}</p>

				{#if expandedPattern === p.pattern}
					<div class="mt-3 bg-surface-900/50 border border-surface-800 rounded-md px-3 py-2.5">
						<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Suggestion</div>
						<p class="text-surface-300 text-xs leading-relaxed">{p.suggestion}</p>
					</div>

					<div class="mt-2 flex items-center gap-2 text-[10px] text-surface-500">
						<span>Impact: {p.impactEstimate}</span>
					</div>

					{#if p.examples.length > 0}
						<div class="mt-2">
							<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Example prompts</div>
							{#each p.examples as example}
								<div class="text-[11px] text-surface-400 font-mono bg-surface-950/50 rounded px-2 py-1.5 mt-1 truncate">"{example}"</div>
							{/each}
						</div>
					{/if}
				{/if}
			</button>
		{/each}
	</div>
</div>
