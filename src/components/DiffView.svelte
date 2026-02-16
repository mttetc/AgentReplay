<script lang="ts">
	import { createPatch } from 'diff';

	let { filePath, oldString, newString }: {
		filePath: string;
		oldString: string;
		newString: string;
	} = $props();

	let patch = $derived(createPatch(filePath, oldString, newString, '', '', { context: 3 }));

	interface DiffLine {
		type: 'add' | 'remove' | 'context' | 'header';
		content: string;
	}

	let lines = $derived.by(() => {
		const result: DiffLine[] = [];
		for (const line of patch.split('\n')) {
			if (line.startsWith('@@')) {
				result.push({ type: 'header', content: line });
			} else if (line.startsWith('+') && !line.startsWith('+++')) {
				result.push({ type: 'add', content: line.slice(1) });
			} else if (line.startsWith('-') && !line.startsWith('---')) {
				result.push({ type: 'remove', content: line.slice(1) });
			} else if (line.startsWith(' ')) {
				result.push({ type: 'context', content: line.slice(1) });
			}
		}
		return result;
	});
</script>

<div class="rounded-md border border-surface-800 overflow-hidden">
	<div class="bg-surface-900 px-3 py-1.5 border-b border-surface-800 flex items-center gap-2">
		<span class="text-amber-400 text-xs">{filePath}</span>
	</div>
	<div class="overflow-x-auto text-xs font-mono">
		{#each lines as line, i}
			<div
				class="px-3 py-0.5 whitespace-pre
					{line.type === 'add' ? 'bg-green-500/10 text-green-300' : ''}
					{line.type === 'remove' ? 'bg-red-500/10 text-red-300' : ''}
					{line.type === 'context' ? 'text-surface-400' : ''}
					{line.type === 'header' ? 'bg-surface-800 text-purple-400 py-1' : ''}"
			>{#if line.type === 'add'}+{:else if line.type === 'remove'}-{:else if line.type === 'context'}&nbsp;{/if}{line.content}</div>
		{/each}
	</div>
</div>
