<script lang="ts">
	let { sessionId, eventId }: { sessionId: string; eventId: string } = $props();
	let bookmarked = $state(false);
	let bookmarkId: number | null = $state(null);

	// Check if already bookmarked on mount
	$effect(() => {
		fetch(`/api/bookmarks?sessionId=${encodeURIComponent(sessionId)}`)
			.then(r => r.json())
			.then((bookmarks: Array<{ id: number; eventId: string | null }>) => {
				const match = bookmarks.find(b => b.eventId === eventId);
				if (match) {
					bookmarked = true;
					bookmarkId = match.id;
				}
			}).catch(() => {});
	});

	async function toggle() {
		if (bookmarked && bookmarkId) {
			// Remove
			bookmarked = false;
			const prevId = bookmarkId;
			bookmarkId = null;
			try {
				await fetch('/api/bookmarks', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: prevId, action: 'remove' })
				});
			} catch {
				bookmarked = true;
				bookmarkId = prevId;
			}
		} else {
			// Add
			bookmarked = true;
			try {
				const res = await fetch('/api/bookmarks', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sessionId, eventId, label: `Event ${eventId}` })
				});
				const data = await res.json();
				bookmarkId = data.id;
			} catch {
				bookmarked = false;
			}
		}
	}
</script>

<button
	onclick={toggle}
	class="p-0.5 rounded transition-colors {bookmarked
		? 'text-amber-400'
		: 'text-surface-600 hover:text-amber-400'}"
	title={bookmarked ? 'Remove bookmark' : 'Bookmark this event'}
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
