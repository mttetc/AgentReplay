<script lang="ts">
	import type { TimelineEvent } from '$lib/types/timeline';

	let { events, onjump }: {
		events: TimelineEvent[];
		onjump?: (index: number) => void;
	} = $props();

	interface FileOp {
		type: string;
		index: number;
		isError: boolean;
	}

	interface FileEntry {
		path: string;
		name: string;
		operations: FileOp[];
	}

	let selectedFile = $state<string | null>(null);

	// Collect all file operations across entire session
	let fileMap = $derived.by(() => {
		const map = new Map<string, FileEntry>();

		for (let i = 0; i < events.length; i++) {
			const ev = events[i];
			if (ev.data.eventType !== 'tool_call') continue;
			const d = ev.data;
			const filePath = String(d.input.file_path || '');
			if (!filePath) continue;
			if (!['Read', 'Write', 'Edit'].includes(d.toolName)) continue;

			if (!map.has(filePath)) {
				const parts = filePath.split('/');
				map.set(filePath, {
					path: filePath,
					name: parts[parts.length - 1],
					operations: []
				});
			}
			map.get(filePath)!.operations.push({
				type: d.toolName,
				index: i,
				isError: d.result?.isError || false
			});
		}

		return [...map.values()].sort((a, b) => b.operations.length - a.operations.length);
	});

	// Group by directory for tree view
	let dirTree = $derived.by(() => {
		const dirs = new Map<string, FileEntry[]>();

		for (const file of fileMap) {
			const parts = file.path.split('/');
			// Use last 2 dir segments as group key
			const dirParts = parts.slice(-3, -1);
			const dirKey = dirParts.length > 0 ? dirParts.join('/') : '/';

			if (!dirs.has(dirKey)) dirs.set(dirKey, []);
			dirs.get(dirKey)!.push(file);
		}

		return [...dirs.entries()].sort((a, b) => {
			const aOps = a[1].reduce((sum, f) => sum + f.operations.length, 0);
			const bOps = b[1].reduce((sum, f) => sum + f.operations.length, 0);
			return bOps - aOps;
		});
	});

	let selectedFileData = $derived(
		selectedFile ? fileMap.find(f => f.path === selectedFile) : null
	);

	const opColors: Record<string, string> = {
		Read: 'text-blue-400',
		Write: 'text-amber-400',
		Edit: 'text-amber-400'
	};

	const opDotColors: Record<string, string> = {
		Read: 'bg-blue-500',
		Write: 'bg-amber-500',
		Edit: 'bg-amber-500'
	};

	const opLabels: Record<string, string> = {
		Read: 'read',
		Write: 'wrote',
		Edit: 'edited'
	};
</script>

{#if selectedFileData}
	<!-- File detail view -->
	<div class="h-full flex flex-col">
		<button
			onclick={() => (selectedFile = null)}
			class="flex items-center gap-1.5 px-3 py-2 text-xs text-surface-500 hover:text-blue-400 transition-colors border-b border-surface-800 flex-shrink-0"
		>
			<span>&#8592;</span>
			<span>Back to files</span>
		</button>

		<div class="px-3 py-2 border-b border-surface-800 flex-shrink-0">
			<div class="text-surface-200 text-xs font-mono truncate" title={selectedFileData.path}>
				{selectedFileData.name}
			</div>
			<div class="text-[10px] text-surface-600 mt-0.5 truncate">{selectedFileData.path}</div>
		</div>

		<div class="flex-1 overflow-y-auto">
			<div class="px-2 py-1">
				{#each selectedFileData.operations as op, i}
					<button
						onclick={() => onjump?.(op.index)}
						class="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-800/50 transition-colors text-xs"
					>
						<div class="w-1.5 h-1.5 rounded-full flex-shrink-0 {opDotColors[op.type] || 'bg-surface-500'}"></div>
						<span class="{opColors[op.type] || 'text-surface-400'} font-medium">{op.type}</span>
						<span class="text-surface-600">#{op.index + 1}</span>
						{#if op.isError}
							<span class="text-red-400 text-[10px]">error</span>
						{/if}
						<span class="ml-auto text-surface-600 text-[10px]">jump</span>
					</button>
				{/each}
			</div>
		</div>
	</div>
{:else}
	<!-- File list grouped by directory -->
	<div class="h-full overflow-y-auto">
		{#if fileMap.length === 0}
			<div class="text-surface-600 text-xs text-center py-8">No file operations in this session</div>
		{:else}
			<div class="px-1 py-1 text-[10px] text-surface-600 px-3">{fileMap.length} files touched</div>
			{#each dirTree as [dir, files]}
				<div class="mb-1">
					<div class="px-3 py-1 text-[10px] text-surface-600 truncate">{dir}/</div>
					{#each files as file}
						<button
							onclick={() => (selectedFile = file.path)}
							class="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-surface-800/50 transition-colors group"
						>
							<span class="text-xs text-surface-300 group-hover:text-surface-100 transition-colors font-mono truncate flex-1">
								{file.name}
							</span>
							<!-- Mini operation indicators -->
							<span class="flex gap-px flex-shrink-0">
								{#each file.operations as op}
									<span class="w-1 h-2.5 rounded-sm {opDotColors[op.type] || 'bg-surface-600'} {op.isError ? 'opacity-40' : ''}"></span>
								{/each}
							</span>
							<span class="text-[10px] text-surface-600 flex-shrink-0 w-3 text-right">{file.operations.length}</span>
						</button>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
{/if}
