<script lang="ts">
	import type { GitCommit } from '$lib/server/git-integration';
	import { formatDate } from '$lib/utils/format';

	let { commits }: { commits: GitCommit[] } = $props();

	let expanded = $state(false);

	function safeDate(iso: string): string {
		if (!iso || isNaN(new Date(iso).getTime())) return '';
		return formatDate(iso);
	}
</script>

{#if commits.length > 0}
	<div class="border-t border-surface-800 mt-2 pt-2">
		<button
			onclick={() => expanded = !expanded}
			class="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 transition-colors w-full"
		>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="21"/>
			</svg>
			<span>{commits.length} related commit{commits.length !== 1 ? 's' : ''}</span>
			<span class="ml-auto text-surface-600">{expanded ? '\u25B4' : '\u25BE'}</span>
		</button>

		{#if expanded}
			<div class="mt-2 space-y-1.5">
				{#each commits as commit}
					<div class="flex items-start gap-2 text-xs">
						<code class="text-blue-400 font-mono text-[11px] flex-shrink-0">{commit.shortHash}</code>
						<span class="text-surface-200 truncate flex-1">{commit.subject}</span>
						<span class="text-surface-500 flex-shrink-0">{safeDate(commit.date)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
