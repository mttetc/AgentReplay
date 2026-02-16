<script lang="ts">
	import Timeline from '../../../components/Timeline.svelte';
	import DetailPanel from '../../../components/DetailPanel.svelte';
	import PlaybackControls from '../../../components/PlaybackControls.svelte';
	import StatsBar from '../../../components/StatsBar.svelte';

	let { data } = $props();

	let selectedIndex = $state(0);
	let isPlaying = $state(false);
	let speed = $state(1);
	let playInterval: ReturnType<typeof setInterval> | null = null;
	let timelineRef: Timeline | undefined = $state();
	let mobileTab: 'timeline' | 'details' = $state('timeline');

	let selectedEvent = $derived(data.timeline.events[selectedIndex] || null);

	function goTo(index: number) {
		if (index < 0 || index >= data.timeline.events.length) return;
		selectedIndex = index;
		timelineRef?.scrollToEvent(index);
		// On mobile, selecting an event switches to details
		mobileTab = 'details';
	}

	function prev() {
		goTo(selectedIndex - 1);
	}

	function next() {
		if (selectedIndex >= data.timeline.events.length - 1) {
			stopPlayback();
			return;
		}
		goTo(selectedIndex + 1);
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

	function goBackToTimeline() {
		mobileTab = 'timeline';
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
	<title>{data.timeline.summary.slug || data.timeline.summary.sessionId.slice(0, 8)} — Agent Replay</title>
</svelte:head>

<div class="h-[calc(100vh-3.5rem-2px)] flex flex-col">
	<!-- Top bar: stats + playback -->
	<div class="border-b border-surface-800 bg-surface-900/50 px-3 sm:px-4 py-2 space-y-2">
		<div class="flex items-center gap-3">
			<a href="/" class="text-surface-500 hover:text-blue-400 transition-colors text-xs">
				&#8592; Sessions
			</a>
			<span class="text-surface-700">|</span>
			<h1 class="text-surface-100 text-sm font-medium truncate">
				{data.timeline.summary.slug || data.timeline.summary.sessionId.slice(0, 8)}
			</h1>
			<span class="text-surface-600 text-xs truncate hidden sm:inline">{data.timeline.summary.project}</span>
		</div>
		<StatsBar summary={data.timeline.summary} />
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
	<div class="desktop-layout flex-1 hidden lg:flex overflow-hidden">
		<!-- Timeline (left) -->
		<div class="w-[400px] xl:w-[400px] lg:w-[280px] min-w-[240px] border-r border-surface-800 overflow-y-auto p-3">
			<Timeline
				bind:this={timelineRef}
				events={data.timeline.events}
				{selectedIndex}
				onselect={goTo}
			/>
		</div>

		<!-- Detail panel (right) -->
		<div class="flex-1 overflow-hidden">
			<DetailPanel event={selectedEvent} />
		</div>
	</div>

	<!-- Mobile/Tablet: tabbed layout (< 1024px) -->
	<div class="mobile-layout flex-1 lg:hidden overflow-hidden">
		{#if mobileTab === 'timeline'}
			<div class="h-full overflow-y-auto p-3">
				<Timeline
					bind:this={timelineRef}
					events={data.timeline.events}
					{selectedIndex}
					onselect={goTo}
				/>
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
					<DetailPanel event={selectedEvent} />
				</div>
			</div>
		{/if}
	</div>
</div>
