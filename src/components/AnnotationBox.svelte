<script lang="ts">
	import { getAnnotation, setAnnotation } from '$lib/stores/annotations.svelte';

	let { sessionId, eventId }: { sessionId: string; eventId: string } = $props();

	let editing = $state(false);
	let text = $state('');

	let existing = $derived(getAnnotation(sessionId, eventId));

	function startEdit() {
		text = existing?.text || '';
		editing = true;
	}

	function save() {
		setAnnotation(sessionId, eventId, text);
		editing = false;
	}

	function cancel() {
		editing = false;
	}

	function remove() {
		setAnnotation(sessionId, eventId, '');
		editing = false;
	}
</script>

<div class="mt-3 pt-3 border-t border-surface-800">
	{#if editing}
		<div class="space-y-2">
			<textarea
				bind:value={text}
				placeholder="Add a note..."
				class="w-full bg-surface-900 border border-surface-800 rounded px-3 py-2 text-xs text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-surface-600 resize-none"
				rows="2"
			></textarea>
			<div class="flex gap-2">
				<button onclick={save} class="px-2 py-1 text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/30 transition-colors">
					Save
				</button>
				<button onclick={cancel} class="px-2 py-1 text-[10px] text-surface-500 hover:text-surface-300 transition-colors">
					Cancel
				</button>
				{#if existing}
					<button onclick={remove} class="px-2 py-1 text-[10px] text-red-400/60 hover:text-red-400 transition-colors ml-auto">
						Remove
					</button>
				{/if}
			</div>
		</div>
	{:else if existing}
		<button onclick={startEdit} class="w-full text-left group">
			<div class="flex items-start gap-2">
				<span class="w-1.5 h-1.5 rounded-full bg-yellow-500 flex-shrink-0 mt-1"></span>
				<span class="text-xs text-yellow-400/80 group-hover:text-yellow-400 transition-colors">{existing.text}</span>
			</div>
		</button>
	{:else}
		<button onclick={startEdit} class="text-[10px] text-surface-600 hover:text-surface-400 transition-colors">
			+ Add note
		</button>
	{/if}
</div>
