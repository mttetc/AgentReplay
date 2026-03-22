<script lang="ts">
	import type { ToolStat } from '$lib/server/codebase-analysis';

	let { tools }: { tools: ToolStat[] } = $props();

	let maxCalls = $derived(Math.max(...tools.map(t => t.callCount), 1));

	function errorRateColor(rate: number): string {
		if (rate === 0) return 'text-emerald-400';
		if (rate < 20) return 'text-amber-400';
		return 'text-red-400';
	}
</script>

{#if tools.length > 0}
	<div class="mb-6">
		<div class="text-xs text-surface-400 font-medium mb-3">Tool usage</div>
		<div class="bg-surface-900 border border-surface-800 rounded-lg overflow-hidden">
			<!-- Header -->
			<div class="grid grid-cols-[1fr_4rem_4rem_5rem_4rem] sm:grid-cols-[1fr_5rem_5rem_5.5rem_6rem] gap-0 px-4 py-2 border-b border-surface-800 text-[10px] text-surface-500 uppercase tracking-wider">
				<span>Tool</span>
				<span class="text-right">Calls</span>
				<span class="text-right">Errors</span>
				<span class="text-right">Err %</span>
				<span class="text-right hidden sm:block">Avg tok</span>
			</div>

			{#each tools as tool (tool.toolName)}
				<div class="grid grid-cols-[1fr_4rem_4rem_5rem_4rem] sm:grid-cols-[1fr_5rem_5rem_5.5rem_6rem] gap-0 px-4 py-2.5 border-b border-surface-800/30 text-xs items-center">
					<!-- Tool name with bar -->
					<div class="flex items-center gap-2 min-w-0">
						<span class="text-surface-200 font-mono text-sm truncate flex-shrink-0">{tool.toolName}</span>
						<div class="flex-1 h-1.5 bg-surface-800 rounded-full overflow-hidden hidden sm:block">
							<div
								class="h-full bg-blue-500/40 rounded-full"
								style="width: {(tool.callCount / maxCalls) * 100}%"
							></div>
						</div>
					</div>

					<span class="text-right text-surface-300 tabular-nums">{tool.callCount}</span>

					<span class="text-right tabular-nums {tool.errorCount > 0 ? 'text-amber-400' : 'text-surface-500'}">
						{tool.errorCount}
					</span>

					<span class="text-right tabular-nums {errorRateColor(tool.errorRate)}">
						{tool.errorRate}%
					</span>

					<span class="text-right tabular-nums text-surface-500 hidden sm:block">
						{tool.avgTokensPerCall > 0 ? tool.avgTokensPerCall.toLocaleString() : '\u2014'}
					</span>
				</div>
			{/each}
		</div>
	</div>
{/if}
