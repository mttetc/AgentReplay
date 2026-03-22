<script lang="ts">
	import { formatCost } from '$lib/utils/format';
	import type { CodebaseAnalysis } from '$lib/server/codebase-analysis';
	import TrendChart from './TrendChart.svelte';

	let { analysis }: { analysis: CodebaseAnalysis } = $props();

	function difficultyColor(score: number): string {
		return score >= 60 ? 'text-red-400' : score >= 30 ? 'text-amber-400' : 'text-surface-400';
	}

	function trendArrow(dir: string): string {
		return dir === 'up' ? '\u2191' : dir === 'down' ? '\u2193' : '\u2192';
	}

	function trendColor(dir: string): string {
		return dir === 'up' ? 'text-red-400' : dir === 'down' ? 'text-emerald-400' : 'text-surface-400';
	}

	let costChartLabels = $derived(analysis.trends.map(t => t.date.slice(5)));

	let costChartDatasets = $derived([{
		label: 'Cost ($)',
		data: analysis.trends.map(t => +t.cost.toFixed(2)),
		borderColor: '#34d399',
		backgroundColor: 'rgba(52, 211, 153, 0.1)',
		fill: true,
		borderWidth: 2
	}]);

	let activityChartDatasets = $derived([
		{
			label: 'Sessions',
			data: analysis.trends.map(t => t.sessions),
			borderColor: '#60a5fa',
			backgroundColor: 'rgba(96, 165, 250, 0.1)',
			fill: true,
			borderWidth: 2
		},
		{
			label: 'Errors',
			data: analysis.trends.map(t => t.errors),
			borderColor: '#f87171',
			borderWidth: 1.5,
			fill: false
		}
	]);
</script>

<div class="mb-6">
	<!-- Headline -->
	<p class="text-surface-300 text-sm mb-4">{analysis.insights.headline}</p>

	<!-- Stat cards -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-3">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Sessions</div>
			<div class="text-xl font-bold text-surface-100">{analysis.totals.sessionsAnalyzed}</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-3">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Total cost</div>
			<div class="text-xl font-bold text-emerald-400">{formatCost(analysis.totals.totalCost)}</div>
			{#if analysis.insights.costTrend.direction !== 'flat'}
				<div class="text-[10px] {trendColor(analysis.insights.costTrend.direction)}">
					{trendArrow(analysis.insights.costTrend.direction)} {Math.abs(analysis.insights.costTrend.pctChange)}% vs prev
				</div>
			{/if}
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-3">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Avg/session</div>
			<div class="text-xl font-bold text-surface-200">{formatCost(analysis.insights.avgCostPerSession)}</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-3">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Errors</div>
			<div class="text-xl font-bold {analysis.totals.totalErrors > 0 ? 'text-amber-400' : 'text-surface-200'}">{analysis.totals.totalErrors}</div>
			{#if analysis.totals.totalLoops > 0}
				<div class="text-[10px] text-red-400">{analysis.totals.totalLoops} loops</div>
			{/if}
		</div>
	</div>

	<!-- Spotlight cards -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
		{#if analysis.insights.costliestSession}
			<a href="/sessions/{analysis.insights.costliestSession.sessionId}?project={encodeURIComponent(analysis.insights.costliestSession.project)}"
				class="bg-surface-900 border border-surface-800 rounded-lg px-4 py-3 hover:border-surface-600 transition-colors block">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Most expensive session</div>
				<div class="text-surface-200 font-medium text-sm truncate">{analysis.insights.costliestSession.slug || analysis.insights.costliestSession.sessionId.slice(0, 8)}</div>
				<div class="text-emerald-400 text-lg font-bold">{formatCost(analysis.insights.costliestSession.cost)}</div>
			</a>
		{/if}
		{#if analysis.insights.hardestFile}
			<div class="bg-surface-900 border border-surface-800 rounded-lg px-4 py-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Hardest file</div>
				<div class="text-surface-200 font-mono text-sm truncate">{analysis.insights.hardestFile.path.split('/').slice(-2).join('/')}</div>
				<div class="{difficultyColor(analysis.insights.hardestFile.difficultyScore)} text-lg font-bold">Score: {analysis.insights.hardestFile.difficultyScore}</div>
				{#if analysis.insights.hardestFile.recommendation}
					<div class="text-[10px] text-amber-400 mt-1">{analysis.insights.hardestFile.recommendation}</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Trend charts -->
	{#if analysis.trends.length >= 2}
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
			<TrendChart title="Cost over time" labels={costChartLabels} datasets={costChartDatasets} />
			<TrendChart title="Sessions & errors" labels={costChartLabels} datasets={activityChartDatasets} />
		</div>
	{/if}
</div>
