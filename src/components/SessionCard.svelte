<script lang="ts">
	import type { SessionSummary } from '$lib/types/timeline';
	import { formatDate, formatDurationBetween, formatNumber, formatCost, shortModel } from '$lib/utils/format';

	let { session }: { session: SessionSummary } = $props();

	function getModelBadge(model: string): string {
		if (model.includes('opus')) return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
		if (model.includes('sonnet')) return 'bg-blue-500/15 text-blue-300 border border-blue-500/30';
		if (model.includes('haiku')) return 'bg-green-500/15 text-green-300 border border-green-500/30';
		return 'bg-surface-800 text-surface-400 border border-surface-700';
	}

	function buildHref(s: SessionSummary): string {
		const base = `/sessions/${s.sessionId}`;
		if (s.provider === 'cursor' && s.providerMeta) {
			const params = new URLSearchParams({ provider: 'cursor', ...s.providerMeta, project: s.project });
			return `${base}?${params}`;
		}
		return `${base}?project=${encodeURIComponent(s.project)}&file=${encodeURIComponent(s.filePath)}`;
	}

	const providerBadge: Record<string, { label: string; cls: string }> = {
		'claude-code': { label: 'CC', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
		'cursor': { label: 'Cursor', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
		'windsurf': { label: 'Windsurf', cls: 'bg-teal-500/15 text-teal-300 border-teal-500/30' }
	};
</script>

<a
	href={buildHref(session)}
	class="block bg-surface-950 border border-surface-800 rounded-lg p-4 hover:border-surface-600 hover:bg-surface-900/80 transition-all group"
	style="container-type: inline-size;"
>
	<div class="flex items-start justify-between gap-3 mb-3">
		<div class="min-w-0">
			<h3 class="text-surface-100 font-medium truncate group-hover:text-white transition-colors">
				{session.slug || session.sessionId.slice(0, 8)}
			</h3>
			<p class="text-surface-500 text-xs mt-0.5 truncate">{session.project}</p>
		</div>
		<span class="text-surface-500 text-xs whitespace-nowrap">{formatDate(session.startedAt)}</span>
	</div>

	<div class="session-card-meta flex items-center gap-2 text-xs text-surface-400 flex-wrap">
		{#if session.provider && session.provider !== 'claude-code'}
			<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border {providerBadge[session.provider]?.cls || 'bg-surface-800 text-surface-400 border-surface-700'}">
				{providerBadge[session.provider]?.label || session.provider}
			</span>
		{/if}
		<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium {getModelBadge(session.model)}">
			{shortModel(session.model)}
		</span>
		<span class="meta-sep text-surface-700">|</span>
		<span class="text-cyan-400/80">{session.toolCallCount} tools</span>
		{#if session.errorCount > 0}
			<span class="meta-sep text-surface-700">|</span>
			<span class="text-red-400">{session.errorCount} err</span>
		{/if}
		<span class="meta-sep text-surface-700">|</span>
		<span>{formatDurationBetween(session.startedAt, session.lastActiveAt)}</span>
		<span class="meta-sep text-surface-700">|</span>
		<span>{formatNumber(session.outputTokens)} out</span>
		<span
			class="ml-auto {session.estimatedCost > 0 ? 'text-emerald-400' : 'text-surface-500'}"
			title="Estimated API cost"
		>{formatCost(session.estimatedCost)}</span>
	</div>
</a>

<style>
	@container (max-width: 360px) {
		.session-card-meta {
			gap: 0.375rem 0.5rem;
		}
		.meta-sep {
			display: none;
		}
	}
</style>
