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
	<SessionList sessions={data.sessions} />
</div>
