<script lang="ts">
	import SessionList from '../../components/SessionList.svelte';
	import { setCachedSessions } from '$lib/stores/sessions.svelte';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	if (browser) {
		setCachedSessions(data.sessions);
	}

	// Live refresh via SSE — auto-update when new sessions are discovered
	$effect(() => {
		if (!browser) return;
		const source = new EventSource('/api/events');
		source.onmessage = () => {
			invalidateAll();
		};
		return () => source.close();
	});
</script>

<svelte:head>
	<title>sessions</title>
</svelte:head>

<div class="px-4 py-4 sm:px-6 sm:py-5">
	{#if data.providerErrors?.length > 0}
		<div class="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-2 mb-4 text-xs text-amber-400">
			{#each data.providerErrors as err}
				<span class="mr-3">{err.provider}: {err.error}</span>
			{/each}
		</div>
	{/if}
	<SessionList sessions={data.sessions} />
</div>
