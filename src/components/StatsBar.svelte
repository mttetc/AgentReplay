<script lang="ts">
	import type { SessionSummary } from '$lib/types/timeline';
	import { formatDurationBetween, formatNumber, formatCost, shortModel } from '$lib/utils/format';

	let { summary }: { summary: SessionSummary } = $props();

	function getModelBarColor(model: string): string {
		if (model.includes('opus')) return 'bg-amber-500';
		if (model.includes('sonnet')) return 'bg-blue-500';
		if (model.includes('haiku')) return 'bg-green-500';
		return 'bg-surface-500';
	}

	function getModelColor(model: string): string {
		if (model.includes('opus')) return 'text-amber-400';
		if (model.includes('sonnet')) return 'text-blue-400';
		if (model.includes('haiku')) return 'text-green-400';
		return 'text-surface-300';
	}

	// Cost bar width relative to max reasonable cost ($10)
	let costBarWidth = $derived(Math.min(100, (summary.estimatedCost / 10) * 100));
</script>

<div class="stats-bar-container" style="container-type: inline-size;">
	<div class="stats-bar flex items-center gap-4 text-xs text-surface-400 flex-wrap">
		<!-- Model with colored bar -->
		<div class="flex items-center gap-2">
			<div class="w-2 h-2 rounded-full {getModelBarColor(summary.model)}"></div>
			<span class="{getModelColor(summary.model)} font-medium">{shortModel(summary.model)}</span>
		</div>
		<span class="stats-sep text-surface-800">|</span>
		<div class="flex items-center gap-1.5">
			<span class="text-surface-200">{formatDurationBetween(summary.startedAt, summary.lastActiveAt)}</span>
		</div>
		<span class="stats-sep text-surface-800">|</span>
		<div class="flex items-center gap-1.5">
			<span class="text-cyan-400">{summary.toolCallCount}</span>
			<span class="text-surface-500">tools</span>
		</div>
		<span class="stats-sep text-surface-800">|</span>
		<div class="flex items-center gap-1.5">
			<span class="text-amber-400">{formatNumber(summary.inputTokens)}</span>
			<span class="text-surface-600">in</span>
			<span class="text-blue-400">{formatNumber(summary.outputTokens)}</span>
			<span class="text-surface-600">out</span>
		</div>
		<span class="stats-sep text-surface-800">|</span>
		<!-- Cost with mini bar -->
		<div class="flex items-center gap-2" title="Estimated API cost">
			<div class="w-16 h-1 bg-surface-800 rounded-full overflow-hidden">
				<div class="h-full rounded-full {getModelBarColor(summary.model)}" style="width: {costBarWidth}%"></div>
			</div>
			<span class="text-surface-200 font-medium">{formatCost(summary.estimatedCost)}</span>
		</div>
	</div>
</div>

<style>
	@container (max-width: 480px) {
		.stats-bar {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 0.375rem 0.75rem;
		}
		.stats-sep {
			display: none;
		}
	}
</style>
