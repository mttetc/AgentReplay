<script lang="ts">
	import type { GitCommit } from '$lib/server/git-integration';
	import { formatDate } from '$lib/utils/format';

	let { commits }: { commits: GitCommit[] } = $props();

	let expanded = $state(commits.length > 0 && commits.length <= 5);
	let copiedHash = $state('');

	function safeDate(iso: string): string {
		if (!iso || isNaN(new Date(iso).getTime())) return '';
		return formatDate(iso);
	}

	async function copyHash(hash: string) {
		try {
			await navigator.clipboard.writeText(hash);
			copiedHash = hash;
			setTimeout(() => (copiedHash = ''), 1500);
		} catch {}
	}
</script>

<div class="border-t border-surface-800 mt-2 pt-2">
	<button
		onclick={() => expanded = !expanded}
		class="flex items-center gap-2 text-xs w-full transition-colors {commits.length > 0 ? 'text-surface-400 hover:text-surface-200' : 'text-surface-600'}"
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="21"/>
		</svg>
		{#if commits.length > 0}
			<span>{commits.length} related commit{commits.length !== 1 ? 's' : ''}</span>
		{:else}
			<span>No related commits found</span>
		{/if}
		{#if commits.length > 0}
			<span class="ml-auto text-surface-600">{expanded ? '\u25B4' : '\u25BE'}</span>
		{/if}
	</button>

	{#if expanded && commits.length > 0}
		<div class="mt-2 space-y-1">
			{#each commits as commit}
				<div class="flex items-start gap-2 text-xs group rounded px-1.5 py-1 -mx-1.5 hover:bg-surface-800/40 transition-colors">
					<button
						onclick={() => copyHash(commit.hash)}
						class="text-blue-400 hover:text-blue-300 font-mono text-[11px] flex-shrink-0 transition-colors"
						title="Copy full hash: {commit.hash}"
					>
						{copiedHash === commit.hash ? 'copied' : commit.shortHash}
					</button>
					<span class="text-surface-200 flex-1 truncate">{commit.subject}</span>
					{#if commit.author}
						<span class="text-surface-600 flex-shrink-0 hidden sm:inline">{commit.author}</span>
					{/if}
					<span class="text-surface-500 flex-shrink-0">{safeDate(commit.date)}</span>
					{#if commit.filesChanged.length > 0}
						<span class="text-surface-600 flex-shrink-0 text-[10px]" title={commit.filesChanged.join('\n')}>
							{commit.filesChanged.length} file{commit.filesChanged.length !== 1 ? 's' : ''}
						</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
