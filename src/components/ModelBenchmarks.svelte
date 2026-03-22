<script lang="ts">
	import type { ModelBenchmark } from '$lib/server/codebase-analysis';
	import { formatCost } from '$lib/utils/format';

	let { benchmarks }: { benchmarks: ModelBenchmark[] } = $props();

	function modelColor(model: string): { border: string; bg: string; text: string; dot: string } {
		const m = model.toLowerCase();
		if (m.includes('opus')) return { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-400', dot: 'bg-amber-400' };
		if (m.includes('sonnet')) return { border: 'border-blue-500/30', bg: 'bg-blue-500/5', text: 'text-blue-400', dot: 'bg-blue-400' };
		if (m.includes('haiku')) return { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-400', dot: 'bg-emerald-400' };
		return { border: 'border-surface-700', bg: 'bg-surface-900', text: 'text-surface-300', dot: 'bg-surface-400' };
	}

	function formatDurationShort(ms: number): string {
		if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
		const mins = Math.round(ms / 60_000);
		if (mins < 60) return `${mins}m`;
		const hrs = Math.floor(mins / 60);
		return `${hrs}h ${mins % 60}m`;
	}

	function successColor(rate: number): string {
		if (rate >= 80) return 'text-emerald-400';
		if (rate >= 50) return 'text-amber-400';
		return 'text-red-400';
	}

	function errorColor(rate: number): string {
		if (rate === 0) return 'text-emerald-400';
		if (rate < 10) return 'text-amber-400';
		return 'text-red-400';
	}
</script>

<div class="mb-6">
	<div class="text-xs text-surface-400 font-medium mb-3">Model comparison</div>
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
		{#each benchmarks as bm (bm.model)}
			{@const colors = modelColor(bm.model)}
			<div class="border rounded-lg px-4 py-4 {colors.border} {colors.bg}">
				<!-- Header -->
				<div class="flex items-center justify-between mb-4">
					<div class="flex items-center gap-2">
						<span class="w-2 h-2 rounded-full {colors.dot}"></span>
						<span class="text-sm font-semibold {colors.text}">{bm.model}</span>
					</div>
					<span class="text-[10px] text-surface-500 tabular-nums">{bm.sessionCount} session{bm.sessionCount !== 1 ? 's' : ''}</span>
				</div>

				<!-- Stats grid -->
				<div class="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs mb-4">
					<div class="flex justify-between">
						<span class="text-surface-500">Avg cost</span>
						<span class="text-emerald-400 tabular-nums font-medium">{formatCost(bm.avgCost)}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-surface-500">Total</span>
						<span class="text-surface-300 tabular-nums">{formatCost(bm.totalCost)}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-surface-500">Success</span>
						<span class="{successColor(bm.successRate)} tabular-nums font-medium">{bm.successRate}%</span>
					</div>
					<div class="flex justify-between">
						<span class="text-surface-500">Error rate</span>
						<span class="{errorColor(bm.avgErrorRate)} tabular-nums">{bm.avgErrorRate}%</span>
					</div>
					<div class="flex justify-between">
						<span class="text-surface-500">Loops/sess</span>
						<span class="tabular-nums {bm.avgLoopRate > 0 ? 'text-red-400' : 'text-surface-400'}">{bm.avgLoopRate}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-surface-500">Duration</span>
						<span class="text-surface-300 tabular-nums">{formatDurationShort(bm.avgDuration)}</span>
					</div>
					<div class="flex justify-between">
						<span class="text-surface-500">Tool calls</span>
						<span class="text-surface-300 tabular-nums">{bm.avgToolCalls}/sess</span>
					</div>
					<div class="flex justify-between">
						<span class="text-surface-500">Efficiency</span>
						<span class="text-surface-300 tabular-nums">{bm.costEfficiency}</span>
					</div>
				</div>

				<!-- Recommendation -->
				{#if bm.recommendation}
					<div class="border-t border-surface-800/50 pt-2.5">
						<p class="text-[11px] text-surface-400">{bm.recommendation}</p>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
