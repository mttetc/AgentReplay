<script lang="ts">
	import type { TimelineEvent } from '$lib/types/timeline';
	import EventCard from './EventCard.svelte';

	let { events, selectedIndex = 0, onselect }: {
		events: TimelineEvent[];
		selectedIndex?: number;
		onselect: (index: number) => void;
	} = $props();

	let timelineEl: HTMLDivElement | undefined = $state();

	export function scrollToEvent(index: number) {
		if (!timelineEl) return;
		const card = timelineEl.querySelector(`[data-event-index="${index}"]`);
		if (card) {
			card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	}
</script>

<div bind:this={timelineEl} class="relative">
	<!-- Vertical line -->
	<div class="absolute left-[5px] top-0 bottom-0 w-px bg-surface-800"></div>

	<div class="space-y-1">
		{#each events as event, i (event.id)}
			<div data-event-index={i}>
				<EventCard
					{event}
					selected={i === selectedIndex}
					onclick={() => onselect(i)}
				/>
			</div>
		{/each}
	</div>
</div>
