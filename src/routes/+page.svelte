<script lang="ts">
	import SessionList from '../components/SessionList.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Agent Replay — Dashboard</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-3 py-4 sm:px-4 sm:py-8">
	<div class="mb-6 sm:mb-8">
		<h1 class="text-xl sm:text-2xl font-bold text-surface-100 mb-2">Sessions</h1>
		<p class="text-surface-500 text-sm">
			Browse and replay your Claude Code agent sessions
		</p>
	</div>

	<SessionList sessions={data.sessions} />
</div>
