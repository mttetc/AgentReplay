<script lang="ts">
	import SessionList from '../../components/SessionList.svelte';
	import { setCachedSessions } from '$lib/stores/sessions.svelte';
	import { browser } from '$app/environment';

	let { data } = $props();

	if (browser) {
		setCachedSessions(data.sessions);
	}
</script>

<svelte:head>
	<title>sessions</title>
</svelte:head>

<div class="px-4 py-4 sm:px-6 sm:py-5">
	<SessionList sessions={data.sessions} />
</div>
