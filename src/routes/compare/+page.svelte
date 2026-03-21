<script lang="ts">
	import type { SessionTimeline } from '$lib/types/timeline';
	import { formatDurationBetween, formatNumber, formatCost, shortModel } from '$lib/utils/format';

	let { data } = $props();

	const a = data.timelineA;
	const b = data.timelineB;

	function getDurationMs(t: SessionTimeline): number {
		return new Date(t.summary.lastActiveAt).getTime() - new Date(t.summary.startedAt).getTime();
	}

	interface StatRow {
		label: string;
		valueA: string;
		valueB: string;
		rawA: number;
		rawB: number;
	}

	let stats: StatRow[] = $derived([
		{ label: 'Duration', valueA: formatDurationBetween(a.summary.startedAt, a.summary.lastActiveAt), valueB: formatDurationBetween(b.summary.startedAt, b.summary.lastActiveAt), rawA: getDurationMs(a), rawB: getDurationMs(b) },
		{ label: 'Events', valueA: String(a.summary.eventCount), valueB: String(b.summary.eventCount), rawA: a.summary.eventCount, rawB: b.summary.eventCount },
		{ label: 'Tool calls', valueA: String(a.summary.toolCallCount), valueB: String(b.summary.toolCallCount), rawA: a.summary.toolCallCount, rawB: b.summary.toolCallCount },
		{ label: 'Input tokens', valueA: formatNumber(a.summary.inputTokens), valueB: formatNumber(b.summary.inputTokens), rawA: a.summary.inputTokens, rawB: b.summary.inputTokens },
		{ label: 'Output tokens', valueA: formatNumber(a.summary.outputTokens), valueB: formatNumber(b.summary.outputTokens), rawA: a.summary.outputTokens, rawB: b.summary.outputTokens },
		{ label: 'Cost', valueA: formatCost(a.summary.estimatedCost), valueB: formatCost(b.summary.estimatedCost), rawA: a.summary.estimatedCost, rawB: b.summary.estimatedCost }
	]);

	function getDelta(rawA: number, rawB: number): { text: string; cls: string } {
		if (rawA === 0 && rawB === 0) return { text: '—', cls: 'text-surface-600' };
		const diff = rawB - rawA;
		const pct = rawA > 0 ? Math.round((diff / rawA) * 100) : 0;
		if (diff === 0) return { text: '=', cls: 'text-surface-500' };
		const sign = diff > 0 ? '+' : '';
		return { text: `${sign}${pct}%`, cls: diff < 0 ? 'text-green-400' : 'text-red-400' };
	}

	// Tool usage
	interface ToolRow { name: string; countA: number; countB: number; }

	let toolComparison = $derived.by(() => {
		const mapA = new Map<string, number>();
		const mapB = new Map<string, number>();
		for (const ev of a.events) if (ev.data.eventType === 'tool_call') mapA.set(ev.data.toolName, (mapA.get(ev.data.toolName) || 0) + 1);
		for (const ev of b.events) if (ev.data.eventType === 'tool_call') mapB.set(ev.data.toolName, (mapB.get(ev.data.toolName) || 0) + 1);
		const allTools = new Set([...mapA.keys(), ...mapB.keys()]);
		const rows: ToolRow[] = [];
		for (const name of allTools) rows.push({ name, countA: mapA.get(name) || 0, countB: mapB.get(name) || 0 });
		return rows.sort((x, y) => (y.countA + y.countB) - (x.countA + x.countB));
	});

	// Files
	function getFiles(t: SessionTimeline): Set<string> {
		const files = new Set<string>();
		for (const ev of t.events) if (ev.data.eventType === 'tool_call' && ev.data.input.file_path) files.add(String(ev.data.input.file_path));
		return files;
	}

	let filesA = $derived(getFiles(a));
	let filesB = $derived(getFiles(b));
	let sharedFiles = $derived(new Set([...filesA].filter(f => filesB.has(f))));
	let onlyA = $derived(new Set([...filesA].filter(f => !filesB.has(f))));
	let onlyB = $derived(new Set([...filesB].filter(f => !filesA.has(f))));

	function shortPath(p: string): string { return p.split('/').slice(-2).join('/'); }
</script>

<svelte:head>
	<title>Compare — AgentReplay</title>
</svelte:head>

<div class="h-[calc(100vh-3.5rem)] flex flex-col">
	<!-- Header (full width) -->
	<div class="px-6 py-4 border-b border-surface-800 flex items-center gap-3 flex-shrink-0">
		<a href="/" class="text-surface-500 hover:text-blue-400 transition-colors text-xs">&#8592; Sessions</a>
		<span class="text-surface-700">|</span>
		<h1 class="text-surface-100 text-lg font-semibold" style="font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.02em;">
			Session comparison
		</h1>
	</div>

	<!-- Content: sidebar + main -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Side panel (1/4) — session cards -->
		<div class="w-72 flex-shrink-0 border-r border-surface-800 bg-surface-900 hidden lg:flex flex-col overflow-y-auto">
			<!-- Session A -->
			<a href="/sessions/{a.summary.sessionId}?project={encodeURIComponent(a.summary.project)}&file={encodeURIComponent(a.summary.filePath)}"
				class="block px-4 py-3 border-b border-surface-800 hover:bg-surface-800/50 transition-colors">
				<div class="flex items-center gap-2 mb-1">
					<span class="w-2 h-2 rounded-full bg-blue-500"></span>
					<span class="text-[10px] text-surface-500 uppercase">Session A</span>
				</div>
				<div class="text-surface-200 text-sm font-medium truncate">{a.summary.slug || a.summary.sessionId.slice(0, 8)}</div>
				<div class="text-surface-600 text-[10px] truncate mt-0.5">{a.summary.project}</div>
				<div class="flex items-center gap-2 mt-2 text-[10px] text-surface-500">
					<span class="text-amber-400">{shortModel(a.summary.model)}</span>
					<span>{a.summary.toolCallCount} tools</span>
					<span>{formatCost(a.summary.estimatedCost)}</span>
				</div>
			</a>

			<!-- Session B -->
			<a href="/sessions/{b.summary.sessionId}?project={encodeURIComponent(b.summary.project)}&file={encodeURIComponent(b.summary.filePath)}"
				class="block px-4 py-3 border-b border-surface-800 hover:bg-surface-800/50 transition-colors">
				<div class="flex items-center gap-2 mb-1">
					<span class="w-2 h-2 rounded-full bg-amber-500"></span>
					<span class="text-[10px] text-surface-500 uppercase">Session B</span>
				</div>
				<div class="text-surface-200 text-sm font-medium truncate">{b.summary.slug || b.summary.sessionId.slice(0, 8)}</div>
				<div class="text-surface-600 text-[10px] truncate mt-0.5">{b.summary.project}</div>
				<div class="flex items-center gap-2 mt-2 text-[10px] text-surface-500">
					<span class="text-amber-400">{shortModel(b.summary.model)}</span>
					<span>{b.summary.toolCallCount} tools</span>
					<span>{formatCost(b.summary.estimatedCost)}</span>
				</div>
			</a>
		</div>

		<!-- Main content (3/4) -->
		<div class="flex-1 overflow-y-auto">

		<div class="px-6 py-6 space-y-6">
			<!-- Stats comparison -->
			<div class="bg-surface-950 border border-surface-800 rounded-lg overflow-hidden">
				<div class="grid grid-cols-[1fr_80px_1fr] text-xs border-b border-surface-800 px-4 py-2 text-surface-500">
					<span>Session A</span>
					<span class="text-center">Delta</span>
					<span class="text-right">Session B</span>
				</div>
				{#each stats as row}
					{@const delta = getDelta(row.rawA, row.rawB)}
					<div class="grid grid-cols-[1fr_80px_1fr] text-sm border-b border-surface-800/50 last:border-0 px-4 py-2.5 items-center">
						<span class="text-surface-200 font-mono">{row.valueA}</span>
						<div class="text-center">
							<div class="text-[10px] text-surface-500">{row.label}</div>
							<div class="text-xs font-mono font-medium {delta.cls}">{delta.text}</div>
						</div>
						<span class="text-right text-surface-200 font-mono">{row.valueB}</span>
					</div>
				{/each}
			</div>

			<!-- Tool usage -->
			<div class="bg-surface-950 border border-surface-800 rounded-lg overflow-hidden">
				<div class="px-4 py-3 border-b border-surface-800">
					<h2 class="text-surface-300 text-xs font-medium uppercase tracking-wider">Tool usage</h2>
				</div>
				{#each toolComparison as tool}
					{@const max = Math.max(tool.countA, tool.countB, 1)}
					<div class="grid grid-cols-[40px_1fr_auto_1fr_40px] items-center px-4 py-2 border-b border-surface-800/30 last:border-0">
						<span class="text-xs text-surface-400 font-mono text-right">{tool.countA}</span>
						<div class="h-1.5 bg-surface-800 rounded-full overflow-hidden flex justify-end mx-2">
							<div class="h-full bg-blue-500 rounded-full" style="width: {(tool.countA / max) * 100}%"></div>
						</div>
						<div class="text-center text-xs text-surface-300 font-mono px-2 whitespace-nowrap">{tool.name}</div>
						<div class="h-1.5 bg-surface-800 rounded-full overflow-hidden mx-2">
							<div class="h-full bg-amber-500 rounded-full" style="width: {(tool.countB / max) * 100}%"></div>
						</div>
						<span class="text-xs text-surface-400 font-mono">{tool.countB}</span>
					</div>
				{/each}
			</div>

			<!-- File overlap -->
			<div class="bg-surface-950 border border-surface-800 rounded-lg overflow-hidden">
				<div class="px-4 py-3 border-b border-surface-800">
					<h2 class="text-surface-300 text-xs font-medium uppercase tracking-wider">Files touched</h2>
					<div class="flex gap-4 mt-1 text-[10px] text-surface-500">
						<span>{sharedFiles.size} shared</span>
						<span>{onlyA.size} only in A</span>
						<span>{onlyB.size} only in B</span>
					</div>
				</div>
				<div class="max-h-64 overflow-y-auto">
					{#if sharedFiles.size > 0}
						<div class="px-4 py-1 text-[10px] text-surface-600 uppercase tracking-wider bg-surface-900/50">Shared</div>
						{#each [...sharedFiles] as file}
							<div class="px-4 py-0.5 text-xs text-surface-400 font-mono truncate">{shortPath(file)}</div>
						{/each}
					{/if}
					{#if onlyA.size > 0}
						<div class="px-4 py-1 text-[10px] text-blue-400/60 uppercase tracking-wider bg-surface-900/50">Only in A</div>
						{#each [...onlyA] as file}
							<div class="px-4 py-0.5 text-xs text-surface-500 font-mono truncate">{shortPath(file)}</div>
						{/each}
					{/if}
					{#if onlyB.size > 0}
						<div class="px-4 py-1 text-[10px] text-amber-400/60 uppercase tracking-wider bg-surface-900/50">Only in B</div>
						{#each [...onlyB] as file}
							<div class="px-4 py-0.5 text-xs text-surface-500 font-mono truncate">{shortPath(file)}</div>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	</div>
	</div>
</div>
