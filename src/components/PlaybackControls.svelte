<script lang="ts">
	let {
		currentIndex = 0,
		totalEvents = 0,
		isPlaying = false,
		speed = 1,
		onprev,
		onnext,
		ontoggleplay,
		onspeedchange,
		onseek
	}: {
		currentIndex: number;
		totalEvents: number;
		isPlaying: boolean;
		speed: number;
		onprev: () => void;
		onnext: () => void;
		ontoggleplay: () => void;
		onspeedchange: (speed: number) => void;
		onseek: (index: number) => void;
	} = $props();

	const speeds = [1, 2, 4, 8];

	function handleProgressClick(e: MouseEvent) {
		const bar = e.currentTarget as HTMLElement;
		const rect = bar.getBoundingClientRect();
		const ratio = (e.clientX - rect.left) / rect.width;
		const index = Math.round(ratio * (totalEvents - 1));
		onseek(Math.max(0, Math.min(totalEvents - 1, index)));
	}

	let progress = $derived(totalEvents > 1 ? (currentIndex / (totalEvents - 1)) * 100 : 0);
</script>

<div class="playback-controls flex items-center gap-3">
	<!-- Prev -->
	<button
		onclick={onprev}
		disabled={currentIndex <= 0}
		class="text-surface-400 hover:text-surface-200 disabled:text-surface-700 disabled:cursor-not-allowed transition-colors p-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
		title="Previous (Left Arrow)"
	>
		&#9664;
	</button>

	<!-- Play/Pause -->
	<button
		onclick={ontoggleplay}
		class="text-surface-200 hover:text-white transition-colors p-1 text-lg min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
		title="Play/Pause (Space)"
	>
		{#if isPlaying}&#10074;&#10074;{:else}&#9654;{/if}
	</button>

	<!-- Next -->
	<button
		onclick={onnext}
		disabled={currentIndex >= totalEvents - 1}
		class="text-surface-400 hover:text-surface-200 disabled:text-surface-700 disabled:cursor-not-allowed transition-colors p-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
		title="Next (Right Arrow)"
	>
		&#9654;
	</button>

	<!-- Progress bar -->
	<button
		onclick={handleProgressClick}
		class="flex-1 h-1.5 bg-surface-800 rounded-full relative cursor-pointer group"
		aria-label="Seek to position"
	>
		<div
			class="absolute inset-y-0 left-0 bg-surface-500 group-hover:bg-surface-400 rounded-full transition-all"
			style="width: {progress}%"
		></div>
		<div
			class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-surface-300 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
			style="left: {progress}%"
		></div>
	</button>

	<!-- Counter -->
	<span class="counter text-surface-500 text-xs tabular-nums min-w-[4rem] text-right">
		<span class="counter-full">{currentIndex + 1} / {totalEvents}</span>
		<span class="counter-short hidden">{currentIndex + 1}/{totalEvents}</span>
	</span>

	<!-- Speed: buttons on desktop, select on mobile -->
	<div class="speed-buttons flex items-center gap-1">
		{#each speeds as s}
			<button
				onclick={() => onspeedchange(s)}
				class="text-xs px-1.5 py-0.5 rounded transition-colors
					{speed === s ? 'bg-surface-700 text-surface-200' : 'text-surface-500 hover:text-surface-300'}"
			>
				{s}x
			</button>
		{/each}
	</div>
	<div class="speed-select hidden">
		<select
			value={speed}
			onchange={(e) => onspeedchange(Number((e.target as HTMLSelectElement).value))}
			class="bg-surface-800 border border-surface-700 rounded text-xs text-surface-300 px-1.5 py-1 min-h-[44px]"
		>
			{#each speeds as s}
				<option value={s}>{s}x</option>
			{/each}
		</select>
	</div>
</div>

<style>
	@media (max-width: 639px) {
		.speed-buttons {
			display: none;
		}
		.speed-select {
			display: block;
		}
		.counter-full {
			display: none;
		}
		.counter-short {
			display: inline;
		}
		.counter {
			min-width: 3rem;
		}
	}
</style>
