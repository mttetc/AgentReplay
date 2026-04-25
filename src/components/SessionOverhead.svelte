<script lang="ts">
	import { formatCost } from '$lib/utils/format';
	import type { SessionOverhead } from '$lib/server/overhead-analysis';

	let { overhead }: { overhead: SessionOverhead } = $props();

	let expanded: string | null = $state(null);

	function fmtTokens(n: number): string {
		if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
		return String(n);
	}

	function effortClass(b: 'low' | 'medium' | 'high'): string {
		if (b === 'high') return 'text-red-400';
		if (b === 'medium') return 'text-amber-400';
		return 'text-emerald-400';
	}

	const totalSkillCost = $derived(
		overhead.skillsInvoked.reduce((s, x) => s + x.costGenerated, 0)
	);
</script>

<div class="space-y-3 text-xs">
	<!-- Effort + skills/MCPs summary -->
	<div class="grid grid-cols-3 gap-2">
		<div class="bg-surface-900 border border-surface-800 rounded px-2.5 py-2">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Effort</div>
			<div class="font-medium {effortClass(overhead.effort.bucket)}">{overhead.effort.bucket}</div>
			<div class="text-[10px] text-surface-500">
				{overhead.effort.ratio} thinking turn{overhead.effort.ratio === 1 ? '' : 's'}
			</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded px-2.5 py-2">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Skills used</div>
			<div class="text-surface-100 font-medium">{overhead.skillsInvoked.length}</div>
			{#if totalSkillCost > 0}
				<div class="text-[10px] text-amber-400">{formatCost(totalSkillCost)} total</div>
			{/if}
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded px-2.5 py-2">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">MCP servers</div>
			<div class="text-surface-100 font-medium">{overhead.mcpUsed.length}</div>
			{#if overhead.mcpUsed.length > 0}
				<div class="text-[10px] text-surface-500">
					{overhead.mcpUsed.reduce((s, x) => s + x.count, 0)} calls
				</div>
			{/if}
		</div>
	</div>

	<!-- Skills invoked -->
	{#if overhead.skillsInvoked.length > 0}
		<div>
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Skills invoked</div>
			<div class="bg-surface-900 border border-surface-800 rounded overflow-hidden">
				{#each overhead.skillsInvoked as sk, i}
					<div class="flex items-center gap-2 px-2.5 py-1.5 {i > 0 ? 'border-t border-surface-800/50' : ''}">
						<span class="text-surface-200 font-mono flex-1 truncate">{sk.name}</span>
						<span class="text-surface-500 tabular-nums">{sk.count}×</span>
						<span class="text-amber-400 tabular-nums">{formatCost(sk.costGenerated)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- MCP usage -->
	{#if overhead.mcpUsed.length > 0}
		<div>
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">MCP servers used</div>
			<div class="bg-surface-900 border border-surface-800 rounded overflow-hidden">
				{#each overhead.mcpUsed as m, i}
					<div class="text-xs {i > 0 ? 'border-t border-surface-800/50' : ''}">
						<button
							type="button"
							onclick={() => (expanded = expanded === 'mcp:' + m.server ? null : 'mcp:' + m.server)}
							class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-800/30"
						>
							<span class="text-surface-500 text-[10px] w-3">{expanded === 'mcp:' + m.server ? '▾' : '▸'}</span>
							<span class="text-surface-200 font-mono flex-1 truncate">{m.server}</span>
							<span class="text-surface-500 tabular-nums">{m.tools.length} tool{m.tools.length === 1 ? '' : 's'}</span>
							<span class="text-surface-400 tabular-nums">{m.count}×</span>
						</button>
						{#if expanded === 'mcp:' + m.server}
							<div class="px-3 py-1.5 bg-surface-950 border-t border-surface-800/50">
								<div class="flex flex-wrap gap-1">
									{#each m.tools as t}
										<span class="text-[10px] bg-surface-800 text-surface-300 rounded px-1.5 py-0.5 font-mono">{t}</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- CLAUDE.md applied -->
	{#if overhead.claudeMd.length > 0}
		<div>
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">CLAUDE.md applied</div>
			<div class="bg-surface-900 border border-surface-800 rounded overflow-hidden">
				{#each overhead.claudeMd as cm, i}
					<div class="text-xs {i > 0 ? 'border-t border-surface-800/50' : ''}">
						<button
							type="button"
							onclick={() => (expanded = expanded === 'cm:' + cm.path ? null : 'cm:' + cm.path)}
							class="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-800/30"
						>
							<span class="text-surface-500 text-[10px] w-3">{expanded === 'cm:' + cm.path ? '▾' : '▸'}</span>
							<span class="text-surface-200 font-mono flex-1 truncate">{cm.name}</span>
							<span class="text-surface-400 tabular-nums">{fmtTokens(cm.tokensEst)} tok</span>
						</button>
						{#if expanded === 'cm:' + cm.path}
							<div class="px-3 py-2 bg-surface-950 border-t border-surface-800/50">
								<pre class="text-[11px] text-surface-300 leading-relaxed whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">{cm.content || '(no content)'}</pre>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
