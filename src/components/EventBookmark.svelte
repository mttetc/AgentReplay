<script lang="ts">
	let { sessionId, eventId }: { sessionId: string; eventId: string } = $props();
	let bookmarked = $state(false);
	let label = $state('');
	let showInput = $state(false);

	async function toggle() {
		if (bookmarked) {
			bookmarked = false;
			return;
		}
		showInput = true;
	}

	async function save() {
		if (!label.trim()) return;
		try {
			await fetch('/api/bookmarks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId, eventId, label: label.trim() })
			});
			bookmarked = true;
			showInput = false;
			label = '';
		} catch {
			/* silent */
		}
	}

	function cancel() {
		showInput = false;
		label = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') save();
		if (e.key === 'Escape') cancel();
	}
</script>

<span class="inline-flex items-center gap-1">
	<button
		onclick={toggle}
		class="p-0.5 rounded transition-colors {bookmarked
			? 'text-amber-400'
			: 'text-surface-500 hover:text-amber-400'}"
		title={bookmarked ? 'Bookmarked' : 'Add bookmark'}
	>
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill={bookmarked ? 'currentColor' : 'none'}
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
		</svg>
	</button>
	{#if showInput}
		<input
			bind:value={label}
			onkeydown={handleKeydown}
			type="text"
			placeholder="Label..."
			class="bg-surface-900 border border-surface-800 rounded px-2 py-0.5 text-xs text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-surface-600 w-32"
		/>
		<button onclick={save} class="text-[10px] text-blue-400 hover:text-blue-300">Save</button>
		<button onclick={cancel} class="text-[10px] text-surface-500 hover:text-surface-300">Esc</button>
	{/if}
</span>
