<script lang="ts">
	import type { TimelineEvent } from '$lib/types/timeline';
	import EventCard from './EventCard.svelte';

	const ITEM_HEIGHT = 58;
	const OVERSCAN = 15;

	let {
		events,
		selectedIndex = 0,
		highlightedIndices,
		onselect
	}: {
		events: TimelineEvent[];
		selectedIndex?: number;
		highlightedIndices?: Set<number>;
		onselect: (index: number) => void;
	} = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let scrollTop = $state(0);
	let containerHeight = $state(600);

	let totalHeight = $derived(events.length * ITEM_HEIGHT);
	let startIdx = $derived(Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN));
	let endIdx = $derived(
		Math.min(events.length, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + OVERSCAN)
	);
	let visibleEvents = $derived(events.slice(startIdx, endIdx));
	let offsetY = $derived(startIdx * ITEM_HEIGHT);

	function handleScroll() {
		if (!containerEl) return;
		scrollTop = containerEl.scrollTop;
	}

	export function scrollToEvent(index: number) {
		if (!containerEl) return;
		const targetTop = index * ITEM_HEIGHT;
		const targetBottom = targetTop + ITEM_HEIGHT;
		const viewTop = containerEl.scrollTop;
		const viewBottom = viewTop + containerHeight;

		if (targetTop < viewTop) {
			containerEl.scrollTop = targetTop - ITEM_HEIGHT;
		} else if (targetBottom > viewBottom) {
			containerEl.scrollTop = targetBottom - containerHeight + ITEM_HEIGHT;
		}
	}

	$effect(() => {
		if (!containerEl) return;
		containerHeight = containerEl.clientHeight;
		const observer = new ResizeObserver((entries) => {
			containerHeight = entries[0].contentRect.height;
		});
		observer.observe(containerEl);
		return () => observer.disconnect();
	});
</script>

<div
	bind:this={containerEl}
	onscroll={handleScroll}
	class="relative h-full overflow-y-auto"
>
	<!-- Full height spacer -->
	<div style="height: {totalHeight}px; position: relative;">
		<!-- Vertical line -->
		<div class="absolute left-[5px] top-0 bottom-0 w-px bg-surface-800"></div>

		<!-- Visible events -->
		<div style="position: absolute; top: {offsetY}px; left: 0; right: 0; overflow: visible;">
			<div class="space-y-1" style="overflow: visible;">
				{#each visibleEvents as event, i (event.id)}
					{@const realIndex = startIdx + i}
					<div data-event-index={realIndex} style="height: {ITEM_HEIGHT}px; overflow: visible; padding-left: 6px;">
						<EventCard
							{event}
							selected={realIndex === selectedIndex}
							highlighted={highlightedIndices?.has(realIndex) ?? false}
							onclick={() => onselect(realIndex)}
						/>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>
