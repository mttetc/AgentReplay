<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="flex flex-col items-center justify-center min-h-[60vh] px-4">
	<div class="text-6xl font-bold text-surface-700 mb-4" style="font-family: 'Space Grotesk', sans-serif;">
		{page.status}
	</div>
	<h1 class="text-surface-200 text-lg font-medium mb-2">
		{#if page.status === 404}
			Page not found
		{:else if page.status === 500}
			Something went wrong
		{:else}
			Error
		{/if}
	</h1>
	<p class="text-surface-500 text-sm text-center max-w-md mb-6">
		{page.error?.message || 'An unexpected error occurred.'}
	</p>
	<div class="flex gap-3">
		<a href="/" class="px-4 py-2 text-xs font-medium rounded-lg bg-surface-800 text-surface-200 border border-surface-700 hover:border-surface-500 transition-colors">
			Go to Insights
		</a>
		<a href="/sessions" class="px-4 py-2 text-xs font-medium rounded-lg text-surface-400 hover:text-surface-200 transition-colors">
			Browse Sessions
		</a>
	</div>
</div>
