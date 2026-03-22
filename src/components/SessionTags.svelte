<script lang="ts">
	let { sessionId, readonly = false }: { sessionId: string; readonly?: boolean } = $props();

	let tags: string[] = $state([]);
	let adding = $state(false);
	let newTag = $state('');
	let inputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		fetchTags(sessionId);
	});

	async function fetchTags(id: string) {
		try {
			const res = await fetch(`/api/tags?sessionId=${encodeURIComponent(id)}`);
			if (res.ok) {
				tags = await res.json();
			}
		} catch {
			// silently fail — tags are non-critical
		}
	}

	async function addTag() {
		const tag = newTag.trim();
		if (!tag || tags.includes(tag)) {
			newTag = '';
			adding = false;
			return;
		}

		// Validate: alphanumeric, spaces, hyphens, underscores only
		if (!/^[a-zA-Z0-9_\- ]+$/.test(tag) || tag.length > 50) {
			return;
		}

		tags = [...tags, tag];
		newTag = '';
		adding = false;

		try {
			await fetch('/api/tags', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId, tag })
			});
		} catch {
			// rollback on failure
			tags = tags.filter((t) => t !== tag);
		}
	}

	async function removeTag(tag: string) {
		const prev = tags;
		tags = tags.filter((t) => t !== tag);

		try {
			await fetch('/api/tags', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sessionId, tag, action: 'remove' })
			});
		} catch {
			tags = prev;
		}
	}

	function startAdding() {
		adding = true;
		// Focus input on next tick
		setTimeout(() => inputEl?.focus(), 0);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTag();
		} else if (e.key === 'Escape') {
			newTag = '';
			adding = false;
		}
	}
</script>

<div class="flex items-center gap-1.5 flex-wrap">
	{#each tags as tag}
		<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-surface-800 text-surface-300 border border-surface-700">
			{tag}
			{#if !readonly}
				<button
					onclick={() => removeTag(tag)}
					class="text-surface-500 hover:text-red-400 transition-colors leading-none"
					title="Remove tag"
				>&#10005;</button>
			{/if}
		</span>
	{/each}

	{#if !readonly}
		{#if adding}
			<input
				bind:this={inputEl}
				bind:value={newTag}
				onkeydown={handleKeydown}
				onblur={() => { if (!newTag.trim()) adding = false; }}
				placeholder="tag name"
				maxlength={50}
				class="px-2 py-0.5 rounded-full text-[11px] bg-surface-900 text-surface-200 border border-surface-700 focus:border-blue-500 focus:outline-none w-24 placeholder:text-surface-600"
			/>
		{:else}
			<button
				onclick={startAdding}
				class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-surface-500 border border-dashed border-surface-700 hover:text-blue-400 hover:border-blue-500/30 transition-colors"
			>
				<span class="text-[10px]">+</span>
				{tags.length === 0 ? 'Add tag' : 'Tag'}
			</button>
		{/if}
	{/if}
</div>
