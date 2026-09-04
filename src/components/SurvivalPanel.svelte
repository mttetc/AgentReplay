<script lang="ts">
	import type { SessionSurvival, FileSurvival } from '$lib/server/code-survival';

	let { survival, onjump }: { survival: SessionSurvival; onjump?: (index: number) => void } = $props();

	let showAll = $state(false);

	const measurable = $derived(
		survival.files.filter((f) => f.status !== 'unmeasurable' && f.status !== 'outside-repo')
	);
	const visibleFiles = $derived(showAll ? measurable : measurable.slice(0, 6));

	function pct(n: number): number {
		return survival.agentLines > 0 ? Math.round((n / survival.agentLines) * 100) : 0;
	}

	function verdictClass(v: SessionSurvival['verdict'] | FileSurvival['status']): string {
		switch (v) {
			case 'kept':
				return 'text-emerald-400';
			case 'mostly-kept':
				return 'text-blue-400';
			case 'reworked':
				return 'text-amber-400';
			case 'discarded':
			case 'file-missing':
				return 'text-red-400';
			default:
				return 'text-surface-400';
		}
	}

	function statusLabel(s: FileSurvival['status']): string {
		return s.replace('-', ' ');
	}

	function jumpTo(f: FileSurvival) {
		if (!onjump || f.eventIds.length === 0) return;
		const idx = parseInt(f.eventIds[0].replace('evt-', ''), 10);
		if (!Number.isNaN(idx)) onjump(idx);
	}
</script>

<div class="space-y-3 text-xs">
	<!-- Headline numbers -->
	<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
		<div class="bg-surface-900 border border-surface-800 rounded px-2.5 py-2">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Still in repo</div>
			<div class="text-lg font-bold {verdictClass(survival.verdict)}">{survival.survivalPct}%</div>
			<div class="text-[10px] text-surface-500">of {survival.agentLines} agent lines</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded px-2.5 py-2">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Committed</div>
			<div class="text-lg font-bold text-surface-100">{survival.committedPct}%</div>
			<div class="text-[10px] text-surface-500">{survival.committed} lines in HEAD</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded px-2.5 py-2">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Gone</div>
			<div class="text-lg font-bold {survival.gone > 0 ? 'text-red-400' : 'text-surface-100'}">{survival.gone}</div>
			<div class="text-[10px] text-surface-500">rewritten or reverted</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded px-2.5 py-2">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Self-revised</div>
			<div class="text-lg font-bold text-surface-100">{survival.selfRevised}</div>
			<div class="text-[10px] text-surface-500">replaced by the agent itself</div>
		</div>
	</div>

	<!-- Stacked bar -->
	{#if survival.agentLines > 0}
		<div>
			<div class="flex h-2 rounded-full overflow-hidden bg-surface-800" title="committed / uncommitted / gone">
				<div class="bg-emerald-500" style="width: {pct(survival.committed)}%"></div>
				<div class="bg-blue-400" style="width: {pct(survival.uncommitted)}%"></div>
				<div class="bg-red-500" style="width: {pct(survival.gone)}%"></div>
			</div>
			<div class="flex gap-4 mt-1 text-[10px] text-surface-500">
				<span><span class="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1"></span>committed {survival.committed}</span>
				<span><span class="inline-block w-2 h-2 rounded-sm bg-blue-400 mr-1"></span>uncommitted {survival.uncommitted}</span>
				<span><span class="inline-block w-2 h-2 rounded-sm bg-red-500 mr-1"></span>gone {survival.gone}</span>
			</div>
		</div>
	{/if}

	<!-- Per-file -->
	{#if measurable.length > 0}
		<div>
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Per file (worst first)</div>
			<div class="bg-surface-900 border border-surface-800 rounded overflow-hidden">
				{#each visibleFiles as f, i}
					<div class="px-2.5 py-1.5 {i > 0 ? 'border-t border-surface-800/50' : ''}">
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={() => jumpTo(f)}
								class="text-surface-200 font-mono flex-1 truncate text-left hover:text-blue-400 transition-colors"
								title="Jump to first edit of {f.relPath}"
							>{f.relPath}</button>
							<span class="text-surface-500">{f.editCount} edit{f.editCount === 1 ? '' : 's'}</span>
							<span class="text-surface-500">{f.agentLines} lines</span>
							<span class="font-medium {verdictClass(f.status)} w-20 text-right">
								{f.status === 'file-missing' ? 'file missing' : `${f.survivalPct}% ${statusLabel(f.status)}`}
							</span>
						</div>
						{#if f.sampleGone.length > 0}
							<div class="mt-1 pl-2 border-l border-red-500/40 space-y-0.5">
								{#each f.sampleGone as line}
									<div class="text-[10px] text-surface-500 font-mono truncate" title={line}>− {line}</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
			{#if measurable.length > 6}
				<button
					type="button"
					onclick={() => (showAll = !showAll)}
					class="mt-1 text-[10px] text-surface-500 hover:text-surface-300"
				>{showAll ? 'Show fewer' : `Show all ${measurable.length} files`}</button>
			{/if}
		</div>
	{/if}

	<div class="text-[10px] text-surface-600">
		Measured against <span class="font-mono">{survival.headHash.slice(0, 7)}</span> in {survival.repoRoot}.
		Lines are compared whitespace-insensitively; lines under 6 characters are ignored.
		{#if survival.filesSkipped.outsideRepo > 0}
			{survival.filesSkipped.outsideRepo} file{survival.filesSkipped.outsideRepo === 1 ? '' : 's'} outside the repo skipped.
		{/if}
	</div>
</div>
