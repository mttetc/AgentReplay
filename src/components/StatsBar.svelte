<script lang="ts">
	import type { SessionSummary } from '$lib/types/timeline';
	import { formatDurationBetween, formatNumber, formatCostWithPlan, shortModel } from '$lib/utils/format';
	import { isIncludedPlan, getPlan, PLAN_LABELS } from '$lib/stores/plan.svelte';

	let { summary }: { summary: SessionSummary } = $props();

	function getModelColor(model: string): string {
		if (model.includes('opus')) return 'text-purple-300';
		if (model.includes('sonnet')) return 'text-blue-300';
		if (model.includes('haiku')) return 'text-green-300';
		return 'text-surface-200';
	}

</script>

<div class="stats-bar-container" style="container-type: inline-size;">
	<div class="stats-bar flex items-center gap-4 text-xs text-surface-400 flex-wrap">
		<div class="flex items-center gap-1.5">
			<span class="text-surface-500">Model</span>
			<span class="{getModelColor(summary.model)}">{shortModel(summary.model)}</span>
		</div>
		<span class="stats-sep text-surface-700">|</span>
		<div class="flex items-center gap-1.5">
			<span class="text-surface-500">Duration</span>
			<span class="text-surface-200">{formatDurationBetween(summary.startedAt, summary.lastActiveAt)}</span>
		</div>
		<span class="stats-sep text-surface-700">|</span>
		<div class="flex items-center gap-1.5">
			<span class="text-surface-500">Tools</span>
			<span class="text-cyan-300">{summary.toolCallCount}</span>
		</div>
		<span class="stats-sep text-surface-700">|</span>
		<div class="flex items-center gap-1.5">
			<span class="text-surface-500">Tokens</span>
			<span><span class="text-amber-300">{formatNumber(summary.inputTokens)} in</span> / <span class="text-blue-300">{formatNumber(summary.outputTokens)} out</span></span>
		</div>
		<span class="stats-sep text-surface-700">|</span>
		<div
			class="flex items-center gap-1.5"
			title={isIncludedPlan() ? `Estimated API cost — included in your ${PLAN_LABELS[getPlan()]} subscription` : 'Estimated API cost'}
		>
			<span class="text-surface-500">Cost</span>
			<span class="{isIncludedPlan() ? 'text-surface-500' : 'text-emerald-300'}">{formatCostWithPlan(summary.estimatedCost, isIncludedPlan())}</span>
			{#if isIncludedPlan()}<span class="text-[10px] text-surface-600">included</span>{/if}
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
