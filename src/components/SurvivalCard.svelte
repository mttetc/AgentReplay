<script lang="ts">
	import type { SurvivalAggregate } from '$lib/server/code-survival';
	import { formatDate } from '$lib/utils/format';

	let { aggregate }: { aggregate: SurvivalAggregate } = $props();

	function pctClass(p: number): string {
		return p >= 95 ? 'text-emerald-400' : p >= 70 ? 'text-blue-400' : p > 0 ? 'text-amber-400' : 'text-red-400';
	}
	function share(n: number): number {
		return aggregate.agentLines > 0 ? Math.round((n / aggregate.agentLines) * 100) : 0;
	}
	function shortProject(p: string): string {
		return p.split('/').slice(-1)[0] || p;
	}
</script>

<div class="mb-6">
	<div class="flex items-center justify-between mb-3">
		<span class="text-xs text-surface-400 font-medium">Code survival</span>
		<span class="text-[10px] text-surface-500">
			{aggregate.sessionsMeasured} session{aggregate.sessionsMeasured === 1 ? '' : 's'} measured against git
			{#if aggregate.sessionsWithoutData > 0}
				· {aggregate.sessionsWithoutData} without measurable edits
			{/if}
		</span>
	</div>

	{#if aggregate.sessionsMeasured === 0}
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-4 py-3 text-xs text-surface-500">
			No Claude Code session with textual edits inside a git repository yet. Survival is measured by following each line the agent wrote into the repo as it is now.
		</div>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
			<!-- Headline -->
			<div class="bg-surface-900 border border-surface-800 rounded-lg px-4 py-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Agent lines still in the repo</div>
				<div class="text-2xl font-bold {pctClass(aggregate.survivalPct)}">{aggregate.survivalPct}%</div>
				<div class="text-[10px] text-surface-500 mb-2">{aggregate.committedPct}% committed · {aggregate.agentLines.toLocaleString()} lines written</div>
				<div class="flex h-2 rounded-full overflow-hidden bg-surface-800">
					<div class="bg-emerald-500" style="width: {share(aggregate.committed)}%"></div>
					<div class="bg-blue-400" style="width: {share(aggregate.uncommitted)}%"></div>
					<div class="bg-red-500" style="width: {share(aggregate.gone)}%"></div>
				</div>
				<div class="flex gap-3 mt-1 text-[10px] text-surface-500 flex-wrap">
					<span>committed {aggregate.committed.toLocaleString()}</span>
					<span>uncommitted {aggregate.uncommitted.toLocaleString()}</span>
					<span class="text-red-400/80">gone {aggregate.gone.toLocaleString()}</span>
					<span>self-revised {aggregate.selfRevised.toLocaleString()}</span>
				</div>
			</div>

			<!-- By project -->
			<div class="bg-surface-900 border border-surface-800 rounded-lg px-4 py-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-2">By project</div>
				<div class="space-y-1.5">
					{#each aggregate.byProject.slice(0, 5) as p}
						<div class="flex items-center gap-2 text-xs">
							<span class="text-surface-300 truncate flex-1" title={p.project}>{shortProject(p.project)}</span>
							<span class="text-surface-500 text-[10px]">{p.sessions} sess · {p.agentLines} lines</span>
							<span class="font-medium w-10 text-right {pctClass(p.survivalPct)}">{p.survivalPct}%</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Lowest sessions -->
			<div class="bg-surface-900 border border-surface-800 rounded-lg px-4 py-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-2">Most rewritten sessions</div>
				{#if aggregate.lowestSessions.length === 0}
					<div class="text-xs text-surface-500">Not enough data.</div>
				{/if}
				<div class="space-y-1.5">
					{#each aggregate.lowestSessions as s}
						<a
							href="/sessions/{s.sessionId}?project={encodeURIComponent(s.project)}"
							class="flex items-center gap-2 text-xs hover:text-blue-400 transition-colors"
						>
							<span class="text-surface-300 truncate flex-1">{s.slug || s.sessionId.slice(0, 8)}</span>
							<span class="text-surface-500 text-[10px]">{formatDate(s.startedAt)}</span>
							<span class="font-medium w-10 text-right {pctClass(s.survivalPct)}">{s.survivalPct}%</span>
						</a>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
