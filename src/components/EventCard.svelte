<script lang="ts">
	import type { TimelineEvent } from '$lib/types/timeline';
	import { truncate } from '$lib/utils/format';

	let { event, selected = false, onclick }: {
		event: TimelineEvent;
		selected?: boolean;
		onclick: () => void;
	} = $props();

	const toolIcons: Record<string, string> = {
		Bash: '$',
		Read: '&#128196;',
		Write: '&#9997;',
		Edit: '&#9998;',
		Glob: '&#128269;',
		Grep: '&#128270;',
		Task: '&#9881;',
		WebFetch: '&#127760;',
		WebSearch: '&#128269;',
		AskUserQuestion: '?'
	};

	const toolColors: Record<string, string> = {
		Bash: 'border-green-500/50 bg-green-500/5',
		Read: 'border-blue-500/50 bg-blue-500/5',
		Write: 'border-amber-500/50 bg-amber-500/5',
		Edit: 'border-amber-500/50 bg-amber-500/5',
		Glob: 'border-purple-500/50 bg-purple-500/5',
		Grep: 'border-purple-500/50 bg-purple-500/5',
		Task: 'border-cyan-500/50 bg-cyan-500/5',
		WebFetch: 'border-indigo-500/50 bg-indigo-500/5',
		WebSearch: 'border-indigo-500/50 bg-indigo-500/5'
	};

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

	const pulseColors: Record<string, string> = {
		Bash: 'text-green-500',
		Read: 'text-blue-500',
		Write: 'text-amber-500',
		Edit: 'text-amber-500',
		Glob: 'text-purple-500',
		Grep: 'text-purple-500',
		Task: 'text-cyan-500',
		WebFetch: 'text-indigo-500',
		WebSearch: 'text-indigo-500'
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

	function getPulseColor(event: TimelineEvent): string {
		const d = event.data;
		if (d.eventType === 'user_message') return 'text-sky-500';
		if (d.eventType === 'assistant_text') return 'text-surface-400';
		if (d.eventType === 'thinking') return 'text-yellow-500';
		if (d.eventType === 'tool_call') return pulseColors[d.toolName] || 'text-surface-500';
		if (d.eventType === 'compact_boundary') return 'text-orange-500';
		return 'text-surface-600';
	}

	function getBorderColor(event: TimelineEvent): string {
		const d = event.data;
		if (d.eventType === 'user_message') return 'border-sky-500/50 bg-sky-500/5';
		if (d.eventType === 'assistant_text') return 'border-surface-600 bg-surface-800/50';
		if (d.eventType === 'thinking') return 'border-yellow-500/30 bg-yellow-500/5';
		if (d.eventType === 'tool_call') return toolColors[d.toolName] || 'border-surface-600 bg-surface-800/50';
		if (d.eventType === 'compact_boundary') return 'border-orange-500/30 bg-orange-500/5';
		return 'border-surface-700 bg-surface-800/50';
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
	<div class="absolute left-0 top-3 w-3 h-3 rounded-full {getDotColor(event)} ring-2 ring-surface-950 z-10
		{selected ? 'scale-125' : 'group-hover:scale-110'} transition-transform"></div>

	<!-- Pulse ring on selected -->
	{#if selected}
		<div class="absolute left-0 top-3 w-3 h-3 rounded-full z-[9] {getPulseColor(event)} animate-pulse-ring"></div>
	{/if}

	<!-- Card -->
	<div class="ml-2 px-3 py-2 rounded-md border transition-all text-sm
		{getBorderColor(event)}
		{selected ? 'ring-1 ring-surface-500 !bg-surface-800' : 'hover:bg-surface-800/80'}
		{hasError(event) ? '!border-red-500/50' : ''}"
	>
		<div class="flex items-center gap-2 mb-0.5">
			<span class="text-xs font-medium text-surface-400">{getLabel(event)}</span>
			{#if hasError(event)}
				<span class="text-xs text-red-400">error</span>
			{/if}
		</div>
		<div class="text-surface-300 text-xs leading-relaxed truncate">
			{getSummary(event)}
		</div>
	</div>
</button>

<style>
	.animate-pulse-ring {
		animation: pulse-ring 1.5s ease-out infinite;
	}
</style>
