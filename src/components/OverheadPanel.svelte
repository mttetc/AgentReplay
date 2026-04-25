<script lang="ts">
	import { formatCost } from '$lib/utils/format';
	import type { OverheadAnalysis, OverheadFile } from '$lib/server/overhead-analysis';

	let { overhead }: { overhead: OverheadAnalysis } = $props();

	// Track which inline-content row is expanded (skill name or claude-md path).
	let expanded: string | null = $state(null);

	function fmtTokens(n: number): string {
		if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
		return String(n);
	}

	function severityClasses(sev: 'info' | 'warning' | 'critical'): string {
		if (sev === 'critical') return 'border-red-500/30 bg-red-500/5 text-red-300';
		if (sev === 'warning') return 'border-amber-500/30 bg-amber-500/5 text-amber-300';
		return 'border-blue-500/20 bg-blue-500/5 text-blue-300';
	}

	function ageHint(lastUsed?: string): string {
		if (!lastUsed) return 'never';
		const days = Math.floor((Date.now() - new Date(lastUsed).getTime()) / 86400000);
		if (days <= 0) return 'today';
		if (days === 1) return '1d ago';
		return `${days}d ago`;
	}

	function badge(file: OverheadFile): { text: string; cls: string } {
		if (file.invocationCount === 0) {
			return { text: 'unused', cls: 'bg-red-500/15 text-red-400 border-red-500/20' };
		}
		return {
			text: `${file.invocationCount} use${file.invocationCount === 1 ? '' : 's'}`,
			cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
		};
	}

	function toggle(key: string) {
		expanded = expanded === key ? null : key;
	}

	const t = $derived(overhead.totals);
	const e = $derived(overhead.effort);
	const totalEffortSessions = $derived(e.low + e.medium + e.high);
	function pct(part: number, whole: number): string {
		if (whole === 0) return '0%';
		return Math.round((part / whole) * 100) + '%';
	}
</script>

<div class="space-y-5">
	<!-- Headline numbers -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-2.5">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Setup tokens</div>
			<div class="text-surface-100 text-lg font-semibold">{fmtTokens(t.setupTokens)}</div>
			<div class="text-[10px] text-surface-500">loaded before every prompt</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-2.5">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Per session (cached)</div>
			<div class="text-emerald-400 text-lg font-semibold">{formatCost(t.costPerSessionCached)}</div>
			<div class="text-[10px] text-surface-500">cache-warm load</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-2.5">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Per session (fresh)</div>
			<div class="text-amber-400 text-lg font-semibold">{formatCost(t.costPerSessionFresh)}</div>
			<div class="text-[10px] text-surface-500">first hit / cache miss</div>
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-2.5">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider">Monthly overhead</div>
			<div class="text-surface-100 text-lg font-semibold">{formatCost(t.monthlyCachedCost)}</div>
			<div class="text-[10px] text-surface-500">{Math.round(t.sessionsPerMonth)} sessions/mo</div>
		</div>
	</div>

	<!-- Recommendations -->
	{#if overhead.recommendations.length > 0}
		<div>
			<div class="text-xs text-surface-400 font-medium mb-2">Recommendations</div>
			<div class="space-y-2">
				{#each overhead.recommendations as r}
					<div class="border rounded-md px-3 py-2 {severityClasses(r.severity)}">
						<div class="flex items-start justify-between gap-3">
							<div class="flex-1 min-w-0">
								<div class="font-medium text-sm">{r.title}</div>
								<div class="text-[11px] opacity-80 mt-0.5">{r.detail}</div>
							</div>
							{#if r.monthlySavingsUsd > 0}
								<div class="text-right flex-shrink-0">
									<div class="text-emerald-400 text-sm font-semibold">
										~{formatCost(r.monthlySavingsUsd)}/mo
									</div>
									<div class="text-[10px] opacity-60">savings</div>
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Skills -->
	{#if overhead.skills.length > 0}
		<div>
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs text-surface-400 font-medium">Skills loaded</span>
				<span class="text-[10px] text-surface-500">
					{fmtTokens(overhead.skills.reduce((s, x) => s + x.tokensEst, 0))} tokens loaded
					· {formatCost(overhead.skills.reduce((s, x) => s + (x.costGenerated || 0), 0))} generated
				</span>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg overflow-hidden">
				{#each overhead.skills as sk, i}
					{@const b = badge(sk)}
					{@const open = expanded === 'skill:' + sk.name}
					{@const generated = sk.costGenerated || 0}
					<div class="text-xs {i > 0 ? 'border-t border-surface-800/50' : ''}">
						<button
							type="button"
							onclick={() => toggle('skill:' + sk.name)}
							class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-800/30 transition-colors"
						>
							<span class="text-surface-500 text-[10px] w-3">{open ? '▾' : '▸'}</span>
							<span class="text-surface-200 font-mono flex-1 truncate">{sk.name}</span>
							<span class="text-surface-500 hidden sm:inline">{ageHint(sk.lastUsed)}</span>
							<span class="text-surface-400 tabular-nums" title="SKILL.md size">{fmtTokens(sk.tokensEst)} tok</span>
							{#if generated > 0}
								<span
									class="text-amber-400 tabular-nums"
									title="Total $ spent in turns following invocation"
								>
									{formatCost(generated)}
								</span>
							{/if}
							<span class="border rounded text-[10px] px-1.5 py-0.5 {b.cls}">{b.text}</span>
						</button>
						{#if open}
							<div class="px-3 py-2 bg-surface-950 border-t border-surface-800/50">
								<div class="text-[10px] text-surface-500 mb-1.5 font-mono">{sk.path}</div>
								<pre class="text-[11px] text-surface-300 leading-relaxed whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">{sk.content || '(content not loaded)'}</pre>
							</div>
						{/if}
					</div>
				{/each}
			</div>
			<div class="text-[10px] text-surface-500 mt-1.5">
				"Generated" = sum of $ spent in events between a skill's invocation and the next user message.
			</div>
		</div>
	{/if}

	<!-- MCP servers -->
	{#if overhead.mcpServers.length > 0}
		<div>
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs text-surface-400 font-medium">MCP servers (observed)</span>
				<span class="text-[10px] text-surface-500">
					{fmtTokens(overhead.mcpServers.reduce((s, x) => s + x.tokensEst, 0))} tokens (floor)
				</span>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg overflow-hidden">
				{#each overhead.mcpServers as mcp, i}
					{@const b = badge(mcp)}
					<div class="flex items-center gap-3 px-3 py-2 text-xs {i > 0 ? 'border-t border-surface-800/50' : ''}">
						<span class="text-surface-200 font-mono flex-1 truncate">{mcp.name}</span>
						<span class="text-surface-500 hidden sm:inline">{ageHint(mcp.lastUsed)}</span>
						<span class="text-surface-400 tabular-nums">~{fmtTokens(mcp.tokensEst)} tok</span>
						<span class="border rounded text-[10px] px-1.5 py-0.5 {b.cls}">{b.text}</span>
					</div>
				{/each}
			</div>
			<div class="text-[10px] text-surface-500 mt-1.5">
				Token estimate counts only tools observed in your sessions (~150 tok each). The system prompt may load more — real cost is a floor.
			</div>
		</div>
	{/if}

	<!-- CLAUDE.md files -->
	{#if overhead.claudeMd.length > 0}
		<div>
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs text-surface-400 font-medium">CLAUDE.md files in scope</span>
				<span class="text-[10px] text-surface-500">
					{fmtTokens(overhead.claudeMd.reduce((s, x) => s + x.tokensEst, 0))} tokens total
				</span>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg overflow-hidden">
				{#each overhead.claudeMd as cm, i}
					{@const open = expanded === 'cm:' + cm.path}
					<div class="text-xs {i > 0 ? 'border-t border-surface-800/50' : ''}">
						<button
							type="button"
							onclick={() => toggle('cm:' + cm.path)}
							class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-800/30 transition-colors"
						>
							<span class="text-surface-500 text-[10px] w-3">{open ? '▾' : '▸'}</span>
							<span class="text-surface-200 font-mono flex-1 truncate">{cm.name}</span>
							<span class="text-surface-400 tabular-nums">{fmtTokens(cm.tokensEst)} tok</span>
						</button>
						{#if open}
							<div class="px-3 py-2 bg-surface-950 border-t border-surface-800/50">
								<pre class="text-[11px] text-surface-300 leading-relaxed whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">{cm.content || '(content not loaded)'}</pre>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Effort + Hooks -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-2.5">
			<div class="flex items-center justify-between mb-1">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider">Effort observed</div>
				<div class="text-[10px] text-surface-500">configured: <span class="font-mono text-surface-300">{e.configured || 'medium'}</span></div>
			</div>
			{#if totalEffortSessions === 0}
				<div class="text-surface-500 text-xs mt-1">No sessions sampled.</div>
			{:else}
				<div class="flex items-center gap-1.5 text-xs">
					<span class="text-emerald-400 tabular-nums">{pct(e.low, totalEffortSessions)}</span>
					<span class="text-surface-500">low</span>
					<span class="text-surface-700">·</span>
					<span class="text-amber-400 tabular-nums">{pct(e.medium, totalEffortSessions)}</span>
					<span class="text-surface-500">med</span>
					<span class="text-surface-700">·</span>
					<span class="text-red-400 tabular-nums">{pct(e.high, totalEffortSessions)}</span>
					<span class="text-surface-500">high</span>
				</div>
				<div class="flex h-1.5 rounded overflow-hidden mt-2 bg-surface-800">
					<div class="bg-emerald-500/60" style="width: {pct(e.low, totalEffortSessions)}"></div>
					<div class="bg-amber-500/60" style="width: {pct(e.medium, totalEffortSessions)}"></div>
					<div class="bg-red-500/60" style="width: {pct(e.high, totalEffortSessions)}"></div>
				</div>
				<div class="text-[10px] text-surface-500 mt-1.5">
					Inferred from thinking-block volume per session. Switching effort/fast in slash commands changes the bucket.
				</div>
			{/if}
		</div>
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-2.5">
			<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">
				Hooks ({overhead.hooks.length})
			</div>
			{#if overhead.hooks.length === 0}
				<div class="text-surface-500 text-xs">none</div>
			{:else}
				<div class="flex flex-wrap gap-1">
					{#each overhead.hooks as h}
						<span class="text-[10px] bg-surface-800 text-surface-300 rounded px-1.5 py-0.5 font-mono">
							{h.event}{h.matcher ? `:${h.matcher}` : ''}
						</span>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="text-[10px] text-surface-500 leading-relaxed">
		Token counts are heuristic (~3.5 chars/token). Cost rates use the modal model from your recent sessions.
	</div>
</div>
