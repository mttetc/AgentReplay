<script lang="ts">
	import type { PostMortemReport, LlmConfig } from '$lib/server/postmortem';
	import { formatCost, formatDate } from '$lib/utils/format';

	let {
		sessionId,
		provider,
		params,
		initialReport,
		config,
		onjump
	}: {
		sessionId: string;
		provider: string;
		params: Record<string, string>;
		initialReport: PostMortemReport | null;
		config: LlmConfig;
		onjump?: (index: number) => void;
	} = $props();

	let report: PostMortemReport | null = $state(initialReport);
	let loading = $state(false);
	let error = $state('');

	async function generate() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/postmortem', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId, provider, params })
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
			report = body.report;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Generation failed';
		} finally {
			loading = false;
		}
	}

	function jump(eventId: string) {
		if (!onjump) return;
		const idx = parseInt(eventId.replace('evt-', ''), 10);
		if (!Number.isNaN(idx)) onjump(idx);
	}

	function kindClass(kind: string): string {
		switch (kind) {
			case 'edit-loop':
			case 'error-retry':
				return 'text-red-400 border-red-500/30';
			case 'human-correction':
			case 'misunderstanding':
				return 'text-amber-400 border-amber-500/30';
			default:
				return 'text-surface-300 border-surface-700';
		}
	}

	function confidenceClass(c: string): string {
		return c === 'high' ? 'text-emerald-400' : c === 'medium' ? 'text-amber-400' : 'text-red-400';
	}
</script>

<div class="space-y-3 text-xs">
	<!-- Controls -->
	<div class="flex items-center gap-3 flex-wrap">
		{#if config.configured}
			<button
				type="button"
				onclick={generate}
				disabled={loading}
				class="px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-700 text-surface-200 font-medium hover:border-surface-500 disabled:opacity-50 transition-colors"
			>
				{#if loading}
					Analyzing…
				{:else if report}
					Regenerate
				{:else}
					Generate post-mortem
				{/if}
			</button>
			<span class="text-surface-500">
				Sends this session's prompts, tool errors, file activity and survival data to
				<span class="text-surface-300 font-mono">{config.model}</span>
				{#if config.provider === 'ollama'}
					on <span class="font-mono">{config.baseUrl}</span> (local)
				{:else}
					via the Claude API
				{/if}
			</span>
		{:else}
			<div class="text-surface-400 bg-surface-900 border border-surface-800 rounded px-3 py-2 leading-relaxed">
				{config.reason}
			</div>
		{/if}
	</div>

	{#if error}
		<div class="text-red-400 bg-red-500/5 border border-red-500/20 rounded px-3 py-2">{error}</div>
	{/if}

	{#if report}
		<!-- Headline -->
		<div class="bg-surface-900 border border-surface-800 rounded-lg px-4 py-3">
			<div class="text-surface-100 text-sm font-medium leading-snug">{report.headline}</div>
			<div class="flex gap-3 mt-2 text-[10px] text-surface-500 flex-wrap">
				<span>confidence <span class="{confidenceClass(report.confidence)} font-medium">{report.confidence}</span></span>
				<span>{report.meta.model}</span>
				<span>{formatDate(report.meta.generatedAt)}</span>
				<span>{report.meta.inputTokens.toLocaleString()} in / {report.meta.outputTokens.toLocaleString()} out</span>
				{#if report.meta.costUsd !== null}
					<span>{formatCost(report.meta.costUsd)}</span>
				{/if}
				{#if report.meta.droppedCitations > 0 || report.meta.unsupportedClaims > 0}
					<span class="text-amber-400" title="Citations to events that do not exist were removed">
						{report.meta.droppedCitations} invalid citation{report.meta.droppedCitations === 1 ? '' : 's'} removed
						{#if report.meta.unsupportedClaims > 0}
							· {report.meta.unsupportedClaims} claim{report.meta.unsupportedClaims === 1 ? '' : 's'} left without evidence
						{/if}
					</span>
				{/if}
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
			<!-- Narrative -->
			<div>
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">What happened</div>
				<div class="bg-surface-900 border border-surface-800 rounded overflow-hidden">
					{#each report.narrative as phase, i}
						<div class="px-3 py-2 {i > 0 ? 'border-t border-surface-800/50' : ''}">
							<div class="flex items-baseline gap-2">
								<span class="text-surface-200 font-medium">{phase.phase}</span>
								<span class="flex gap-1 flex-wrap">
									{#each phase.eventIds.slice(0, 6) as id}
										<button type="button" onclick={() => jump(id)} class="text-[10px] font-mono text-blue-400 hover:text-blue-300">{id.replace('evt-', '#')}</button>
									{/each}
								</span>
							</div>
							<div class="text-surface-400 mt-0.5 leading-relaxed">{phase.summary}</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Friction -->
			<div>
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Friction</div>
				<div class="bg-surface-900 border border-surface-800 rounded overflow-hidden">
					{#if report.friction.length === 0}
						<div class="px-3 py-2 text-surface-500">None detected.</div>
					{/if}
					{#each report.friction as f, i}
						<div class="px-3 py-2 {i > 0 ? 'border-t border-surface-800/50' : ''}">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="border rounded px-1.5 py-0.5 text-[10px] font-medium {kindClass(f.kind)}">{f.kind}</span>
								<span class="flex gap-1 flex-wrap">
									{#each f.eventIds.slice(0, 8) as id}
										<button type="button" onclick={() => jump(id)} class="text-[10px] font-mono text-blue-400 hover:text-blue-300">{id.replace('evt-', '#')}</button>
									{/each}
								</span>
								{#if f.eventIds.length === 0}
									<span class="text-[10px] text-amber-400">no supporting event</span>
								{/if}
							</div>
							<div class="text-surface-300 mt-1 leading-relaxed">{f.evidence}</div>
							<div class="text-surface-500 mt-0.5">Impact: {f.impact}</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Human interventions -->
		{#if report.humanInterventions.length > 0}
			<div>
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Human interventions</div>
				<div class="bg-surface-900 border border-surface-800 rounded overflow-hidden">
					{#each report.humanInterventions as h, i}
						<div class="flex gap-2 px-3 py-1.5 {i > 0 ? 'border-t border-surface-800/50' : ''}">
							<button type="button" onclick={() => jump(h.eventId)} class="text-[10px] font-mono text-blue-400 hover:text-blue-300 flex-shrink-0 mt-0.5">{h.eventId.replace('evt-', '#')}</button>
							<span class="text-surface-300 leading-relaxed">{h.whatChanged}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Outcome + recommendations -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
			<div class="bg-surface-900 border border-surface-800 rounded px-3 py-2">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Outcome</div>
				<div class="text-surface-200 leading-relaxed">{report.outcome.assessment}</div>
				<div class="text-surface-400 mt-1 leading-relaxed">{report.outcome.codeKept}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded px-3 py-2">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Recommendations</div>
				{#if report.recommendations.length === 0}
					<div class="text-surface-500">None.</div>
				{/if}
				<ul class="space-y-1">
					{#each report.recommendations as r}
						<li class="flex gap-2">
							<span class="text-[10px] font-mono text-surface-500 flex-shrink-0 mt-0.5 w-16">{r.target}</span>
							<span class="text-surface-300 leading-relaxed">{r.text}</span>
						</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}
</div>
