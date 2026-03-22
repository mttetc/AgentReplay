<script lang="ts">
	import { browser } from '$app/environment';
	import type { TimelineEvent, SessionSummary, ToolCallEvent } from '$lib/types/timeline';
	import { formatCost, formatNumber, shortModel } from '$lib/utils/format';
	import {
		Chart,
		BarController,
		LineController,
		DoughnutController,
		BarElement,
		LineElement,
		PointElement,
		ArcElement,
		CategoryScale,
		LinearScale,
		Tooltip,
		Legend,
		Filler
	} from 'chart.js';

	if (browser) {
		Chart.register(
			BarController, LineController, DoughnutController,
			BarElement, LineElement, PointElement, ArcElement,
			CategoryScale, LinearScale, Tooltip, Legend, Filler
		);
	}

	let { events, summary }: { events: TimelineEvent[]; summary: SessionSummary } = $props();

	let cumulativeCostCanvas: HTMLCanvasElement | undefined = $state();
	let eventTypeDoughnutCanvas: HTMLCanvasElement | undefined = $state();
	let toolBreakdownCanvas: HTMLCanvasElement | undefined = $state();
	let topFilesCanvas: HTMLCanvasElement | undefined = $state();

	let charts: Chart[] = [];

	function destroyCharts() {
		for (const c of charts) c.destroy();
		charts = [];
	}

	// Computed data
	let eventTypeBreakdown = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const e of events) {
			const t = e.data.eventType;
			counts[t] = (counts[t] || 0) + 1;
		}
		return counts;
	});

	let toolBreakdown = $derived.by(() => {
		const tools: Record<string, { total: number; errors: number }> = {};
		for (const e of events) {
			if (e.data.eventType !== 'tool_call') continue;
			const tc = e.data as ToolCallEvent;
			if (!tools[tc.toolName]) tools[tc.toolName] = { total: 0, errors: 0 };
			tools[tc.toolName].total++;
			if (tc.result?.isError) tools[tc.toolName].errors++;
		}
		return Object.entries(tools)
			.map(([name, d]) => ({ name, ...d, successRate: d.total > 0 ? ((d.total - d.errors) / d.total) * 100 : 100 }))
			.sort((a, b) => b.total - a.total);
	});

	let fileOperations = $derived.by(() => {
		const files = new Map<string, { reads: number; writes: number; edits: number }>();
		for (const e of events) {
			if (e.data.eventType !== 'tool_call') continue;
			const tc = e.data as ToolCallEvent;
			const input = tc.input as Record<string, unknown>;
			const filePath = (input.file_path || input.path || input.command || '') as string;
			if (!filePath || filePath.length > 200) continue;

			// Extract file path from various tools
			let file = '';
			if (['Read', 'Write', 'Edit'].includes(tc.toolName) && input.file_path) {
				file = input.file_path as string;
			} else if (tc.toolName === 'Glob' && input.pattern) {
				continue; // Skip glob patterns
			} else {
				continue;
			}

			// Shorten to last 2 segments
			const parts = file.split('/');
			const short = parts.slice(-2).join('/');

			if (!files.has(short)) files.set(short, { reads: 0, writes: 0, edits: 0 });
			const f = files.get(short)!;
			if (tc.toolName === 'Read') f.reads++;
			else if (tc.toolName === 'Write') f.writes++;
			else if (tc.toolName === 'Edit') f.edits++;
		}
		return [...files.entries()]
			.map(([file, ops]) => ({ file, ...ops, total: ops.reads + ops.writes + ops.edits }))
			.sort((a, b) => b.total - a.total)
			.slice(0, 10);
	});

	// Summary stats for the top cards
	let toolErrorCount = $derived(toolBreakdown.reduce((s, t) => s + t.errors, 0));
	let toolTotalCount = $derived(toolBreakdown.reduce((s, t) => s + t.total, 0));
	// Estimate thinking tokens from text length (~4 chars/token for Claude)
	let thinkingStats = $derived.by(() => {
		let chars = 0;
		let blocks = 0;
		for (const e of events) {
			if (e.data.eventType === 'thinking') {
				chars += (e.data as { thinking: string }).thinking.length;
				blocks++;
			}
		}
		return { estimatedTokens: Math.round(chars / 4), blocks, chars };
	});

	// Count tokens for turns that contain tool calls (deduplicated per turn timestamp)
	let toolTokens = $derived.by(() => {
		const seenTurns = new Set<string>();
		let tokens = 0;
		for (const e of events) {
			if (e.data.eventType === 'tool_call' && e.tokens) {
				const turnKey = `${e.timestamp}-${e.tokens.input}-${e.tokens.output}`;
				if (!seenTurns.has(turnKey)) {
					seenTurns.add(turnKey);
					tokens += e.tokens.input + e.tokens.output;
				}
			}
		}
		return tokens;
	});

	const eventTypeColors: Record<string, string> = {
		user_message: '#3b82f6',
		assistant_text: '#a855f7',
		thinking: '#f59e0b',
		tool_call: '#14b8a6',
		tool_result: '#10b981',
		system: '#50505e',
		compact_boundary: '#78788a'
	};

	const eventTypeLabels: Record<string, string> = {
		user_message: 'User',
		assistant_text: 'Assistant',
		thinking: 'Thinking',
		tool_call: 'Tool Calls',
		tool_result: 'Tool Results',
		system: 'System',
		compact_boundary: 'Compact'
	};

	function renderCharts() {
		if (!browser) return;
		destroyCharts();

		// 1. Cumulative cost line
		if (cumulativeCostCanvas && events.length > 0) {
			const ctx = cumulativeCostCanvas.getContext('2d')!;
			let cumCost = 0;
			const points: { x: number; y: number }[] = [];

			for (let i = 0; i < events.length; i++) {
				const e = events[i];
				if (e.tokens) {
					// Rough cost per event based on model pricing
					const pricing = summary.model.includes('opus') ? { in: 15, out: 75 }
						: summary.model.includes('haiku') ? { in: 0.8, out: 4 }
						: { in: 3, out: 15 };
					cumCost += (e.tokens.input * pricing.in + e.tokens.output * pricing.out) / 1_000_000;
				}
				// Sample every N events to keep chart manageable
				if (i % Math.max(1, Math.floor(events.length / 200)) === 0 || i === events.length - 1) {
					points.push({ x: i, y: +cumCost.toFixed(4) });
				}
			}

			charts.push(new Chart(ctx, {
				type: 'line',
				data: {
					labels: points.map((p) => p.x),
					datasets: [{
						label: 'Cumulative Cost ($)',
						data: points.map((p) => p.y),
						borderColor: '#10b981',
						backgroundColor: 'rgba(16, 185, 129, 0.1)',
						borderWidth: 2,
						pointRadius: 0,
						pointHoverRadius: 5,
						pointHoverBackgroundColor: '#10b981',
						pointHoverBorderColor: '#111114',
						pointHoverBorderWidth: 2,
						fill: true,
						tension: 0.3
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					interaction: { mode: 'index', intersect: false },
					plugins: {
						legend: { display: false },
						tooltip: {
							callbacks: {
								title: (items) => `Event #${items[0].label}`,
								label: (item) => `  Cost: $${(item.raw as number).toFixed(4)}`
							}
						}
					},
					scales: {
						x: {
							display: true,
							title: { display: true, text: 'Event #', color: '#78788a', font: { size: 10 } },
							grid: { display: false },
							ticks: { maxTicksLimit: 8, color: '#78788a' }
						},
						y: {
							grid: { color: 'rgba(37, 37, 48, 0.5)' },
							ticks: { callback: (v) => `$${v}`, color: '#78788a' }
						}
					}
				}
			}));
		}

		// 2. Event type doughnut
		if (eventTypeDoughnutCanvas) {
			const ctx = eventTypeDoughnutCanvas.getContext('2d')!;
			const types = Object.entries(eventTypeBreakdown).filter(([, v]) => v > 0);

			charts.push(new Chart(ctx, {
				type: 'doughnut',
				data: {
					labels: types.map(([k]) => eventTypeLabels[k] || k),
					datasets: [{
						data: types.map(([, v]) => v),
						backgroundColor: types.map(([k]) => eventTypeColors[k] || '#50505e'),
						borderColor: '#111114',
						borderWidth: 2,
						hoverOffset: 6
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					cutout: '60%',
					plugins: {
						legend: { display: true, position: 'right', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
						tooltip: {
							callbacks: {
								label: (item) => {
									const total = events.length;
									const pct = ((item.raw as number) / total * 100).toFixed(1);
									return `  ${item.label}: ${item.raw} (${pct}%)`;
								}
							}
						}
					}
				}
			}));
		}

		// 3. Tool breakdown — horizontal bar with error overlay
		if (toolBreakdownCanvas && toolBreakdown.length > 0) {
			const ctx = toolBreakdownCanvas.getContext('2d')!;
			const tools = toolBreakdown.slice(0, 8);

			charts.push(new Chart(ctx, {
				type: 'bar',
				data: {
					labels: tools.map((t) => t.name),
					datasets: [
						{
							label: 'Success',
							data: tools.map((t) => t.total - t.errors),
							backgroundColor: 'rgba(16, 185, 129, 0.7)',
							borderRadius: 3,
							borderSkipped: false
						},
						{
							label: 'Errors',
							data: tools.map((t) => t.errors),
							backgroundColor: 'rgba(239, 68, 68, 0.7)',
							borderRadius: 3,
							borderSkipped: false
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					indexAxis: 'y',
					plugins: {
						legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 10 } } },
						tooltip: {
							callbacks: {
								afterLabel: (item) => {
									const t = tools[item.dataIndex];
									return `  Success rate: ${t.successRate.toFixed(0)}%`;
								}
							}
						}
					},
					scales: {
						x: {
							stacked: true,
							grid: { color: 'rgba(37, 37, 48, 0.5)' },
							ticks: { stepSize: 1, color: '#78788a' }
						},
						y: {
							stacked: true,
							grid: { display: false },
							ticks: { color: '#a0a0b0', font: { size: 10 } }
						}
					}
				}
			}));
		}

		// 4. Top files — horizontal bar
		if (topFilesCanvas && fileOperations.length > 0) {
			const ctx = topFilesCanvas.getContext('2d')!;
			const files = fileOperations.slice(0, 8);

			charts.push(new Chart(ctx, {
				type: 'bar',
				data: {
					labels: files.map((f) => f.file),
					datasets: [
						{
							label: 'Read',
							data: files.map((f) => f.reads),
							backgroundColor: 'rgba(59, 130, 246, 0.7)',
							borderRadius: 2,
							borderSkipped: false
						},
						{
							label: 'Write',
							data: files.map((f) => f.writes),
							backgroundColor: 'rgba(168, 85, 247, 0.7)',
							borderRadius: 2,
							borderSkipped: false
						},
						{
							label: 'Edit',
							data: files.map((f) => f.edits),
							backgroundColor: 'rgba(245, 158, 11, 0.7)',
							borderRadius: 2,
							borderSkipped: false
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					indexAxis: 'y',
					plugins: {
						legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 10 } } },
						tooltip: {
							callbacks: {
								title: (items) => {
									const f = files[items[0].dataIndex];
									return f.file;
								},
								afterBody: (items) => {
									const f = files[items[0].dataIndex];
									return `  Total: ${f.total} ops`;
								}
							}
						}
					},
					scales: {
						x: {
							stacked: true,
							grid: { color: 'rgba(37, 37, 48, 0.5)' },
							ticks: { stepSize: 1, color: '#78788a' }
						},
						y: {
							stacked: true,
							grid: { display: false },
							ticks: { color: '#a0a0b0', font: { size: 9 } }
						}
					}
				}
			}));
		}
	}

	$effect(() => {
		events;
		if (browser && cumulativeCostCanvas) {
			queueMicrotask(renderCharts);
		}
		return destroyCharts;
	});
</script>

<div class="space-y-3 pb-2">
	<!-- Row 1: KPIs + Cumulative cost -->
	<div class="grid grid-cols-1 lg:grid-cols-4 gap-3">
		<!-- KPI cards -->
		<div class="flex gap-2 lg:flex-col lg:gap-2">
			<div class="flex-1 bg-surface-900/60 border border-surface-800 rounded-lg p-2.5">
				<div class="text-[9px] text-surface-500 uppercase tracking-wider">Tool Errors</div>
				<div class="text-base font-bold {toolErrorCount > 0 ? 'text-red-400' : 'text-emerald-400'}" style="font-family: 'Space Grotesk', sans-serif;">
					{toolErrorCount}<span class="text-surface-500 text-[10px] font-normal">/{toolTotalCount}</span>
				</div>
			</div>
			<div class="flex-1 bg-surface-900/60 border border-surface-800 rounded-lg p-2.5">
				<div class="text-[9px] text-surface-500 uppercase tracking-wider">Thinking</div>
				<div class="text-base font-bold text-amber-400" style="font-family: 'Space Grotesk', sans-serif;">
					~{formatNumber(thinkingStats.estimatedTokens)}<span class="text-surface-500 text-[10px] font-normal ml-1">tok</span>
				</div>
				<div class="text-[9px] text-surface-500">{thinkingStats.blocks} blocks</div>
			</div>
		</div>

		<!-- Cumulative cost (wider) -->
		<div class="lg:col-span-3 bg-surface-900/60 border border-surface-800 rounded-lg p-3">
			<h3 class="text-[10px] text-surface-400 uppercase tracking-wider mb-1">Cumulative Cost</h3>
			<div class="h-28">
				<canvas bind:this={cumulativeCostCanvas}></canvas>
			</div>
		</div>
	</div>

	<!-- Row 2: Event breakdown + Tool usage + Files -->
	<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
		<!-- Event type breakdown -->
		<div class="bg-surface-900/60 border border-surface-800 rounded-lg p-3">
			<h3 class="text-[10px] text-surface-400 uppercase tracking-wider mb-1">Event Breakdown</h3>
			<div class="h-36">
				<canvas bind:this={eventTypeDoughnutCanvas}></canvas>
			</div>
		</div>

		<!-- Tool usage -->
		{#if toolBreakdown.length > 0}
			<div class="bg-surface-900/60 border border-surface-800 rounded-lg p-3">
				<h3 class="text-[10px] text-surface-400 uppercase tracking-wider mb-1">Tools (Success / Errors)</h3>
				<div class="h-36">
					<canvas bind:this={toolBreakdownCanvas}></canvas>
				</div>
			</div>
		{/if}

		<!-- Top files -->
		{#if fileOperations.length > 0}
			<div class="bg-surface-900/60 border border-surface-800 rounded-lg p-3">
				<h3 class="text-[10px] text-surface-400 uppercase tracking-wider mb-1">Most Touched Files</h3>
				<div class="h-36">
					<canvas bind:this={topFilesCanvas}></canvas>
				</div>
			</div>
		{/if}
	</div>
</div>
