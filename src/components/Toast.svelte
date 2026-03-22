<script lang="ts">
	interface ToastMessage {
		id: number;
		text: string;
		type: 'error' | 'success' | 'info';
	}

	let toasts: ToastMessage[] = $state([]);
	let nextId = 0;

	export function show(text: string, type: 'error' | 'success' | 'info' = 'info') {
		const id = nextId++;
		toasts = [...toasts, { id, text, type }];
		setTimeout(() => dismiss(id), 4000);
	}

	function dismiss(id: number) {
		toasts = toasts.filter((t) => t.id !== id);
	}

	const styles: Record<string, string> = {
		error: 'bg-red-500/10 border-red-500/20 text-red-400',
		success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
		info: 'bg-blue-500/10 border-blue-500/20 text-blue-400'
	};
</script>

{#if toasts.length > 0}
	<div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
		{#each toasts as toast (toast.id)}
			<div class="border rounded-lg px-4 py-3 text-xs shadow-lg backdrop-blur-sm {styles[toast.type]}">
				<div class="flex items-center justify-between gap-3">
					<span>{toast.text}</span>
					<button onclick={() => dismiss(toast.id)} class="opacity-60 hover:opacity-100 transition-opacity text-sm">&times;</button>
				</div>
			</div>
		{/each}
	</div>
{/if}
