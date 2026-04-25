<script lang="ts">
	import type { EventType, TimelineEvent, SessionTimeline } from '$lib/types/timeline';
	import type { GitCommit } from '$lib/server/git-integration';
	import { toMarkdown, toJSON, downloadFile } from '$lib/utils/export';
	import { toStaticHTML } from '$lib/utils/export-html';
	import { browser } from '$app/environment';
	import { PaneGroup, Pane, PaneResizer } from 'paneforge';
	import Timeline from '../../../components/Timeline.svelte';
	import DetailPanel from '../../../components/DetailPanel.svelte';
	import PlaybackControls from '../../../components/PlaybackControls.svelte';
	import StatsBar from '../../../components/StatsBar.svelte';
	import FileTree from '../../../components/FileTree.svelte';
	import { getSessionAnnotations } from '$lib/stores/annotations.svelte';
	import GitCommits from '../../../components/GitCommits.svelte';
	import SessionTags from '../../../components/SessionTags.svelte';
	import SessionOverhead from '../../../components/SessionOverhead.svelte';
	import type { SessionOverhead as SessionOverheadType } from '$lib/server/overhead-analysis';

	let { data }: { data: { timeline: SessionTimeline; commits: GitCommit[]; overhead: SessionOverheadType | null } } = $props();
	let showOverhead = $state(false);

	let sessionId = $derived(data.timeline.summary.sessionId);
	let displayProject = $derived(data.timeline.summary.cwd || data.timeline.summary.project);
	let annotatedEventIds = $derived(new Set(getSessionAnnotations(sessionId).keys()));
	let sidebarTab: 'timeline' | 'files' = $state('timeline');

	let selectedIndex = $state(0);
	let isPlaying = $state(false);
	let speed = $state(1);
	let playInterval: ReturnType<typeof setInterval> | null = null;
	let timelineRef: Timeline | undefined = $state();
	let mobileTab: 'timeline' | 'details' = $state('timeline');

	// Search & filter state
	let searchQuery = $state('');
	let typeFilter: EventType | 'all' = $state('all');
	let toolFilter = $state('all');
	let searchInputEl: HTMLInputElement | undefined = $state();
	let showExportMenu = $state(false);
	let showShortcuts = $state(false);
	let copyFeedback = $state('');


	const eventTypes: { key: EventType | 'all'; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'user_message', label: 'User' },
		{ key: 'assistant_text', label: 'Claude' },
		{ key: 'thinking', label: 'Thinking' },
		{ key: 'tool_call', label: 'Tools' },
		{ key: 'system', label: 'System' }
	];

	// Extract unique tool names from events
	let toolNames = $derived(
		[...new Set(
			data.timeline.events
				.filter((e): e is TimelineEvent & { data: { eventType: 'tool_call'; toolName: string } } =>
					e.data.eventType === 'tool_call'
				)
				.map((e) => e.data.toolName)
		)].sort()
	);

	function getSearchableText(event: TimelineEvent): string {
		const d = event.data;
		switch (d.eventType) {
			case 'user_message':
				return d.text;
			case 'assistant_text':
				return d.text;
			case 'thinking':
				return d.thinking;
			case 'tool_call': {
				const parts = [d.toolName, JSON.stringify(d.input)];
				if (d.result) parts.push(d.result.content);
				return parts.join(' ');
			}
			case 'system':
				return d.subtype;
			default:
				return '';
		}
	}

	// Compute which indices match the current search/filter
	let matchedIndices = $derived.by(() => {
		const matched = new Set<number>();
		const q = searchQuery.toLowerCase();
		const allEvents = data.timeline.events;

		for (let i = 0; i < allEvents.length; i++) {
			const event = allEvents[i];
			// Type filter
			if (typeFilter !== 'all' && event.data.eventType !== typeFilter) continue;
			// Tool sub-filter
			if (toolFilter !== 'all' && event.data.eventType === 'tool_call' && event.data.toolName !== toolFilter) continue;
			if (toolFilter !== 'all' && event.data.eventType !== 'tool_call') continue;
			// Text search
			if (q && !getSearchableText(event).toLowerCase().includes(q)) continue;
			matched.add(i);
		}
		return matched;
	});

	let isFiltering = $derived(searchQuery !== '' || typeFilter !== 'all' || toolFilter !== 'all');

	// Filtered events for the timeline (only show matching events when filtering)
	let displayEvents = $derived(
		isFiltering
			? data.timeline.events.filter((_, i) => matchedIndices.has(i))
			: data.timeline.events
	);

	// Map from display index to real index
	let displayToRealIndex = $derived.by(() => {
		if (!isFiltering) return null;
		const map = new Map<number, number>();
		let displayIdx = 0;
		for (let i = 0; i < data.timeline.events.length; i++) {
			if (matchedIndices.has(i)) {
				map.set(displayIdx, i);
				displayIdx++;
			}
		}
		return map;
	});

	// Reverse map: real index to display index
	let realToDisplayIndex = $derived.by(() => {
		if (!displayToRealIndex) return null;
		const map = new Map<number, number>();
		for (const [d, r] of displayToRealIndex) {
			map.set(r, d);
		}
		return map;
	});

	let selectedEvent = $derived(data.timeline.events[selectedIndex] || null);

	// Display index for the timeline component
	let displaySelectedIndex = $derived(
		realToDisplayIndex ? (realToDisplayIndex.get(selectedIndex) ?? -1) : selectedIndex
	);

	function goTo(index: number) {
		if (index < 0 || index >= data.timeline.events.length) return;
		selectedIndex = index;
		// Scroll to the display index in the timeline
		const displayIdx = realToDisplayIndex ? realToDisplayIndex.get(index) : index;
		if (displayIdx !== undefined) {
			timelineRef?.scrollToEvent(displayIdx);
		}
		mobileTab = 'details';
	}

	function handleTimelineSelect(displayIndex: number) {
		const realIndex = displayToRealIndex ? (displayToRealIndex.get(displayIndex) ?? displayIndex) : displayIndex;
		goTo(realIndex);
	}

	function prev() {
		if (isFiltering) {
			// Jump to previous match
			const sorted = [...matchedIndices].sort((a, b) => a - b);
			const prevMatch = sorted.reverse().find((i) => i < selectedIndex);
			if (prevMatch !== undefined) goTo(prevMatch);
		} else {
			goTo(selectedIndex - 1);
		}
	}

	function next() {
		if (isFiltering) {
			// Jump to next match
			const sorted = [...matchedIndices].sort((a, b) => a - b);
			const nextMatch = sorted.find((i) => i > selectedIndex);
			if (nextMatch !== undefined) goTo(nextMatch);
			else stopPlayback();
		} else {
			if (selectedIndex >= data.timeline.events.length - 1) {
				stopPlayback();
				return;
			}
			goTo(selectedIndex + 1);
		}
	}

	function togglePlay() {
		if (isPlaying) {
			stopPlayback();
		} else {
			startPlayback();
		}
	}

	function startPlayback() {
		if (selectedIndex >= data.timeline.events.length - 1) {
			selectedIndex = 0;
		}
		isPlaying = true;
		playInterval = setInterval(() => {
			if (selectedIndex >= data.timeline.events.length - 1) {
				stopPlayback();
				return;
			}
			next();
		}, 1000 / speed);
	}

	function stopPlayback() {
		isPlaying = false;
		if (playInterval) {
			clearInterval(playInterval);
			playInterval = null;
		}
	}

	function setSpeed(s: number) {
		speed = s;
		if (isPlaying) {
			stopPlayback();
			startPlayback();
		}
	}

	function clearFilters() {
		searchQuery = '';
		typeFilter = 'all';
		toolFilter = 'all';
	}

	// Export functions
	async function copyMarkdown() {
		const md = toMarkdown(data.timeline);
		await navigator.clipboard.writeText(md);
		copyFeedback = 'Copied!';
		showExportMenu = false;
		setTimeout(() => (copyFeedback = ''), 2000);
	}

	function downloadMarkdownFile() {
		const md = toMarkdown(data.timeline);
		const slug = data.timeline.summary.slug || data.timeline.summary.sessionId.slice(0, 8);
		downloadFile(md, `${slug}.md`, 'text/markdown');
		showExportMenu = false;
	}

	function downloadJSONFile() {
		const json = toJSON(data.timeline);
		const slug = data.timeline.summary.slug || data.timeline.summary.sessionId.slice(0, 8);
		downloadFile(json, `${slug}.json`, 'application/json');
		showExportMenu = false;
	}

	function downloadHTMLFile() {
		const html = toStaticHTML(data.timeline);
		const slug = data.timeline.summary.slug || data.timeline.summary.sessionId.slice(0, 8);
		downloadFile(html, `${slug}.html`, 'text/html');
		showExportMenu = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

		switch (e.key) {
			case 'ArrowLeft':
				e.preventDefault();
				prev();
				break;
			case 'ArrowRight':
				e.preventDefault();
				next();
				break;
			case ' ':
				e.preventDefault();
				togglePlay();
				break;
		}
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		// Cmd+F / Ctrl+F to focus search
		if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
			e.preventDefault();
			searchInputEl?.focus();
		}
		// Escape to clear search when focused
		if (e.key === 'Escape' && document.activeElement === searchInputEl) {
			clearFilters();
			searchInputEl?.blur();
		}
	}

	function goBackToTimeline() {
		mobileTab = 'timeline';
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
	<title>{data.timeline.summary.slug || data.timeline.summary.sessionId.slice(0, 8)}</title>
</svelte:head>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="h-[calc(100vh-3.5rem-2px)] flex flex-col" onkeydown={handleKeydown} role="main">
	<!-- Top bar: stats + playback + search -->
	<div class="border-b border-surface-800 bg-surface-900/50 px-3 sm:px-4 py-2 space-y-2">
		<div class="flex items-center gap-3">
			<a href="/sessions" class="text-surface-400 hover:text-blue-400 transition-colors text-xs">
				&#8592; Sessions
			</a>
			<span class="text-surface-700">|</span>
			<h1 class="text-surface-100 text-sm font-medium truncate">
				{data.timeline.summary.slug || data.timeline.summary.sessionId.slice(0, 8)}
			</h1>
			<div class="flex-shrink-0" onclick={(e) => e.stopPropagation()}>
				<SessionTags sessionId={data.timeline.summary.sessionId} />
			</div>
			<span class="text-surface-500 text-xs truncate hidden sm:inline ml-auto" title={displayProject}>
				{displayProject.split('/').slice(-2).join('/')}
			</span>
			{#if data.timeline.summary.gitBranch}
				<span class="text-surface-400 text-xs font-mono bg-surface-800/50 px-2 py-0.5 rounded">
					{data.timeline.summary.gitBranch}
				</span>
			{/if}

			<!-- Export -->
			<div class="relative">
				<button
					onclick={() => (showExportMenu = !showExportMenu)}
					class="flex items-center gap-1.5 text-surface-200 text-xs font-medium px-3 py-1.5 rounded-lg bg-surface-800 border border-surface-700 hover:border-surface-500 hover:text-surface-100 transition-colors"
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
					{copyFeedback || 'Export'}
				</button>
				{#if showExportMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="absolute right-0 top-full mt-2 bg-surface-900 border border-surface-800 rounded-lg shadow-xl z-50 p-3 min-w-[240px]"
						onmouseleave={() => (showExportMenu = false)}
					>
						<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-2">Download</div>
						<div class="flex gap-2 mb-3">
							<button onclick={downloadHTMLFile} class="flex-1 py-3 bg-surface-800 border border-surface-700 rounded-lg text-center hover:border-surface-600 transition-colors">
								<div class="text-surface-200 font-semibold text-sm" style="font-family: 'JetBrains Mono', monospace;">.html</div>
								<div class="text-[10px] text-surface-500 mt-0.5">Shareable</div>
							</button>
							<button onclick={downloadMarkdownFile} class="flex-1 py-3 bg-surface-800 border border-surface-700 rounded-lg text-center hover:border-surface-600 transition-colors">
								<div class="text-surface-200 font-semibold text-sm" style="font-family: 'JetBrains Mono', monospace;">.md</div>
								<div class="text-[10px] text-surface-500 mt-0.5">Markdown</div>
							</button>
							<button onclick={downloadJSONFile} class="flex-1 py-3 bg-surface-800 border border-surface-700 rounded-lg text-center hover:border-surface-600 transition-colors">
								<div class="text-surface-200 font-semibold text-sm" style="font-family: 'JetBrains Mono', monospace;">.json</div>
								<div class="text-[10px] text-surface-500 mt-0.5">JSON</div>
							</button>
						</div>
						<button onclick={copyMarkdown} class="w-full text-center px-3 py-2 text-xs text-surface-400 hover:text-surface-200 bg-surface-800/50 border border-surface-800 rounded-lg hover:border-surface-700 transition-colors">
							Copy as Markdown
						</button>
					</div>
				{/if}
			</div>

			<!-- Keyboard shortcuts -->
			<div class="relative">
				<button
					onclick={() => (showShortcuts = !showShortcuts)}
					class="text-surface-500 hover:text-surface-300 text-xs font-medium w-7 h-7 rounded-lg border border-surface-700 hover:border-surface-500 transition-colors flex items-center justify-center"
					title="Keyboard shortcuts"
				>?</button>
				{#if showShortcuts}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="absolute right-0 top-full mt-2 bg-surface-900 border border-surface-800 rounded-lg shadow-xl z-50 p-3 min-w-[200px]"
						onmouseleave={() => (showShortcuts = false)}
					>
						<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-2">Keyboard shortcuts</div>
						<div class="space-y-1.5 text-xs">
							<div class="flex justify-between gap-4"><span class="text-surface-400">Previous event</span><kbd class="text-surface-300 bg-surface-800 rounded px-1.5 py-0.5 font-mono text-[10px]">&larr;</kbd></div>
							<div class="flex justify-between gap-4"><span class="text-surface-400">Next event</span><kbd class="text-surface-300 bg-surface-800 rounded px-1.5 py-0.5 font-mono text-[10px]">&rarr;</kbd></div>
							<div class="flex justify-between gap-4"><span class="text-surface-400">Play / Pause</span><kbd class="text-surface-300 bg-surface-800 rounded px-1.5 py-0.5 font-mono text-[10px]">Space</kbd></div>
							<div class="flex justify-between gap-4"><span class="text-surface-400">Search events</span><kbd class="text-surface-300 bg-surface-800 rounded px-1.5 py-0.5 font-mono text-[10px]">&#8984;F</kbd></div>
							<div class="flex justify-between gap-4"><span class="text-surface-400">Clear search</span><kbd class="text-surface-300 bg-surface-800 rounded px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd></div>
						</div>
					</div>
				{/if}
			</div>
		</div>
		<StatsBar summary={data.timeline.summary} />
		<GitCommits commits={data.commits} />
		{#if data.overhead}
			<div class="px-4 py-2 border-t border-surface-800/50">
				<button
					type="button"
					onclick={() => (showOverhead = !showOverhead)}
					class="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 transition-colors"
				>
					<span class="text-[10px]">{showOverhead ? '▾' : '▸'}</span>
					<span class="font-medium">Setup overhead</span>
					<span class="text-surface-500">·</span>
					<span class="text-surface-500">
						effort: <span class="text-surface-300 font-mono">{data.overhead.effort.bucket}</span>
					</span>
					{#if data.overhead.skillsInvoked.length > 0}
						<span class="text-surface-500">·</span>
						<span class="text-surface-500">
							{data.overhead.skillsInvoked.length} skill{data.overhead.skillsInvoked.length === 1 ? '' : 's'}
						</span>
					{/if}
					{#if data.overhead.mcpUsed.length > 0}
						<span class="text-surface-500">·</span>
						<span class="text-surface-500">
							{data.overhead.mcpUsed.length} MCP server{data.overhead.mcpUsed.length === 1 ? '' : 's'}
						</span>
					{/if}
				</button>
				{#if showOverhead}
					<div class="mt-3">
						<SessionOverhead overhead={data.overhead} />
					</div>
				{/if}
			</div>
		{/if}
		<PlaybackControls
			currentIndex={selectedIndex}
			totalEvents={data.timeline.events.length}
			{isPlaying}
			{speed}
			onprev={prev}
			onnext={next}
			ontoggleplay={togglePlay}
			onspeedchange={setSpeed}
			onseek={goTo}
		/>
	</div>

	<!-- Mobile tab bar (visible < 1024px) -->
	<div class="mobile-tabs flex border-b border-surface-800 lg:hidden">
		<button
			onclick={() => (mobileTab = 'timeline')}
			class="flex-1 px-4 py-2.5 text-xs font-medium transition-colors
				{mobileTab === 'timeline' ? 'text-surface-100 border-b-2 border-blue-500' : 'text-surface-500 hover:text-surface-300'}"
		>
			Timeline
		</button>
		<button
			onclick={() => (mobileTab = 'details')}
			class="flex-1 px-4 py-2.5 text-xs font-medium transition-colors
				{mobileTab === 'details' ? 'text-surface-100 border-b-2 border-blue-500' : 'text-surface-500 hover:text-surface-300'}"
		>
			Details
		</button>
	</div>

	<!-- Main content -->
	<!-- Desktop: side-by-side (>= 1024px) -->
	<div class="desktop-layout flex-1 hidden lg:block overflow-hidden">
	{#if browser}
	<PaneGroup direction="horizontal" autoSaveId="agent-replay-session" class="h-full">
		<Pane defaultSize={30} minSize={15} maxSize={50}>
		<div class="flex flex-col h-full bg-surface-950">
			<!-- Sidebar tabs -->
			<div class="flex border-b border-surface-800">
				<button
					onclick={() => (sidebarTab = 'timeline')}
					class="flex-1 px-3 py-2 text-[10px] font-medium uppercase tracking-wider transition-colors
						{sidebarTab === 'timeline' ? 'text-surface-200 border-b border-blue-500' : 'text-surface-500 hover:text-surface-300'}"
				>Timeline</button>
				<button
					onclick={() => (sidebarTab = 'files')}
					class="flex-1 px-3 py-2 text-[10px] font-medium uppercase tracking-wider transition-colors
						{sidebarTab === 'files' ? 'text-surface-200 border-b border-blue-500' : 'text-surface-500 hover:text-surface-300'}"
				>Files</button>
			</div>

			{#if sidebarTab === 'timeline'}
			<!-- Search & Filter bar -->
			<div class="p-2 space-y-2 border-b border-surface-800">
				<div class="relative">
					<input
						bind:this={searchInputEl}
						bind:value={searchQuery}
						type="text"
						placeholder="Search events... (Cmd+F)"
						class="w-full bg-surface-900 border border-surface-800 rounded px-3 py-1.5 text-xs text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-surface-600 transition-colors"
					/>
					{#if searchQuery}
						<button
							onclick={() => (searchQuery = '')}
							class="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300 text-xs"
						>&#10005;</button>
					{/if}
				</div>

				<!-- Type filters -->
				<div class="flex flex-wrap gap-1">
					{#each eventTypes as { key, label }}
						<button
							onclick={() => { typeFilter = key; toolFilter = 'all'; }}
							class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
								{typeFilter === key ? 'bg-surface-700 text-surface-200' : 'text-surface-500 hover:text-surface-300'}"
						>{label}</button>
					{/each}
				</div>

				<!-- Tool sub-filter (visible when Tools is selected) -->
				{#if typeFilter === 'tool_call' && toolNames.length > 0}
					<div class="flex flex-wrap gap-1">
						<button
							onclick={() => (toolFilter = 'all')}
							class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
								{toolFilter === 'all' ? 'bg-surface-700 text-surface-200' : 'text-surface-500 hover:text-surface-300'}"
						>All tools</button>
						{#each toolNames as name}
							<button
								onclick={() => (toolFilter = name)}
								class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
									{toolFilter === name ? 'bg-surface-700 text-surface-200' : 'text-surface-500 hover:text-surface-300'}"
							>{name}</button>
						{/each}
					</div>
				{/if}

				<!-- Match count -->
				{#if isFiltering}
					<div class="flex items-center justify-between">
						<span class="text-[10px] text-surface-500">
							{matchedIndices.size} of {data.timeline.events.length} events
						</span>
						<button onclick={clearFilters} class="text-[10px] text-surface-500 hover:text-surface-300">
							Clear
						</button>
					</div>
				{/if}
			</div>

			<!-- Timeline scroll area -->
			<div class="flex-1 overflow-hidden p-3">
				<Timeline
					bind:this={timelineRef}
					events={displayEvents}
					selectedIndex={displaySelectedIndex}
					highlightedIndices={isFiltering && !searchQuery ? undefined : (isFiltering ? matchedIndices : undefined)}
					{annotatedEventIds}
					onselect={handleTimelineSelect}
				/>
			</div>
			{:else}
			<!-- File tree -->
			<div class="flex-1 overflow-y-auto p-3">
				<FileTree events={data.timeline.events} onjump={goTo} />
			</div>
			{/if}
		</div>
		</Pane>

		<PaneResizer class="w-1 bg-surface-800 hover:bg-blue-500/50 transition-colors cursor-col-resize" />

		<Pane defaultSize={70}>
		<!-- Detail panel (right) -->
		<div class="h-full overflow-hidden bg-surface-900">
			<DetailPanel event={selectedEvent} {sessionId} />
		</div>
		</Pane>
	</PaneGroup>
	{/if}
	</div>

	<!-- Mobile/Tablet: tabbed layout (< 1024px) -->
	<div class="mobile-layout flex-1 lg:hidden overflow-hidden">
		{#if mobileTab === 'timeline'}
			<div class="h-full flex flex-col">
				<!-- Mobile search -->
				<div class="p-2 border-b border-surface-800">
					<input
						bind:value={searchQuery}
						type="text"
						placeholder="Search events..."
						class="w-full bg-surface-900 border border-surface-800 rounded px-3 py-1.5 text-xs text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-surface-600"
					/>
					<div class="flex flex-wrap gap-1 mt-1.5">
						{#each eventTypes as { key, label }}
							<button
								onclick={() => { typeFilter = key; toolFilter = 'all'; }}
								class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
									{typeFilter === key ? 'bg-surface-700 text-surface-200' : 'text-surface-500 hover:text-surface-300'}"
							>{label}</button>
						{/each}
					</div>
					{#if isFiltering}
						<div class="flex items-center justify-between mt-1">
							<span class="text-[10px] text-surface-500">{matchedIndices.size} of {data.timeline.events.length}</span>
							<button onclick={clearFilters} class="text-[10px] text-surface-500 hover:text-surface-300">Clear</button>
						</div>
					{/if}
				</div>
				<div class="flex-1 overflow-hidden p-3">
					<Timeline
						bind:this={timelineRef}
						events={displayEvents}
						selectedIndex={displaySelectedIndex}
						onselect={handleTimelineSelect}
					/>
				</div>
			</div>
		{:else}
			<div class="h-full overflow-hidden flex flex-col">
				<button
					onclick={goBackToTimeline}
					class="px-3 py-2 text-xs text-surface-500 hover:text-blue-400 transition-colors text-left sm:hidden"
				>
					&#8592; Back to timeline
				</button>
				<div class="flex-1 overflow-hidden">
					<DetailPanel event={selectedEvent} {sessionId} />
				</div>
			</div>
		{/if}
	</div>
</div>
