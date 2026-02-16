<script lang="ts">
	let { command, description, output, isError }: {
		command: string;
		description: string;
		output: string;
		isError: boolean;
	} = $props();

	let expanded = $state(true);
</script>

<div class="rounded-md border border-surface-800 overflow-hidden">
	<!-- Terminal header -->
	<div class="bg-surface-900 px-3 py-1.5 border-b border-surface-800 flex items-center gap-2">
		<div class="flex gap-1">
			<div class="w-2.5 h-2.5 rounded-full bg-red-500/60"></div>
			<div class="w-2.5 h-2.5 rounded-full bg-yellow-500/60"></div>
			<div class="w-2.5 h-2.5 rounded-full bg-green-500/60"></div>
		</div>
		{#if description}
			<span class="text-surface-500 text-xs ml-1">{description}</span>
		{/if}
	</div>

	<!-- Command -->
	<div class="bg-surface-950 px-3 py-2 font-mono text-xs">
		<span class="text-green-400">$</span>
		<span class="text-surface-200 ml-2 whitespace-pre-wrap">{command}</span>
	</div>

	<!-- Output -->
	{#if output}
		<button
			onclick={() => (expanded = !expanded)}
			class="w-full text-left px-3 py-1 bg-surface-900/50 text-surface-500 text-xs hover:text-surface-400 border-t border-surface-800"
		>
			{expanded ? '▾' : '▸'} Output ({output.split('\n').length} lines)
		</button>

		{#if expanded}
			<div class="bg-surface-950 px-3 py-2 font-mono text-xs max-h-96 overflow-y-auto
				{isError ? 'text-red-300' : 'text-surface-400'}">
				<pre class="whitespace-pre-wrap">{output}</pre>
			</div>
		{/if}
	{/if}
</div>
