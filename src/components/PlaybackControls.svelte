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
		class="key-btn disabled:opacity-30 disabled:cursor-not-allowed"
		title="Previous (Left Arrow)"
	>
		&#9664;
	</button>

	<!-- Play/Pause -->
	<button
		onclick={ontoggleplay}
		class="key-btn key-wide"
		title="Play/Pause (Space)"
	>
		{#if isPlaying}&#10074;&#10074;{:else}&#9654;{/if}
	</button>

	<!-- Next -->
	<button
		onclick={onnext}
		disabled={currentIndex >= totalEvents - 1}
		class="key-btn disabled:opacity-30 disabled:cursor-not-allowed"
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
	<span class="counter text-surface-500 text-xs tabular-nums min-w-[4rem] text-right" style="font-family: 'JetBrains Mono', monospace;">
		<span class="counter-full">{currentIndex + 1} / {totalEvents}</span>
		<span class="counter-short hidden">{currentIndex + 1}/{totalEvents}</span>
	</span>

	<!-- Speed: keyboard-style buttons -->
	<div class="speed-buttons flex items-center gap-1">
		{#each speeds as s}
			<button
				onclick={() => onspeedchange(s)}
				class="key-btn key-sm {speed === s ? 'key-active' : ''}"
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
	.key-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 32px;
		height: 28px;
		padding: 0 8px;
		background: var(--color-surface-900);
		border: 1px solid var(--color-surface-700);
		border-bottom-width: 2px;
		border-radius: 5px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		color: var(--color-surface-300);
		cursor: pointer;
		transition: all 0.1s;
	}
	.key-btn:hover {
		border-color: var(--color-surface-600);
		color: var(--color-surface-100);
	}
	.key-btn:active {
		border-bottom-width: 1px;
		transform: translateY(1px);
	}
	.key-wide {
		min-width: 48px;
	}
	.key-sm {
		min-width: 28px;
		height: 24px;
		font-size: 10px;
		padding: 0 6px;
	}
	.key-active {
		background: var(--color-surface-800);
		border-color: var(--color-surface-500);
		color: var(--color-surface-100);
	}

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
