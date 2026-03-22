<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { formatCost, formatDate } from '$lib/utils/format';
	import type { FileInsight, ProjectInsight, DirectoryInsight } from '$lib/server/codebase-analysis';
	import InsightsHero from '../components/InsightsHero.svelte';
	import ToolAnalytics from '../components/ToolAnalytics.svelte';

	let { data } = $props();
	let a = $derived(data.analysis);

	// Tab state — derived from URL hash or default
	let tab: 'overview' | 'tools' | 'explorer' = $state('overview');

	// Build URL from state
	function buildUrl(params: Record<string, string | undefined>) {
		const u = new URLSearchParams();
		if (data.range !== '30d') u.set('range', data.range);
		for (const [k, v] of Object.entries(params)) {
			if (v) u.set(k, v);
		}
		const qs = u.toString();
		return qs ? `/?${qs}` : '/';
	}

	function setRange(range: string) {
		goto(range === '30d' ? '/' : `/?range=${range}`, { invalidateAll: true });
	}

	// Explorer navigation
	function goProjects() { goto(buildUrl({})); tab = 'explorer'; }
	function goProject(p: ProjectInsight) { goto(buildUrl({ project: p.project })); tab = 'explorer'; }
	function goDir(p: ProjectInsight, d: DirectoryInsight) { goto(buildUrl({ project: p.project, dir: d.dir })); tab = 'explorer'; }
	function goFile(p: ProjectInsight, d: DirectoryInsight, f: FileInsight) { goto(buildUrl({ project: p.project, dir: d.dir, file: f.path })); tab = 'explorer'; }

	type View =
		| { level: 'projects' }
		| { level: 'directories'; project: ProjectInsight }
		| { level: 'files'; project: ProjectInsight; dir: DirectoryInsight }
		| { level: 'file'; project: ProjectInsight; dir: DirectoryInsight; file: FileInsight };

	let view: View = $derived.by(() => {
		const params = page.url.searchParams;
		const projectName = params.get('project');
		const dirName = params.get('dir');
		const filePath = params.get('file');

		if (!projectName) return { level: 'projects' };
		const project = a.projects.find((p) => p.project === projectName);
		if (!project) return { level: 'projects' };
		if (!dirName) return { level: 'directories', project };
		const dir = project.directories.find((d) => d.dir === dirName);
		if (!dir) return { level: 'directories', project };
		if (!filePath) return { level: 'files', project, dir };
		const file = dir.files.find((f) => f.path === filePath);
		if (!file) return { level: 'files', project, dir };
		return { level: 'file', project, dir, file };
	});

	// Auto-switch to explorer tab when navigating into a project
	$effect(() => {
		if (view.level !== 'projects') tab = 'explorer';
	});

	let search = $state('');
	let sortBy: 'cost' | 'errors' | 'loops' | 'sessions' | 'difficulty' = $state('cost');
	let sortDir: 'asc' | 'desc' = $state('desc');
	let visibleCount = $state(30);
	let sentinel: HTMLDivElement | undefined = $state();

	function setSort(key: typeof sortBy) {
		if (sortBy === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else { sortBy = key; sortDir = 'desc'; }
		visibleCount = 30;
	}

	let filteredProjects = $derived.by(() => {
		let items = a.projects;
		if (search) {
			const q = search.toLowerCase();
			items = items.filter((p) => p.project.toLowerCase().includes(q));
		}
		return [...items].sort((a, b) => {
			let cmp = 0;
			switch (sortBy) {
				case 'cost': cmp = a.totalCost - b.totalCost; break;
				case 'errors': cmp = a.errorCount - b.errorCount; break;
				case 'loops': cmp = a.loopCount - b.loopCount; break;
				case 'sessions': cmp = a.sessionCount - b.sessionCount; break;
				case 'difficulty': cmp = (a.topFiles[0]?.difficultyScore || 0) - (b.topFiles[0]?.difficultyScore || 0); break;
			}
			return sortDir === 'asc' ? cmp : -cmp;
		});
	});

	let filteredDirs = $derived.by(() => {
		if (view.level !== 'directories') return [];
		let items = view.project.directories;
		if (search) {
			const q = search.toLowerCase();
			items = items.filter((d) => d.dir.toLowerCase().includes(q));
		}
		return [...items].sort((a, b) => {
			const cmp = sortBy === 'errors' ? a.errors - b.errors : sortBy === 'loops' ? a.loops - b.loops : a.cost - b.cost;
			return sortDir === 'asc' ? cmp : -cmp;
		});
	});

	let filteredFiles = $derived.by(() => {
		if (view.level !== 'files') return [];
		let items = view.dir.files;
		if (search) {
			const q = search.toLowerCase();
			items = items.filter((f) => f.path.toLowerCase().includes(q));
		}
		return [...items].sort((a, b) => {
			const cmp = sortBy === 'errors' ? a.errors - b.errors : sortBy === 'difficulty' ? a.difficultyScore - b.difficultyScore : a.totalCost - b.totalCost;
			return sortDir === 'asc' ? cmp : -cmp;
		});
	});

	let visibleProjects = $derived(filteredProjects.slice(0, visibleCount));
	let visibleDirs = $derived(filteredDirs.slice(0, visibleCount));
	let visibleFiles = $derived(filteredFiles.slice(0, visibleCount));
	let totalCount = $derived(
		view.level === 'projects' ? filteredProjects.length :
		view.level === 'directories' ? filteredDirs.length :
		view.level === 'files' ? filteredFiles.length : 0
	);
	let hasMore = $derived(visibleCount < totalCount);

	function difficultyColor(score: number): string {
		return score >= 60 ? 'text-red-400' : score >= 30 ? 'text-amber-400' : 'text-surface-400';
	}

	function verdictStyle(v: string): string {
		if (v === 'wasteful' || v === 'loops') return 'bg-red-500/15 text-red-400 border-red-500/20';
		if (v === 'errors') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
		return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
	}

	function shortProject(p: string): string {
		const parts = p.split('/');
		return parts[parts.length - 1] || p;
	}

	function relativeDir(dir: string): string {
		const parts = dir.split('/');
		return parts.slice(-3).join('/') || dir;
	}

	let expandedPattern: string | null = $state(null);

	let breadcrumbs = $derived(buildBreadcrumbs());

	function buildBreadcrumbs(): Array<{ label: string; action?: () => void; mono?: boolean }> {
		const crumbs: Array<{ label: string; action?: () => void; mono?: boolean }> = [];
		if (view.level === 'projects') {
			crumbs.push({ label: 'Projects' });
		} else {
			crumbs.push({ label: 'Projects', action: goProjects });
		}
		if ('project' in view) {
			if (view.level === 'directories') {
				crumbs.push({ label: shortProject(view.project.project) });
			} else {
				crumbs.push({ label: shortProject(view.project.project), action: () => { if ('project' in view) goProject(view.project); } });
			}
		}
		if ('dir' in view) {
			if (view.level === 'files') {
				crumbs.push({ label: relativeDir(view.dir.dir) });
			} else {
				crumbs.push({ label: relativeDir(view.dir.dir), action: () => { if ('project' in view && 'dir' in view) goDir(view.project, view.dir); } });
			}
		}
		if (view.level === 'file') {
			crumbs.push({ label: view.file.path.split('/').pop() || view.file.shortPath, mono: true });
		}
		return crumbs;
	}

	// Infinite scroll
	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting && hasMore) visibleCount += 30;
		}, { rootMargin: '200px' });
		observer.observe(sentinel);
		return () => observer.disconnect();
	});

	// Reset on view change
	$effect(() => {
		view;
		search = '';
		visibleCount = 30;
	});

	const sortOptions = [
		{ key: 'cost' as const, label: 'Cost' },
		{ key: 'errors' as const, label: 'Errors' },
		{ key: 'loops' as const, label: 'Loops' },
		{ key: 'sessions' as const, label: 'Sessions' },
		{ key: 'difficulty' as const, label: 'Difficulty' }
	];

	const tabs = [
		{ key: 'overview' as const, label: 'Overview' },
		{ key: 'tools' as const, label: 'Tools' },
		{ key: 'explorer' as const, label: 'Explorer' }
	];
</script>

<svelte:head><title>agent replay</title></svelte:head>

<div class="px-4 py-4 sm:px-6 sm:py-5">
	<!-- Global header: time filter + summary -->
	<div class="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4">
		<div class="flex gap-1">
			{#each [['7d', '7d'], ['30d', '30d'], ['90d', '90d'], ['all', 'All']] as [key, label]}
				<button onclick={() => setRange(key)}
					class="px-2.5 py-1 rounded text-[11px] font-medium transition-colors
						{data.range === key ? 'bg-surface-800 text-surface-200' : 'text-surface-500 hover:text-surface-300'}"
				>{label}</button>
			{/each}
		</div>
		<span class="text-xs text-surface-400">
			{a.totals.sessionsAnalyzed} sessions ·
			<span class="text-emerald-400">{formatCost(a.totals.totalCost)}</span> spent
			{#if a.totals.estimatedWaste > 0} · <span class="text-red-400">{formatCost(a.totals.estimatedWaste)}</span> wasted{/if}
			{#if a.totals.totalErrors > 0} · <span class="text-amber-400">{a.totals.totalErrors}</span> errors{/if}
			{#if a.totals.totalLoops > 0} · <span class="text-red-400">{a.totals.totalLoops}</span> loops{/if}
		</span>
	</div>

	<!-- Tab bar -->
	<div class="flex items-center gap-1 border-b border-surface-800 mb-5">
		{#each tabs as t}
			<button
				onclick={() => { tab = t.key; if (t.key === 'explorer' && view.level !== 'projects') goProjects(); }}
				class="px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
					{tab === t.key ? 'text-surface-100 border-blue-500' : 'text-surface-500 hover:text-surface-300 border-transparent'}"
			>{t.label}</button>
		{/each}
	</div>

	<!-- TAB: Overview -->
	{#if tab === 'overview'}
		<InsightsHero analysis={a} />

		<!-- Recent sessions -->
		{#if a.recentSessions.length > 0}
			<div class="mb-6">
				<div class="flex items-center justify-between mb-3">
					<span class="text-xs text-surface-400 font-medium">Recent sessions</span>
					<a href="/sessions" class="text-xs text-surface-500 hover:text-blue-400 transition-colors">All sessions &#x203A;</a>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
					{#each a.recentSessions as s}
						<a href="/sessions/{s.sessionId}?project={encodeURIComponent(s.project)}"
							class="bg-surface-900 border border-surface-800 rounded-lg px-3 py-2.5 hover:border-surface-600 transition-colors block">
							<div class="flex items-center justify-between mb-1">
								<span class="text-surface-200 text-xs font-medium truncate flex-1">{s.slug || s.sessionId.slice(0, 8)}</span>
								<span class="border rounded text-[9px] px-1.5 py-0.5 font-medium {verdictStyle(s.verdict)}">{s.verdict}</span>
							</div>
							<div class="flex items-center gap-2 text-[10px] text-surface-400">
								<span>{formatDate(s.startedAt)}</span>
								<span class="text-emerald-400">{formatCost(s.cost)}</span>
								<span class="text-surface-500 truncate">{shortProject(s.project)}</span>
							</div>
						</a>
					{/each}
				</div>
			</div>
		{/if}

	<!-- TAB: Tools -->
	{:else if tab === 'tools'}
		{#if a.toolStats.length > 0}
			<ToolAnalytics tools={a.toolStats} />
		{:else}
			<div class="text-center py-16 text-surface-500 text-sm">No tool data available for this period.</div>
		{/if}

		<!-- Patterns -->
		{#if a.patterns.length > 0}
			<div class="mb-5">
				<div class="text-xs text-surface-400 font-medium mb-3">Detected patterns</div>
				<div class="flex flex-wrap gap-2">
					{#each a.patterns as p}
						{@const color = p.severity === 'critical' ? 'bg-red-500/10 text-red-400 border-red-500/20' : p.severity === 'warning' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}
						<button onclick={() => expandedPattern = expandedPattern === p.pattern ? null : p.pattern}
							class="border rounded-md px-2.5 py-1.5 text-left transition-all {color} {expandedPattern === p.pattern ? 'ring-1 ring-current' : ''}">
							<div class="flex items-center gap-2">
								<span class="font-semibold text-xs">{p.count}x</span>
								<span class="text-[11px]">{p.pattern.replace(/-/g, ' ')}</span>
							</div>
							{#if expandedPattern === p.pattern}
								<p class="text-[10px] opacity-70 mt-1">{p.description}</p>
								<p class="text-[10px] mt-1 font-medium">{p.recommendation}</p>
								<div class="flex flex-wrap gap-1 mt-1.5">
									{#each p.files as file}
										<span class="text-[9px] font-mono bg-black/20 rounded px-1.5 py-0.5">{file}</span>
									{/each}
								</div>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/if}

	<!-- TAB: Explorer -->
	{:else if tab === 'explorer'}
		<div class="bg-surface-900 border border-surface-800 rounded-lg overflow-hidden flex-1 flex flex-col min-h-0">
			<!-- Breadcrumb + search -->
			<div class="px-4 py-2.5 border-b border-surface-800 space-y-2">
				<nav class="flex items-center gap-1 text-xs overflow-x-auto">
					{#each breadcrumbs as crumb, i}
						{#if i > 0}<span class="text-surface-600 flex-shrink-0">/</span>{/if}
						{#if crumb.action}
							<button onclick={crumb.action} class="flex-shrink-0 transition-colors {i === breadcrumbs.length - 1 ? 'text-surface-200 font-medium' : 'text-surface-400 hover:text-blue-400'}">
								{crumb.label}
							</button>
						{:else}
							<span class="text-surface-200 font-medium flex-shrink-0 {crumb.mono ? 'font-mono' : ''}">{crumb.label}</span>
						{/if}
					{/each}
				</nav>

				{#if view.level !== 'file'}
					<input
						bind:value={search}
						type="text"
						placeholder="Filter..."
						class="w-full bg-surface-950 border border-surface-800 rounded px-3 py-1.5 text-xs text-surface-200 placeholder:text-surface-500 focus:outline-none focus:border-surface-600"
					/>
				{/if}
			</div>

			<!-- Table / Detail -->
			<div class="flex-1 overflow-y-auto">
			{#if view.level === 'file'}
				{@const f = view.file}
				<div class="px-4 py-4">
					<div class="flex items-center gap-3 mb-3">
						<span class="{difficultyColor(f.difficultyScore)} text-2xl font-bold" style="font-family: 'Space Grotesk', sans-serif;">{f.difficultyScore}</span>
						<div>
							<div class="text-surface-200 text-sm font-mono">{f.path}</div>
							<div class="text-surface-400 text-[10px]">{f.reads} reads · {f.writes + f.edits} edits · {f.errors} errors · {f.sessionCount} sessions</div>
						</div>
					</div>

					{#if f.recommendation}
						<div class="bg-amber-500/5 border border-amber-500/15 rounded-md px-3 py-2 mb-4">
							<p class="text-amber-400 text-xs">{f.recommendation}</p>
						</div>
					{/if}

					<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-2">Sessions</div>
					{#each [...f.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) as s}
						<a href="/sessions/{s.sessionId}?project={encodeURIComponent(s.project)}"
							class="flex items-center gap-3 py-2 border-t border-surface-800/30 hover:bg-surface-800/20 transition-colors text-xs">
							<span class="text-surface-200 truncate flex-1">{s.slug || s.sessionId.slice(0, 8)}</span>
							<span class="text-surface-500">{formatDate(s.startedAt)}</span>
							<span class="text-emerald-400">{formatCost(s.cost)}</span>
							<span class="text-surface-400">{s.ops} ops</span>
							{#if s.errors > 0}<span class="text-red-400">{s.errors} err</span>{/if}
						</a>
					{/each}
				</div>
			{:else}
				<!-- Sort header row -->
				<div class="explorer-row sticky top-0 bg-surface-900 z-10 border-b border-surface-800 text-xs px-4 py-2.5">
					<span class="text-surface-500 font-medium">Name</span>
					{#each sortOptions as { key, label }}
						<button onclick={() => setSort(key)} class="text-right transition-colors {key === 'loops' || key === 'difficulty' ? 'hidden sm:block' : ''} {sortBy === key ? 'text-surface-200' : 'text-surface-500 hover:text-surface-300'}">
							{label}{#if sortBy === key} {sortDir === 'asc' ? '\u2191' : '\u2193'}{/if}
						</button>
					{/each}
					<span></span>
				</div>

				{#if view.level === 'projects'}
					{#if filteredProjects.length === 0}
						<div class="px-4 py-8 text-surface-500 text-sm text-center">{search ? 'No match' : 'No data'}</div>
					{/if}
					{#each visibleProjects as proj (proj.project)}
						<button onclick={() => goProject(proj)} class="explorer-row w-full text-left px-4 py-3 hover:bg-surface-800/30 transition-colors border-b border-surface-800/30 text-xs">
							<span class="text-surface-100 font-medium text-sm font-mono truncate">{shortProject(proj.project)}</span>
							<span class="text-right text-emerald-400 whitespace-nowrap">{formatCost(proj.totalCost)}</span>
							<span class="text-right {proj.errorCount > 0 ? 'text-amber-400' : 'text-surface-500'}">{proj.errorCount}</span>
							<span class="text-right hidden sm:block {proj.loopCount > 0 ? 'text-red-400' : 'text-surface-500'}">{proj.loopCount}</span>
							<span class="text-right text-surface-400">{proj.sessionCount}</span>
							<span class="text-right hidden sm:block {difficultyColor(proj.topFiles[0]?.difficultyScore || 0)}">{proj.topFiles[0]?.difficultyScore || '\u2014'}</span>
							<span class="text-right text-surface-600">&#x203A;</span>
						</button>
					{/each}
				{:else if view.level === 'directories'}
					{#each visibleDirs as dir (dir.dir)}
						<button onclick={() => { if ('project' in view) goDir(view.project, dir); }} class="explorer-row w-full text-left px-4 py-3 hover:bg-surface-800/30 transition-colors border-b border-surface-800/30 text-xs">
							<span class="text-surface-200 text-sm font-mono truncate">{relativeDir(dir.dir)}/</span>
							<span class="text-right text-emerald-400 whitespace-nowrap">{formatCost(dir.cost)}</span>
							<span class="text-right {dir.errors > 0 ? 'text-amber-400' : 'text-surface-500'}">{dir.errors}</span>
							<span class="text-right hidden sm:block {dir.loops > 0 ? 'text-red-400' : 'text-surface-500'}">{dir.loops}</span>
							<span class="text-right text-surface-400">{dir.fileCount}</span>
							<span class="text-right hidden sm:block text-surface-500">\u2014</span>
							<span class="text-right text-surface-600">&#x203A;</span>
						</button>
					{/each}
				{:else if view.level === 'files'}
					{#each visibleFiles as file (file.path)}
						<button onclick={() => { if (view.level === 'files') goFile(view.project, view.dir, file); }} class="explorer-row w-full text-left px-4 py-3 hover:bg-surface-800/30 transition-colors border-b border-surface-800/30 text-xs">
							<span class="text-surface-200 text-sm font-mono truncate">{file.path.split('/').pop()}</span>
							<span class="text-right text-emerald-400 whitespace-nowrap">{formatCost(file.totalCost)}</span>
							<span class="text-right {file.errors > 0 ? 'text-amber-400' : 'text-surface-500'}">{file.errors}</span>
							<span class="text-right hidden sm:block {file.loopSessions > 0 ? 'text-red-400' : 'text-surface-500'}">{file.loopSessions}</span>
							<span class="text-right text-surface-400">{file.sessionCount}</span>
							<span class="text-right hidden sm:block {difficultyColor(file.difficultyScore)} font-semibold">{file.difficultyScore}</span>
							<span class="text-right text-surface-600">&#x203A;</span>
						</button>
					{/each}
				{/if}
				{#if hasMore}
					<div bind:this={sentinel} class="h-1"></div>
				{/if}
			{/if}
			</div>

			{#if totalCount > 0 && view.level !== 'file'}
				<div class="px-4 py-2 border-t border-surface-800 text-[10px] text-surface-500">
					{#if hasMore}
						{visibleCount} of {totalCount}
					{:else}
						{totalCount} total
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.explorer-row {
		display: grid;
		grid-template-columns: 1fr 5rem 4rem 4rem 4rem 4rem 1.5rem;
		align-items: center;
		gap: 0;
	}
	@media (max-width: 639px) {
		.explorer-row {
			grid-template-columns: 1fr 5rem 4rem 4rem 1.5rem;
		}
	}
</style>
