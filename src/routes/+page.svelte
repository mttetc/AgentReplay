<script lang="ts">
	import SessionList from '../components/SessionList.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>AgentReplay — Dashboard</title>
</svelte:head>

<div class="px-4 py-4 sm:px-8 sm:py-8">
	<div class="mb-6 sm:mb-8">
		<h1 class="text-xl sm:text-2xl font-bold text-surface-100 mb-2" style="font-family: 'Space Grotesk', -apple-system, sans-serif; letter-spacing: -0.03em;">Sessions</h1>
		<p class="text-surface-500 text-sm">
			Browse and replay your Claude Code and Cursor sessions
		</p>
	</div>

	<SessionList sessions={data.sessions} />
</div>
