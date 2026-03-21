<script lang="ts">
	import type { TimelineEvent } from '$lib/types/timeline';
	import { truncate } from '$lib/utils/format';

	let { event, selected = false, highlighted = false, onclick }: {
		event: TimelineEvent;
		selected?: boolean;
		highlighted?: boolean;
		onclick: () => void;
	} = $props();

	const dotColors: Record<string, string> = {
		Bash: 'bg-green-500',
		Read: 'bg-blue-500',
		Write: 'bg-amber-500',
		Edit: 'bg-amber-500',
		Glob: 'bg-purple-500',
		Grep: 'bg-purple-500',
		Task: 'bg-cyan-500',
		WebFetch: 'bg-indigo-500',
		WebSearch: 'bg-indigo-500'
	};

	const labelColors: Record<string, string> = {
		Bash: 'text-green-400',
		Read: 'text-blue-400',
		Write: 'text-amber-400',
		Edit: 'text-amber-400',
		Glob: 'text-purple-400',
		Grep: 'text-purple-400',
		Task: 'text-cyan-400',
		WebFetch: 'text-indigo-400',
		WebSearch: 'text-indigo-400'
	};

	function getSummary(event: TimelineEvent): string {
		const d = event.data;
		switch (d.eventType) {
			case 'user_message':
				return truncate(d.text, 80);
			case 'assistant_text':
				return truncate(d.text, 80);
			case 'thinking':
				return truncate(d.thinking, 60);
			case 'tool_call': {
				const input = d.input;
				if (d.toolName === 'Bash') return truncate(String(input.command || ''), 60);
				if (d.toolName === 'Read') return truncate(String(input.file_path || ''), 60);
				if (d.toolName === 'Edit') return truncate(String(input.file_path || ''), 60);
				if (d.toolName === 'Write') return truncate(String(input.file_path || ''), 60);
				if (d.toolName === 'Glob') return truncate(String(input.pattern || ''), 60);
				if (d.toolName === 'Grep') return truncate(String(input.pattern || ''), 60);
				if (d.toolName === 'Task') return truncate(String(input.description || ''), 60);
				return d.toolName;
			}
			case 'system':
				return d.subtype;
			case 'compact_boundary':
				return 'Context compacted';
			default:
				return '';
		}
	}

	function getLabel(event: TimelineEvent): string {
		const d = event.data;
		switch (d.eventType) {
			case 'user_message': return 'User';
			case 'assistant_text': return 'Claude';
			case 'thinking': return 'Thinking';
			case 'tool_call': return d.toolName;
			case 'system': return 'System';
			case 'compact_boundary': return 'Compact';
			default: return '';
		}
	}

	function getDotColor(event: TimelineEvent): string {
		const d = event.data;
		if (d.eventType === 'user_message') return 'bg-sky-500';
		if (d.eventType === 'assistant_text') return 'bg-surface-400';
		if (d.eventType === 'thinking') return 'bg-yellow-500';
		if (d.eventType === 'tool_call') return dotColors[d.toolName] || 'bg-surface-500';
		if (d.eventType === 'system') return 'bg-surface-600';
		if (d.eventType === 'compact_boundary') return 'bg-orange-500';
		return 'bg-surface-600';
	}

	function getLabelColor(event: TimelineEvent): string {
		const d = event.data;
		if (d.eventType === 'user_message') return 'text-sky-400';
		if (d.eventType === 'assistant_text') return 'text-surface-400';
		if (d.eventType === 'thinking') return 'text-yellow-400';
		if (d.eventType === 'tool_call') return labelColors[d.toolName] || 'text-surface-400';
		if (d.eventType === 'system') return 'text-surface-500';
		if (d.eventType === 'compact_boundary') return 'text-orange-400';
		return 'text-surface-500';
	}

	function getPulseColor(event: TimelineEvent): string {
		const d = event.data;
		if (d.eventType === 'user_message') return 'text-sky-500';
		if (d.eventType === 'assistant_text') return 'text-surface-400';
		if (d.eventType === 'thinking') return 'text-yellow-500';
		if (d.eventType === 'tool_call') return labelColors[d.toolName] || 'text-surface-500';
		if (d.eventType === 'compact_boundary') return 'text-orange-500';
		return 'text-surface-600';
	}

	function hasError(event: TimelineEvent): boolean {
		return event.data.eventType === 'tool_call' && !!event.data.result?.isError;
	}
</script>

<button
	{onclick}
	class="w-full text-left relative pl-6 group"
>
	<!-- Timeline dot -->
	<div class="absolute left-0 top-3 w-[8px] h-[8px] rounded-full {getDotColor(event)} ring-[1.5px] ring-[#08080a] z-10
		{selected ? 'scale-150' : 'group-hover:scale-125'} transition-transform"></div>

	<!-- Pulse ring on selected -->
	{#if selected}
		<div class="absolute left-0 top-3 w-[8px] h-[8px] rounded-full z-[9] {getPulseColor(event)} animate-pulse-ring"></div>
	{/if}

	<!-- Card -->
	<div class="ml-2 px-3 py-1.5 rounded-md transition-all
		{selected ? 'bg-surface-800/80' : 'hover:bg-surface-800/40'}
		{hasError(event) ? 'border border-red-500/40' : 'border border-transparent'}
		{highlighted ? 'ring-1 ring-yellow-500/50' : ''}"
	>
		<div class="flex items-center gap-2">
			<span class="text-[11px] font-semibold uppercase tracking-wide {getLabelColor(event)}">{getLabel(event)}</span>
			{#if hasError(event)}
				<span class="text-[10px] text-red-400 font-medium">error</span>
			{/if}
		</div>
		<div class="text-surface-400 text-xs leading-relaxed truncate">
			{getSummary(event)}
		</div>
	</div>
</button>

<style>
	.animate-pulse-ring {
		animation: pulse-ring 1.5s ease-out infinite;
	}
</style>
