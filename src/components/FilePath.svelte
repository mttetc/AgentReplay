<script lang="ts">
	let { path, extra = '' }: { path: string; extra?: string } = $props();

	let copied = $state(false);

	async function copy() {
		await navigator.clipboard.writeText(path);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="flex items-center gap-2 group/fp rounded-md bg-surface-800/50 border border-surface-800 px-3 py-1.5 mb-3">
	<button onclick={copy} class="text-blue-400 text-xs hover:text-blue-300 transition-colors text-left truncate font-mono min-w-0">
		{path}
	</button>
	{#if extra}
		<span class="text-surface-500 text-xs flex-shrink-0">{extra}</span>
	{/if}
	<button onclick={copy} class="text-[10px] text-surface-500 hover:text-surface-300 transition-colors flex-shrink-0 ml-auto px-1.5 py-0.5 rounded border border-surface-700 hover:border-surface-600">
		{copied ? '✓ copied' : 'copy'}
	</button>
</div>
