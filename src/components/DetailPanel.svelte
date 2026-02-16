<script lang="ts">
	import type { TimelineEvent } from '$lib/types/timeline';
	import DiffView from './DiffView.svelte';
	import BashOutput from './BashOutput.svelte';
	import CodeBlock from './CodeBlock.svelte';

	let { event }: { event: TimelineEvent | null } = $props();
</script>

{#if !event}
	<div class="flex items-center justify-center h-full text-surface-600 text-sm">
		Select an event to view details
	</div>
{:else}
	<div class="h-full overflow-y-auto p-4 space-y-4">
		{#if event.data.eventType === 'user_message'}
			<div>
				<h3 class="text-xs font-medium text-sky-400 mb-3 uppercase tracking-wider">User Message</h3>
				<div class="text-surface-200 text-sm whitespace-pre-wrap leading-relaxed">{event.data.text}</div>
			</div>

		{:else if event.data.eventType === 'assistant_text'}
			<div>
				<h3 class="text-xs font-medium text-surface-400 mb-3 uppercase tracking-wider">Claude</h3>
				<div class="text-surface-200 text-sm whitespace-pre-wrap leading-relaxed">{event.data.text}</div>
			</div>

		{:else if event.data.eventType === 'thinking'}
			<div>
				<h3 class="text-xs font-medium text-yellow-400 mb-3 uppercase tracking-wider">Thinking</h3>
				<div class="text-surface-400 text-sm whitespace-pre-wrap leading-relaxed italic">{event.data.thinking}</div>
			</div>

		{:else if event.data.eventType === 'tool_call'}
			{@const tc = event.data}
			<div>
				<h3 class="text-xs font-medium text-surface-400 mb-3 uppercase tracking-wider">
					{tc.toolName}
					{#if tc.result?.isError}
						<span class="text-red-400 ml-2">Error</span>
					{/if}
				</h3>

				{#if tc.toolName === 'Edit'}
					<DiffView
						filePath={String(tc.input.file_path || '')}
						oldString={String(tc.input.old_string || '')}
						newString={String(tc.input.new_string || '')}
					/>

				{:else if tc.toolName === 'Bash'}
					<BashOutput
						command={String(tc.input.command || '')}
						description={String(tc.input.description || '')}
						output={tc.result?.content || ''}
						isError={tc.result?.isError || false}
					/>

				{:else if tc.toolName === 'Read'}
					<div class="mb-2">
						<span class="text-blue-400 text-xs">{tc.input.file_path}</span>
						{#if tc.input.offset}
							<span class="text-surface-500 text-xs ml-2">from line {tc.input.offset}</span>
						{/if}
					</div>
					{#if tc.result?.isError}
						<div class="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2">
							<p class="text-red-400 text-xs font-medium mb-1">Tool returned an error during this session</p>
							<pre class="text-red-300/80 text-xs whitespace-pre-wrap">{tc.result.content}</pre>
						</div>
					{:else}
						<CodeBlock content={tc.result?.content || 'No content'} />
					{/if}

				{:else if tc.toolName === 'Write'}
					<div class="mb-2">
						<span class="text-amber-400 text-xs">{tc.input.file_path}</span>
					</div>
					<CodeBlock content={String(tc.input.content || '')} />

				{:else if tc.toolName === 'Glob'}
					<div class="mb-2">
						<span class="text-purple-400 text-xs">Pattern: {tc.input.pattern}</span>
						{#if tc.input.path}
							<span class="text-surface-500 text-xs ml-2">in {tc.input.path}</span>
						{/if}
					</div>
					<CodeBlock content={tc.result?.content || 'No results'} />

				{:else if tc.toolName === 'Grep'}
					<div class="mb-2">
						<span class="text-purple-400 text-xs">/{tc.input.pattern}/</span>
						{#if tc.input.path}
							<span class="text-surface-500 text-xs ml-2">in {tc.input.path}</span>
						{/if}
					</div>
					<CodeBlock content={tc.result?.content || 'No results'} />

				{:else if tc.toolName === 'Task'}
					<div class="space-y-2">
						<div class="text-surface-300 text-sm">
							<span class="text-cyan-400">Description:</span> {tc.input.description || ''}
						</div>
						{#if tc.input.prompt}
							<div class="text-surface-400 text-xs whitespace-pre-wrap bg-surface-900 rounded p-3 border border-surface-800">
								{tc.input.prompt}
							</div>
						{/if}
						{#if tc.result}
							<div class="mt-3">
								<span class="text-xs text-surface-500">Result:</span>
								<CodeBlock content={tc.result.content} />
							</div>
						{/if}
					</div>

				{:else}
					<!-- Generic tool display -->
					<div class="space-y-3">
						<div class="text-xs text-surface-500">Input</div>
						<pre class="text-xs text-surface-300 bg-surface-900 rounded p-3 border border-surface-800 overflow-x-auto">{JSON.stringify(tc.input, null, 2)}</pre>
						{#if tc.result?.isError}
							<div class="text-xs text-surface-500">Result</div>
							<div class="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2">
								<p class="text-red-400 text-xs font-medium mb-1">Tool returned an error during this session</p>
								<pre class="text-red-300/80 text-xs whitespace-pre-wrap">{tc.result.content}</pre>
							</div>
						{:else if tc.result}
							<div class="text-xs text-surface-500">Result</div>
							<CodeBlock content={tc.result.content} />
						{/if}
					</div>
				{/if}
			</div>

		{:else if event.data.eventType === 'system'}
			<div>
				<h3 class="text-xs font-medium text-surface-500 mb-3 uppercase tracking-wider">System</h3>
				<p class="text-surface-400 text-sm">{event.data.subtype}</p>
				{#if event.data.durationMs}
					<p class="text-surface-500 text-xs mt-1">Duration: {(event.data.durationMs / 1000).toFixed(1)}s</p>
				{/if}
			</div>

		{:else if event.data.eventType === 'compact_boundary'}
			<div class="text-center py-8">
				<div class="text-orange-400 text-sm font-medium">Context Compacted</div>
				<p class="text-surface-500 text-xs mt-2">The conversation was summarized to fit the context window</p>
			</div>
		{/if}
	</div>
{/if}
