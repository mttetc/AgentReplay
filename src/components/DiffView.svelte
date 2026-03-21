<script lang="ts">
	import { createPatch } from 'diff';

	let { oldString, newString }: {
		oldString: string;
		newString: string;
	} = $props();

	let patch = $derived(createPatch('file', oldString, newString, '', '', { context: 3 }));
	let copied = $state(false);

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

	async function copyDiff() {
		await navigator.clipboard.writeText(patch);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="rounded-md border border-surface-800 overflow-hidden">
	<div class="flex items-center justify-between px-3 py-1.5 bg-surface-800/50 border-b border-surface-800">
		<span class="text-purple-400 text-xs font-mono">{lines[0]?.content || 'diff'}</span>
		<button
			onclick={copyDiff}
			class="text-[10px] text-surface-500 hover:text-surface-300 transition-colors px-1.5 py-0.5 rounded border border-surface-700 hover:border-surface-600"
		>
			{copied ? '✓ copied' : 'copy'}
		</button>
	</div>
	<div class="overflow-x-auto text-xs font-mono">
		{#each lines.slice(1) as line}
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
