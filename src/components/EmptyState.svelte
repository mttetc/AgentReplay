<script lang="ts">
	let { icon = 'search', title, message, action }: {
		icon?: 'search' | 'inbox' | 'error' | 'sessions';
		title: string;
		message: string;
		action?: { label: string; href: string };
	} = $props();

	const icons: Record<string, string> = {
		search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
		inbox: 'M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4',
		error: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.999L13.732 4.001c-.77-1.333-2.694-1.333-3.464 0L3.34 16.001C2.57 17.334 3.532 19 5.072 19z',
		sessions: 'M4 6h16M4 10h16M4 14h16M4 18h16'
	};
</script>

<div class="flex flex-col items-center justify-center py-16 px-4">
	<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-surface-600 mb-4">
		<path d={icons[icon] || icons.search} />
	</svg>
	<h3 class="text-surface-300 text-sm font-medium mb-1">{title}</h3>
	<p class="text-surface-500 text-xs text-center max-w-sm">{message}</p>
	{#if action}
		<a href={action.href} class="mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors">
			{action.label} &rarr;
		</a>
	{/if}
</div>
