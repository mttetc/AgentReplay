<script lang="ts">
	import type { SessionSummary } from '$lib/types/timeline';
	import type { ProviderType } from '$lib/server/providers/types';
	import { shortModel } from '$lib/utils/format';
	import SessionCard from './SessionCard.svelte';

	let { sessions }: { sessions: SessionSummary[] } = $props();
	let search = $state('');
	let compareMode = $state(false);
	let compareSelection = $state<string[]>([]);

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

	let availableProviders = $derived(
		[...new Set(sessions.map((s) => s.provider).filter(Boolean))] as ProviderType[]
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

	let filtered = $derived(
		sessions.filter((s) => {
			if (providerFilter !== 'all' && s.provider !== providerFilter) return false;
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

		{#if availableProviders.length > 1}
			<span class="text-surface-700 mx-1">|</span>
			<button
				onclick={() => (providerFilter = 'all')}
				class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors {providerFilter === 'all'
					? 'bg-surface-800 text-surface-200'
					: 'text-surface-500 hover:text-surface-300'}"
			>All</button>
			{#each availableProviders as p}
				<button
					onclick={() => (providerFilter = p)}
					class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors {providerFilter === p
						? 'bg-surface-800 text-surface-200'
						: 'text-surface-500 hover:text-surface-300'}"
				>{p === 'claude-code' ? 'Claude Code' : p === 'cursor' ? 'Cursor' : 'Windsurf'}</button>
			{/each}
		{/if}
	</div>

	<div class="flex items-center justify-between mb-1">
		<div class="text-xs text-surface-500">
			{#if hasMore}
				Showing {visibleCount} of {sorted.length} sessions
			{:else}
				{sorted.length} session{sorted.length !== 1 ? 's' : ''}
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
						<SessionCard {session} />
					</div>
				</div>
			{:else}
				<SessionCard {session} />
			{/if}
		{/each}

		{#if filtered.length === 0}
			<div class="text-center py-12 text-surface-500">
				{#if search}
					No sessions matching "{search}"
				{:else}
					No sessions found. Make sure Claude Code sessions exist in ~/.claude/projects/
				{/if}
			</div>
		{/if}

		<!-- Sentinel for infinite scroll -->
		{#if hasMore}
			<div bind:this={sentinel} class="h-1"></div>
		{/if}
	</div>
</div>
