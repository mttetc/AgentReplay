<script lang="ts">
	let { content, maxHeight = '24rem' }: { content: string; maxHeight?: string } = $props();

	let lines = $derived(content.split('\n'));
</script>

<div class="rounded-md border border-surface-800 overflow-hidden">
	<div class="overflow-x-auto font-mono text-xs" style="max-height: {maxHeight}; overflow-y: auto;">
		<table class="w-full">
			<tbody>
				{#each lines as line, i}
					<tr class="hover:bg-surface-800/30">
						<td class="text-surface-600 text-right px-2 py-0 select-none w-1 whitespace-nowrap border-r border-surface-800">
							{i + 1}
						</td>
						<td class="text-surface-300 px-3 py-0 whitespace-pre">{line}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
