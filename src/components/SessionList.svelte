<script lang="ts">
	import type { SessionSummary } from '$lib/types/timeline';
	import type { ProviderType } from '$lib/server/providers/types';
	import { shortModel, formatCost } from '$lib/utils/format';
	import SessionCard from './SessionCard.svelte';
	import EmptyState from './EmptyState.svelte';

	let { sessions }: { sessions: SessionSummary[] } = $props();
	let search = $state('');
	let compareMode = $state(false);
	let compareSelection = $state<string[]>([]);
	let showFilters = $state(false);

	function toggleCompare(sessionId: string) {
		if (compareSelection.includes(sessionId)) {
			compareSelection = compareSelection.filter(s => s !== sessionId);
		} else if (compareSelection.length < 2) {
			compareSelection = [...compareSelection, sessionId];
		}
	}

	let compareUrl = $derived(
		compareSelection.length === 2
			? `/compare?a=${compareSelection[0]}&b=${compareSelection[1]}`
			: ''
	);
	let sortBy: 'date' | 'model' | 'cost' | 'duration' | 'tokens' = $state('date');
	let sortDir: 'asc' | 'desc' = $state('desc');
	let providerFilter: ProviderType | 'all' = $state('all');
	let visibleCount = $state(50);
	let sentinel: HTMLDivElement | undefined = $state();

	// Advanced filters
	let modelFilter = $state('all');
	let minCost = $state('');
	let maxCost = $state('');
	let hasErrors = $state(false);
	let dateRange: '1d' | '7d' | '30d' | '90d' | 'all' = $state('all');

	let availableProviders = $derived(
		[...new Set(sessions.map((s) => s.provider).filter(Boolean))] as ProviderType[]
	);

	let availableModels = $derived(
		[...new Set(sessions.map((s) => shortModel(s.model)).filter((m) => m !== 'Unknown'))].sort()
	);

	let activeFilterCount = $derived(
		(modelFilter !== 'all' ? 1 : 0) +
		(minCost !== '' ? 1 : 0) +
		(maxCost !== '' ? 1 : 0) +
		(hasErrors ? 1 : 0) +
		(dateRange !== 'all' ? 1 : 0) +
		(providerFilter !== 'all' ? 1 : 0)
	);

	function getDuration(s: SessionSummary): number {
		return new Date(s.lastActiveAt).getTime() - new Date(s.startedAt).getTime();
	}

	function setSort(key: typeof sortBy) {
		if (sortBy === key) {
			sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = key;
			sortDir = key === 'model' ? 'asc' : 'desc';
		}
		visibleCount = 50;
	}

	function clearAllFilters() {
		search = '';
		providerFilter = 'all';
		modelFilter = 'all';
		minCost = '';
		maxCost = '';
		hasErrors = false;
		dateRange = 'all';
	}

	function getDateCutoff(range: string): number {
		if (range === 'all') return 0;
		const days: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };
		return Date.now() - (days[range] || 0) * 86400000;
	}

	let filtered = $derived(
		sessions.filter((s) => {
			if (providerFilter !== 'all' && s.provider !== providerFilter) return false;
			if (modelFilter !== 'all' && shortModel(s.model) !== modelFilter) return false;
			if (minCost !== '' && s.estimatedCost < parseFloat(minCost)) return false;
			if (maxCost !== '' && s.estimatedCost > parseFloat(maxCost)) return false;
			if (hasErrors && s.errorCount === 0) return false;
			if (dateRange !== 'all') {
				const cutoff = getDateCutoff(dateRange);
				if (new Date(s.lastActiveAt).getTime() < cutoff) return false;
			}
			if (!search) return true;
			const q = search.toLowerCase();
			return (
				s.slug.toLowerCase().includes(q) ||
				s.project.toLowerCase().includes(q) ||
				s.sessionId.toLowerCase().includes(q)
			);
		})
	);

	let sorted = $derived(
		[...filtered].sort((a, b) => {
			let cmp = 0;
			switch (sortBy) {
				case 'date':
					cmp = new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime();
					break;
				case 'model':
					cmp = shortModel(a.model).localeCompare(shortModel(b.model));
					break;
				case 'cost':
					cmp = a.estimatedCost - b.estimatedCost;
					break;
				case 'duration':
					cmp = getDuration(a) - getDuration(b);
					break;
				case 'tokens':
					cmp = a.outputTokens - b.outputTokens;
					break;
			}
			return sortDir === 'asc' ? cmp : -cmp;
		})
	);

	let visibleSessions = $derived(sorted.slice(0, visibleCount));
	let hasMore = $derived(visibleCount < sorted.length);

	// Aggregate stats for filtered results
	let filteredStats = $derived({
		totalCost: filtered.reduce((sum, s) => sum + s.estimatedCost, 0),
		totalErrors: filtered.reduce((sum, s) => sum + s.errorCount, 0)
	});

	// Reset visible count when search changes
	$effect(() => {
		search;
		visibleCount = 50;
	});

	const sortOptions: { key: 'date' | 'model' | 'cost' | 'duration' | 'tokens'; label: string }[] = [
		{ key: 'date', label: 'Date' },
		{ key: 'model', label: 'Model' },
		{ key: 'cost', label: 'Cost' },
		{ key: 'duration', label: 'Duration' },
		{ key: 'tokens', label: 'Output' }
	];

	function findPreviousInProject(current: SessionSummary): string | undefined {
		const sameProject = sorted.filter(s => s.project === current.project && s.sessionId !== current.sessionId);
		const currentTime = new Date(current.lastActiveAt).getTime();
		const older = sameProject.filter(s => new Date(s.lastActiveAt).getTime() < currentTime);
		if (older.length === 0) return undefined;
		older.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
		return older[0].sessionId;
	}

	// IntersectionObserver for infinite scroll
	$effect(() => {
		if (!sentinel) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasMore) {
					visibleCount += 50;
				}
			},
			{ rootMargin: '200px' }
		);

		observer.observe(sentinel);

		return () => observer.disconnect();
	});
</script>

<div class="space-y-4">
	<div class="relative">
		<input
			type="text"
			placeholder="Search sessions by project, slug..."
			bind:value={search}
			class="w-full bg-surface-900 border border-surface-800 rounded-lg px-4 py-2.5 text-sm text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-surface-600 transition-colors"
		/>
		{#if search}
			<button
				onclick={() => (search = '')}
				class="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
			>
				&#10005;
			</button>
		{/if}
	</div>

	<div class="flex flex-wrap items-center gap-1.5">
		{#each sortOptions as { key, label }}
			<button
				onclick={() => setSort(key)}
				class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors {sortBy === key
					? 'bg-surface-800 text-surface-200'
					: 'text-surface-500 hover:text-surface-300'}"
			>
				{label}
				{#if sortBy === key}
					<span class="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
				{/if}
			</button>
		{/each}

		<span class="text-surface-700 mx-1">|</span>

		<button
			onclick={() => (showFilters = !showFilters)}
			class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors
				{showFilters || activeFilterCount > 0 ? 'bg-surface-800 text-surface-200' : 'text-surface-500 hover:text-surface-300'}"
		>
			Filters{#if activeFilterCount > 0}&nbsp;<span class="bg-blue-500/30 text-blue-400 rounded-full px-1.5 text-[10px]">{activeFilterCount}</span>{/if}
		</button>

		{#if activeFilterCount > 0}
			<button onclick={clearAllFilters} class="text-[10px] text-surface-500 hover:text-surface-300">Clear all</button>
		{/if}
	</div>

	<!-- Advanced filters panel -->
	{#if showFilters}
		<div class="bg-surface-900 border border-surface-800 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
			<!-- Provider -->
			<div>
				<label class="text-[10px] text-surface-500 uppercase tracking-wider block mb-1">Provider</label>
				<select
					bind:value={providerFilter}
					class="w-full bg-surface-950 border border-surface-800 rounded px-2 py-1.5 text-xs text-surface-200 focus:outline-none focus:border-surface-600"
				>
					<option value="all">All providers</option>
					{#each availableProviders as p}
						<option value={p}>{{ 'claude-code': 'Claude Code', cursor: 'Cursor', windsurf: 'Windsurf', aider: 'Aider', copilot: 'Copilot' }[p] || p}</option>
					{/each}
				</select>
			</div>

			<!-- Model -->
			<div>
				<label class="text-[10px] text-surface-500 uppercase tracking-wider block mb-1">Model</label>
				<select
					bind:value={modelFilter}
					class="w-full bg-surface-950 border border-surface-800 rounded px-2 py-1.5 text-xs text-surface-200 focus:outline-none focus:border-surface-600"
				>
					<option value="all">All models</option>
					{#each availableModels as m}
						<option value={m}>{m}</option>
					{/each}
				</select>
			</div>

			<!-- Cost range -->
			<div>
				<label class="text-[10px] text-surface-500 uppercase tracking-wider block mb-1">Cost ($)</label>
				<div class="flex items-center gap-1">
					<input
						bind:value={minCost}
						type="number"
						step="0.01"
						min="0"
						placeholder="Min"
						class="w-full bg-surface-950 border border-surface-800 rounded px-2 py-1.5 text-xs text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-surface-600"
					/>
					<span class="text-surface-600 text-xs">–</span>
					<input
						bind:value={maxCost}
						type="number"
						step="0.01"
						min="0"
						placeholder="Max"
						class="w-full bg-surface-950 border border-surface-800 rounded px-2 py-1.5 text-xs text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-surface-600"
					/>
				</div>
			</div>

			<!-- Date range -->
			<div>
				<label class="text-[10px] text-surface-500 uppercase tracking-wider block mb-1">Period</label>
				<select
					bind:value={dateRange}
					class="w-full bg-surface-950 border border-surface-800 rounded px-2 py-1.5 text-xs text-surface-200 focus:outline-none focus:border-surface-600"
				>
					<option value="all">All time</option>
					<option value="1d">Last 24h</option>
					<option value="7d">Last 7 days</option>
					<option value="30d">Last 30 days</option>
					<option value="90d">Last 90 days</option>
				</select>
			</div>

			<!-- Errors toggle -->
			<div>
				<label class="text-[10px] text-surface-500 uppercase tracking-wider block mb-1">Errors</label>
				<button
					onclick={() => (hasErrors = !hasErrors)}
					class="w-full text-left px-2 py-1.5 rounded text-xs border transition-colors
						{hasErrors ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-surface-950 border-surface-800 text-surface-400 hover:text-surface-200'}"
				>
					{hasErrors ? 'With errors only' : 'All sessions'}
				</button>
			</div>
		</div>
	{/if}

	<div class="flex items-center justify-between mb-1">
		<div class="text-xs text-surface-500">
			{#if hasMore}
				Showing {visibleCount} of {sorted.length} sessions
			{:else}
				{sorted.length} session{sorted.length !== 1 ? 's' : ''}
			{/if}
			{#if filtered.length > 0}
				<span class="text-surface-600 ml-2">
					{formatCost(filteredStats.totalCost)} total
					{#if filteredStats.totalErrors > 0}
						· <span class="text-amber-400">{filteredStats.totalErrors} errors</span>
					{/if}
				</span>
			{/if}
		</div>
		{#if compareMode}
			<div class="flex items-center gap-2">
				{#if compareUrl}
					<a href={compareUrl} class="px-3 py-1.5 text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors">
						Compare ({compareSelection.length}/2)
					</a>
				{:else}
					<span class="text-xs text-surface-500">Select {2 - compareSelection.length} session{compareSelection.length === 0 ? 's' : ''}</span>
				{/if}
				<button onclick={() => { compareMode = false; compareSelection = []; }} class="text-xs text-surface-500 hover:text-surface-300">Cancel</button>
			</div>
		{:else}
			<button
				onclick={() => (compareMode = true)}
				class="px-3 py-1.5 text-xs font-medium text-surface-300 hover:text-surface-100 bg-surface-900 border border-surface-700 hover:border-surface-500 rounded-lg transition-colors"
			>Compare sessions</button>
		{/if}
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
		{#each visibleSessions as session (session.sessionId)}
			{#if compareMode}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					onclick={(e) => { e.preventDefault(); toggleCompare(session.sessionId); }}
					class="cursor-pointer rounded-lg transition-all {compareSelection.includes(session.sessionId) ? 'ring-2 ring-blue-500' : 'hover:ring-1 hover:ring-surface-600'}"
					role="button"
					tabindex="0"
				>
					<div class="pointer-events-none">
						<SessionCard {session} previousSessionId={findPreviousInProject(session)} />
					</div>
				</div>
			{:else}
				<SessionCard {session} previousSessionId={findPreviousInProject(session)} />
			{/if}
		{/each}

		{#if filtered.length === 0}
			<div class="col-span-full">
				{#if search}
					<EmptyState
						icon="search"
						title="No matching sessions"
						message={`No sessions found matching "${search}". Try a different search term or clear the filter.`}
					/>
				{:else if sessions.length === 0}
					<EmptyState
						icon="sessions"
						title="No sessions found"
						message="Agent Replay discovers sessions from Claude Code (~/.claude/projects/), Cursor, Windsurf, Copilot, and Aider. Make sure you have session data from at least one provider."
						action={{ label: 'View Insights', href: '/' }}
					/>
				{:else}
					<EmptyState
						icon="inbox"
						title="No sessions match the current filters"
						message="Try adjusting your filters or clearing them."
					/>
				{/if}
			</div>
		{/if}

		<!-- Sentinel for infinite scroll -->
		{#if hasMore}
			<div bind:this={sentinel} class="h-1"></div>
		{/if}
	</div>
</div>
