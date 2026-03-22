<script lang="ts">
	let { lines = 5, variant = 'list' }: {
		lines?: number;
		variant?: 'list' | 'card' | 'detail';
	} = $props();
</script>

<div class="animate-pulse space-y-3 p-4">
	{#if variant === 'card'}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
			{#each Array(lines) as _}
				<div class="bg-surface-900 border border-surface-800 rounded-lg p-4 space-y-2">
					<div class="h-4 bg-surface-800 rounded w-3/4"></div>
					<div class="h-3 bg-surface-800/60 rounded w-1/2"></div>
					<div class="flex gap-2 mt-2">
						<div class="h-5 bg-surface-800/40 rounded w-16"></div>
						<div class="h-5 bg-surface-800/40 rounded w-12"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if variant === 'detail'}
		<div class="space-y-4">
			<div class="h-6 bg-surface-800 rounded w-1/3"></div>
			<div class="h-4 bg-surface-800/60 rounded w-full"></div>
			<div class="h-4 bg-surface-800/60 rounded w-5/6"></div>
			<div class="h-32 bg-surface-800/40 rounded w-full"></div>
		</div>
	{:else}
		{#each Array(lines) as _, i}
			<div class="flex items-center gap-3">
				<div class="h-3 w-3 bg-surface-800 rounded-full flex-shrink-0"></div>
				<div class="h-4 bg-surface-800 rounded flex-1" style="max-width: {70 + (i % 3) * 10}%"></div>
				<div class="h-3 bg-surface-800/60 rounded w-16 flex-shrink-0"></div>
			</div>
		{/each}
	{/if}
</div>
