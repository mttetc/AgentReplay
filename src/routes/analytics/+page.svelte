<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { formatCost, formatNumber, formatDuration, shortModel } from '$lib/utils/format';
	import type { ToolCallEvent } from '$lib/types/timeline';
	import {
		Chart,
		BarController,
		LineController,
		DoughnutController,
		ScatterController,
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
			BarController, LineController, DoughnutController, ScatterController,
			BarElement, LineElement, PointElement, ArcElement,
			CategoryScale, LinearScale, Tooltip, Legend, Filler
		);
		Chart.defaults.color = '#a0a0b0';
		Chart.defaults.borderColor = '#1a1a1f';
		Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";
		Chart.defaults.font.size = 11;
		Chart.defaults.plugins.tooltip.backgroundColor = '#111114';
		Chart.defaults.plugins.tooltip.borderColor = '#252530';
		Chart.defaults.plugins.tooltip.borderWidth = 1;
		Chart.defaults.plugins.tooltip.titleColor = '#ededf4';
		Chart.defaults.plugins.tooltip.bodyColor = '#ccccd8';
		Chart.defaults.plugins.tooltip.padding = 10;
		Chart.defaults.plugins.tooltip.cornerRadius = 8;
		Chart.defaults.plugins.legend.labels.usePointStyle = true;
		Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
	}

	let { data } = $props();

	// View mode
	let mode = $derived(data.selectedTimeline ? 'session' : 'global');
	let timeRange: 'all' | '7d' | '30d' | '90d' = $state('30d');

	function goGlobal() { goto('/analytics'); }

	// Canvas refs — global
	let dailyCostCanvas: HTMLCanvasElement | undefined = $state();
	let weeklyTrendCanvas: HTMLCanvasElement | undefined = $state();
	let modelDoughnutCanvas: HTMLCanvasElement | undefined = $state();
	let providerDoughnutCanvas: HTMLCanvasElement | undefined = $state();
	let tokenBarCanvas: HTMLCanvasElement | undefined = $state();
	let projectBarCanvas: HTMLCanvasElement | undefined = $state();
	let scatterCanvas: HTMLCanvasElement | undefined = $state();

	// Canvas refs — session
	let cumCostCanvas: HTMLCanvasElement | undefined = $state();
	let eventDoughnutCanvas: HTMLCanvasElement | undefined = $state();
	let toolBarCanvas: HTMLCanvasElement | undefined = $state();
	let fileBarCanvas: HTMLCanvasElement | undefined = $state();

	let charts: Chart[] = [];
	function destroyCharts() { for (const c of charts) c.destroy(); charts = []; }

	// === FILTERS ===
	function filterByRange<T extends { date?: string; week?: string }>(items: T[]): T[] {
		if (timeRange === 'all') return items;
		const cutoff = new Date(Date.now() - ({ '7d': 7, '30d': 30, '90d': 90 }[timeRange]) * 86400000);
		return items.filter((i) => (i.date || i.week || '') >= cutoff.toISOString().slice(0, 10));
	}

	let filteredDaily = $derived(filterByRange(data.dailyCosts));
	let filteredWeekly = $derived(filterByRange(data.weeklyTrend));

	let filteredTotals = $derived.by(() => {
		if (timeRange === 'all') return data.totals;
		const cutoff = new Date(Date.now() - ({ '7d': 7, '30d': 30, '90d': 90 }[timeRange]) * 86400000);
		let sessions = 0, totalCost = 0, totalInputTokens = 0, totalOutputTokens = 0, totalToolCalls = 0, totalDuration = 0;
		for (const s of data.sessions) {
			if (new Date(s.startedAt) < cutoff) continue;
			sessions++; totalCost += s.estimatedCost; totalInputTokens += s.inputTokens;
			totalOutputTokens += s.outputTokens; totalToolCalls += s.toolCallCount;
			const d = new Date(s.lastActiveAt).getTime() - new Date(s.startedAt).getTime();
			if (d > 0) totalDuration += d;
		}
		return { sessions, totalCost, totalInputTokens, totalOutputTokens, totalToolCalls,
			avgSessionDuration: sessions > 0 ? totalDuration / sessions : 0,
			avgCostPerSession: sessions > 0 ? totalCost / sessions : 0 };
	});

	let topProjects = $derived.by(() => {
		const cutoff = timeRange === 'all' ? new Date(0) : new Date(Date.now() - ({ '7d': 7, '30d': 30, '90d': 90 }[timeRange]) * 86400000);
		const m = new Map<string, { sessions: number; cost: number; tools: number }>();
		for (const s of data.sessions) {
			if (new Date(s.startedAt) < cutoff) continue;
			const e = m.get(s.project) || { sessions: 0, cost: 0, tools: 0 };
			e.sessions++; e.cost += s.estimatedCost; e.tools += s.toolCallCount;
			m.set(s.project, e);
		}
		return [...m.entries()].map(([project, d]) => ({ project, ...d })).sort((a, b) => b.cost - a.cost).slice(0, 10);
	});

	// === SESSION ANALYTICS DATA ===
	let sessionEvents = $derived(data.selectedTimeline?.events || []);
	let sessionSummary = $derived(data.selectedTimeline?.summary);

	let sessionToolBreakdown = $derived.by(() => {
		const tools: Record<string, { total: number; errors: number }> = {};
		for (const e of sessionEvents) {
			if (e.data.eventType !== 'tool_call') continue;
			const tc = e.data as ToolCallEvent;
			if (!tools[tc.toolName]) tools[tc.toolName] = { total: 0, errors: 0 };
			tools[tc.toolName].total++;
			if (tc.result?.isError) tools[tc.toolName].errors++;
		}
		return Object.entries(tools).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.total - a.total);
	});

	let sessionFileOps = $derived.by(() => {
		const files = new Map<string, { reads: number; writes: number; edits: number }>();
		for (const e of sessionEvents) {
			if (e.data.eventType !== 'tool_call') continue;
			const tc = e.data as ToolCallEvent;
			const input = tc.input as Record<string, unknown>;
			if (!['Read', 'Write', 'Edit'].includes(tc.toolName) || !input.file_path) continue;
			const parts = (input.file_path as string).split('/');
			const short = parts.slice(-2).join('/');
			if (!files.has(short)) files.set(short, { reads: 0, writes: 0, edits: 0 });
			const f = files.get(short)!;
			if (tc.toolName === 'Read') f.reads++;
			else if (tc.toolName === 'Write') f.writes++;
			else if (tc.toolName === 'Edit') f.edits++;
		}
		return [...files.entries()].map(([file, ops]) => ({ file, ...ops, total: ops.reads + ops.writes + ops.edits })).sort((a, b) => b.total - a.total).slice(0, 10);
	});

	let sessionThinking = $derived.by(() => {
		let chars = 0, blocks = 0;
		for (const e of sessionEvents) {
			if (e.data.eventType === 'thinking') { chars += (e.data as { thinking: string }).thinking.length; blocks++; }
		}
		return { estimatedTokens: Math.round(chars / 4), blocks };
	});

	let sessionToolErrors = $derived(sessionToolBreakdown.reduce((s, t) => s + t.errors, 0));
	let sessionToolTotal = $derived(sessionToolBreakdown.reduce((s, t) => s + t.total, 0));

	// === COLORS ===
	function getModelHex(m: string) { return m.includes('opus') ? '#f59e0b' : m.includes('haiku') ? '#22c55e' : '#3b82f6'; }
	function getProviderHex(p: string) { return p === 'claude-code' ? '#f97316' : p === 'cursor' ? '#0ea5e9' : p === 'windsurf' ? '#14b8a6' : '#50505e'; }
	function getProviderLabel(p: string) { return p === 'claude-code' ? 'Claude Code' : p === 'cursor' ? 'Cursor' : p === 'windsurf' ? 'Windsurf' : p; }
	function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

	const eventColors: Record<string, string> = {
		user_message: '#3b82f6', assistant_text: '#a855f7', thinking: '#f59e0b',
		tool_call: '#14b8a6', tool_result: '#10b981', system: '#50505e', compact_boundary: '#78788a'
	};
	const eventLabels: Record<string, string> = {
		user_message: 'User', assistant_text: 'Assistant', thinking: 'Thinking',
		tool_call: 'Tool Calls', tool_result: 'Tool Results', system: 'System', compact_boundary: 'Compact'
	};

	// === RENDER ===
	function renderCharts() {
		if (!browser) return;
		destroyCharts();

		if (mode === 'global') renderGlobal();
		else renderSession();
	}

	function renderGlobal() {
		// Daily cost
		if (dailyCostCanvas && filteredDaily.length > 0) {
			const maxCost = Math.max(...filteredDaily.map((d) => d.cost), 0.01);
			charts.push(new Chart(dailyCostCanvas.getContext('2d')!, {
				type: 'bar',
				data: {
					labels: filteredDaily.map((d) => fmtDate(d.date)),
					datasets: [
						{ label: 'Cost ($)', data: filteredDaily.map((d) => +d.cost.toFixed(2)),
							backgroundColor: filteredDaily.map((d) => { const r = d.cost / maxCost; return r > 0.75 ? 'rgba(239,68,68,.7)' : r > 0.5 ? 'rgba(245,158,11,.7)' : r > 0.25 ? 'rgba(59,130,246,.7)' : 'rgba(16,185,129,.7)'; }),
							borderRadius: 4, borderSkipped: false, barPercentage: 0.8 },
						{ label: 'Sessions', data: filteredDaily.map((d) => d.sessions), type: 'line',
							borderColor: 'rgba(168,85,247,.8)', backgroundColor: 'rgba(168,85,247,.1)',
							borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: 'rgba(168,85,247,1)',
							pointBorderColor: '#111114', pointBorderWidth: 2, fill: true, tension: 0.3, yAxisID: 'y1' }
					]
				},
				options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
					plugins: { legend: { display: true, position: 'top', align: 'end' },
						tooltip: { callbacks: { title: (i) => filteredDaily[i[0].dataIndex].date, label: (i) => i.datasetIndex === 0 ? `  Cost: $${i.raw}` : `  Sessions: ${i.raw}` } } },
					scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 12, color: '#78788a' } },
						y: { position: 'left', grid: { color: 'rgba(37,37,48,.5)' }, ticks: { callback: (v) => `$${v}`, color: '#78788a' } },
						y1: { position: 'right', grid: { display: false }, ticks: { stepSize: 1, color: 'rgba(168,85,247,.6)' } } } }
			}));
		}

		// Weekly trend
		if (weeklyTrendCanvas && filteredWeekly.length > 0) {
			charts.push(new Chart(weeklyTrendCanvas.getContext('2d')!, {
				type: 'line',
				data: {
					labels: filteredWeekly.map((w) => fmtDate(w.week)),
					datasets: [
						{ label: 'Weekly Cost ($)', data: filteredWeekly.map((w) => +w.cost.toFixed(2)),
							borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.15)', borderWidth: 2.5,
							pointRadius: 4, pointHoverRadius: 8, pointBackgroundColor: '#3b82f6', pointBorderColor: '#111114', pointBorderWidth: 2, fill: true, tension: 0.4 },
						{ label: 'Sessions', data: filteredWeekly.map((w) => w.sessions),
							borderColor: 'rgba(16,185,129,.8)', backgroundColor: 'rgba(16,185,129,.08)', borderWidth: 2,
							pointRadius: 3, pointHoverRadius: 6, pointBackgroundColor: '#10b981', pointBorderColor: '#111114', pointBorderWidth: 2, fill: true, tension: 0.4, yAxisID: 'y1' }
					]
				},
				options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
					plugins: { legend: { display: true, position: 'top', align: 'end' }, tooltip: { callbacks: { title: (i) => `Week of ${filteredWeekly[i[0].dataIndex].week}` } } },
					scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 10, color: '#78788a' } },
						y: { position: 'left', grid: { color: 'rgba(37,37,48,.5)' }, ticks: { callback: (v) => `$${v}`, color: '#78788a' } },
						y1: { position: 'right', grid: { display: false }, ticks: { stepSize: 1, color: 'rgba(16,185,129,.6)' } } } }
			}));
		}

		// Token bar
		if (tokenBarCanvas && filteredDaily.length > 0) {
			const cutoff = timeRange === 'all' ? new Date(0) : new Date(Date.now() - ({ '7d': 7, '30d': 30, '90d': 90 }[timeRange]) * 86400000);
			const byDay = new Map<string, { input: number; output: number }>();
			for (const s of data.sessions) {
				if (new Date(s.startedAt) < cutoff) continue;
				const d = s.startedAt.slice(0, 10);
				const e = byDay.get(d) || { input: 0, output: 0 };
				e.input += s.inputTokens; e.output += s.outputTokens; byDay.set(d, e);
			}
			const sorted = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
			charts.push(new Chart(tokenBarCanvas.getContext('2d')!, {
				type: 'bar',
				data: { labels: sorted.map(([d]) => fmtDate(d)), datasets: [
					{ label: 'Input', data: sorted.map(([, t]) => t.input), backgroundColor: 'rgba(245,158,11,.6)', borderRadius: 3, borderSkipped: false },
					{ label: 'Output', data: sorted.map(([, t]) => t.output), backgroundColor: 'rgba(59,130,246,.6)', borderRadius: 3, borderSkipped: false }
				] },
				options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
					plugins: { legend: { display: true, position: 'top', align: 'end' }, tooltip: { callbacks: { label: (i) => `  ${i.dataset.label}: ${formatNumber(i.raw as number)}` } } },
					scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, maxTicksLimit: 12, color: '#78788a' } },
						y: { stacked: true, grid: { color: 'rgba(37,37,48,.5)' }, ticks: { callback: (v) => formatNumber(v as number), color: '#78788a' } } } }
			}));
		}

		// Model doughnut
		if (modelDoughnutCanvas && data.modelUsage.length > 0) {
			charts.push(new Chart(modelDoughnutCanvas.getContext('2d')!, {
				type: 'doughnut',
				data: { labels: data.modelUsage.map((m) => shortModel(m.model)), datasets: [{ data: data.modelUsage.map((m) => +m.cost.toFixed(2)),
					backgroundColor: data.modelUsage.map((m) => getModelHex(m.model)), borderColor: '#111114', borderWidth: 3, hoverOffset: 8 }] },
				options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
					plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (i) => { const m = data.modelUsage[i.dataIndex]; return [`  Cost: $${m.cost.toFixed(2)}`, `  Sessions: ${m.sessions}`, `  Tokens: ${formatNumber(m.tokens)}`]; } } } } }
			}));
		}

		// Provider doughnut
		if (providerDoughnutCanvas && data.providerUsage.length > 0) {
			charts.push(new Chart(providerDoughnutCanvas.getContext('2d')!, {
				type: 'doughnut',
				data: { labels: data.providerUsage.map((p) => getProviderLabel(p.provider)), datasets: [{ data: data.providerUsage.map((p) => p.sessions),
					backgroundColor: data.providerUsage.map((p) => getProviderHex(p.provider)), borderColor: '#111114', borderWidth: 3, hoverOffset: 8 }] },
				options: { responsive: true, maintainAspectRatio: false, cutout: '65%',
					plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (i) => { const p = data.providerUsage[i.dataIndex]; return [`  Sessions: ${p.sessions}`, `  Cost: $${p.cost.toFixed(2)}`]; } } } } }
			}));
		}

		// Projects bar
		if (projectBarCanvas && topProjects.length > 0) {
			const labels = topProjects.map((p) => { const parts = p.project.split('/'); return parts[parts.length - 1] || p.project; });
			const colors = ['rgba(16,185,129,.7)','rgba(59,130,246,.7)','rgba(168,85,247,.7)','rgba(245,158,11,.7)','rgba(236,72,153,.7)','rgba(14,165,233,.7)','rgba(239,68,68,.7)','rgba(20,184,166,.7)','rgba(132,204,22,.7)','rgba(249,115,22,.7)'];
			charts.push(new Chart(projectBarCanvas.getContext('2d')!, {
				type: 'bar',
				data: { labels, datasets: [{ label: 'Cost ($)', data: topProjects.map((p) => +p.cost.toFixed(2)),
					backgroundColor: topProjects.map((_, i) => colors[i % colors.length]), borderRadius: 4, borderSkipped: false }] },
				options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
					plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => topProjects[i[0].dataIndex].project,
						label: (i) => { const p = topProjects[i.dataIndex]; return [`  Cost: $${p.cost.toFixed(2)}`, `  Sessions: ${p.sessions}`, `  Tool calls: ${p.tools}`]; } } } },
					scales: { x: { grid: { color: 'rgba(37,37,48,.5)' }, ticks: { callback: (v) => `$${v}`, color: '#78788a' } },
						y: { grid: { display: false }, ticks: { color: '#a0a0b0' } } } }
			}));
		}

		// Scatter
		if (scatterCanvas) {
			const cutoff = timeRange === 'all' ? new Date(0) : new Date(Date.now() - ({ '7d': 7, '30d': 30, '90d': 90 }[timeRange]) * 86400000);
			const pts = data.sessions.filter((s) => new Date(s.startedAt) >= cutoff).map((s) => {
				const dur = (new Date(s.lastActiveAt).getTime() - new Date(s.startedAt).getTime()) / 60000;
				return { x: Math.max(0, dur), y: s.estimatedCost, model: s.model, slug: s.slug || s.sessionId.slice(0, 8), project: s.project, sessionId: s.sessionId };
			}).filter((p) => p.x > 0 && p.x < 600);

			const groups = new Map<string, typeof pts>();
			for (const p of pts) { const k = p.model.includes('opus') ? 'opus' : p.model.includes('haiku') ? 'haiku' : 'sonnet'; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p); }
			const datasets = [...groups.entries()].map(([m, ps]) => ({
				label: m.charAt(0).toUpperCase() + m.slice(1), data: ps.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(2) })),
				backgroundColor: m === 'opus' ? 'rgba(245,158,11,.6)' : m === 'haiku' ? 'rgba(34,197,94,.6)' : 'rgba(59,130,246,.6)',
				borderColor: m === 'opus' ? '#f59e0b' : m === 'haiku' ? '#22c55e' : '#3b82f6',
				borderWidth: 1, pointRadius: 5, pointHoverRadius: 9, pointHoverBorderWidth: 2, pointHoverBorderColor: '#111114'
			}));
			const allPts = pts;
			charts.push(new Chart(scatterCanvas.getContext('2d')!, {
				type: 'scatter', data: { datasets },
				options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'point', intersect: true },
					onClick: (_e, elements) => {
						if (elements.length > 0) {
							const el = elements[0];
							const d = datasets[el.datasetIndex].data[el.index] as { x: number; y: number };
							const match = allPts.find((p) => Math.abs(p.x - d.x) < 0.2 && Math.abs(p.y - d.y) < 0.01);
							if (match) goto(`/analytics?session=${match.sessionId}`);
						}
					},
					plugins: { legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8 } },
						tooltip: { callbacks: { title: () => '', label: (i) => {
							const d = i.raw as { x: number; y: number };
							const match = allPts.find((p) => Math.abs(p.x - d.x) < 0.2 && Math.abs(p.y - d.y) < 0.01);
							return [match ? `  ${match.slug}` : '', `  Duration: ${d.x.toFixed(0)} min`, `  Cost: $${d.y.toFixed(2)}`, match ? `  ${match.project}` : '', '  Click to inspect'].filter(Boolean);
						} } } },
					scales: { x: { title: { display: true, text: 'Duration (min)', color: '#78788a', font: { size: 11 } }, grid: { color: 'rgba(37,37,48,.5)' }, ticks: { color: '#78788a' } },
						y: { title: { display: true, text: 'Cost ($)', color: '#78788a', font: { size: 11 } }, grid: { color: 'rgba(37,37,48,.5)' }, ticks: { callback: (v) => `$${v}`, color: '#78788a' } } } }
			}));
		}
	}

	function renderSession() {
		if (!sessionSummary) return;
		const events = sessionEvents;

		// Cumulative cost
		if (cumCostCanvas && events.length > 0) {
			let cum = 0;
			const pts: { x: number; y: number }[] = [];
			const pricing = sessionSummary.model.includes('opus') ? { i: 15, o: 75 } : sessionSummary.model.includes('haiku') ? { i: 0.8, o: 4 } : { i: 3, o: 15 };
			for (let i = 0; i < events.length; i++) {
				const e = events[i];
				if (e.tokens) cum += (e.tokens.input * pricing.i + e.tokens.output * pricing.o) / 1_000_000;
				if (i % Math.max(1, Math.floor(events.length / 200)) === 0 || i === events.length - 1) pts.push({ x: i, y: +cum.toFixed(4) });
			}
			charts.push(new Chart(cumCostCanvas.getContext('2d')!, {
				type: 'line',
				data: { labels: pts.map((p) => p.x), datasets: [{ label: 'Cumulative Cost ($)', data: pts.map((p) => p.y),
					borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.1)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
					pointHoverBackgroundColor: '#10b981', pointHoverBorderColor: '#111114', pointHoverBorderWidth: 2, fill: true, tension: 0.3 }] },
				options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
					plugins: { legend: { display: false }, tooltip: { callbacks: { title: (i) => `Event #${i[0].label}`, label: (i) => `  Cost: $${(i.raw as number).toFixed(4)}` } } },
					scales: { x: { title: { display: true, text: 'Event #', color: '#78788a', font: { size: 10 } }, grid: { display: false }, ticks: { maxTicksLimit: 8, color: '#78788a' } },
						y: { grid: { color: 'rgba(37,37,48,.5)' }, ticks: { callback: (v) => `$${v}`, color: '#78788a' } } } }
			}));
		}

		// Event doughnut
		if (eventDoughnutCanvas) {
			const counts: Record<string, number> = {};
			for (const e of events) counts[e.data.eventType] = (counts[e.data.eventType] || 0) + 1;
			const types = Object.entries(counts).filter(([, v]) => v > 0);
			charts.push(new Chart(eventDoughnutCanvas.getContext('2d')!, {
				type: 'doughnut',
				data: { labels: types.map(([k]) => eventLabels[k] || k), datasets: [{ data: types.map(([, v]) => v),
					backgroundColor: types.map(([k]) => eventColors[k] || '#50505e'), borderColor: '#111114', borderWidth: 2, hoverOffset: 6 }] },
				options: { responsive: true, maintainAspectRatio: false, cutout: '60%',
					plugins: { legend: { position: 'right', labels: { boxWidth: 10, padding: 8, font: { size: 10 } } },
						tooltip: { callbacks: { label: (i) => `  ${i.label}: ${i.raw} (${((i.raw as number) / events.length * 100).toFixed(1)}%)` } } } }
			}));
		}

		// Tool bar
		if (toolBarCanvas && sessionToolBreakdown.length > 0) {
			const tools = sessionToolBreakdown.slice(0, 10);
			charts.push(new Chart(toolBarCanvas.getContext('2d')!, {
				type: 'bar',
				data: { labels: tools.map((t) => t.name), datasets: [
					{ label: 'Success', data: tools.map((t) => t.total - t.errors), backgroundColor: 'rgba(16,185,129,.7)', borderRadius: 3, borderSkipped: false },
					{ label: 'Errors', data: tools.map((t) => t.errors), backgroundColor: 'rgba(239,68,68,.7)', borderRadius: 3, borderSkipped: false }
				] },
				options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
					plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 10 } } },
						tooltip: { callbacks: { afterLabel: (i) => { const t = tools[i.dataIndex]; return `  Success rate: ${(((t.total - t.errors) / t.total) * 100).toFixed(0)}%`; } } } },
					scales: { x: { stacked: true, grid: { color: 'rgba(37,37,48,.5)' }, ticks: { stepSize: 1, color: '#78788a' } },
						y: { stacked: true, grid: { display: false }, ticks: { color: '#a0a0b0', font: { size: 10 } } } } }
			}));
		}

		// File bar
		if (fileBarCanvas && sessionFileOps.length > 0) {
			charts.push(new Chart(fileBarCanvas.getContext('2d')!, {
				type: 'bar',
				data: { labels: sessionFileOps.map((f) => f.file), datasets: [
					{ label: 'Read', data: sessionFileOps.map((f) => f.reads), backgroundColor: 'rgba(59,130,246,.7)', borderRadius: 2, borderSkipped: false },
					{ label: 'Write', data: sessionFileOps.map((f) => f.writes), backgroundColor: 'rgba(168,85,247,.7)', borderRadius: 2, borderSkipped: false },
					{ label: 'Edit', data: sessionFileOps.map((f) => f.edits), backgroundColor: 'rgba(245,158,11,.7)', borderRadius: 2, borderSkipped: false }
				] },
				options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y',
					plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 10 } } } },
					scales: { x: { stacked: true, grid: { color: 'rgba(37,37,48,.5)' }, ticks: { stepSize: 1, color: '#78788a' } },
						y: { stacked: true, grid: { display: false }, ticks: { color: '#a0a0b0', font: { size: 9 } } } } }
			}));
		}
	}

	$effect(() => {
		filteredDaily; filteredWeekly; topProjects; timeRange; mode; sessionEvents;
		if (browser && (dailyCostCanvas || cumCostCanvas)) queueMicrotask(renderCharts);
	});
</script>

<svelte:head>
	<title>analytics</title>
</svelte:head>

<div class="px-4 py-4 sm:px-6 sm:py-5">
	<!-- Top bar -->
	<div class="flex items-center gap-3 mb-5">
		{#if mode === 'session' && sessionSummary}
			<a
				href="/sessions/{sessionSummary.sessionId}?project={encodeURIComponent(sessionSummary.project)}&file={encodeURIComponent(sessionSummary.filePath)}"
				class="text-surface-500 hover:text-blue-400 transition-colors text-xs"
			>&#8592; Session</a>
			<span class="text-surface-700">|</span>
			<span class="text-sm text-surface-200 font-medium truncate">{sessionSummary.slug?.slice(0, 40) || sessionSummary.sessionId.slice(0, 8)}</span>
			<span class="text-xs text-surface-500 truncate hidden sm:inline">{sessionSummary.project}</span>
		{:else}
			<div class="flex gap-1">
				{#each [['7d', '7d'], ['30d', '30d'], ['90d', '90d'], ['all', 'All']] as [key, label]}
					<button
						onclick={() => (timeRange = key as typeof timeRange)}
						class="px-2.5 py-1 rounded text-[11px] font-medium transition-colors
							{timeRange === key ? 'bg-surface-800 text-surface-200' : 'text-surface-500 hover:text-surface-300'}"
					>{label}</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if mode === 'global'}
		<!-- GLOBAL VIEW -->
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Sessions</div>
				<div class="text-lg font-bold text-surface-100" style="font-family: 'Space Grotesk', sans-serif;">{filteredTotals.sessions}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Total Cost</div>
				<div class="text-lg font-bold text-emerald-400" style="font-family: 'Space Grotesk', sans-serif;">{formatCost(filteredTotals.totalCost)}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Avg/Session</div>
				<div class="text-lg font-bold text-surface-200" style="font-family: 'Space Grotesk', sans-serif;">{formatCost(filteredTotals.avgCostPerSession)}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Tool Calls</div>
				<div class="text-lg font-bold text-cyan-400" style="font-family: 'Space Grotesk', sans-serif;">{formatNumber(filteredTotals.totalToolCalls)}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Tokens In</div>
				<div class="text-lg font-bold text-amber-400" style="font-family: 'Space Grotesk', sans-serif;">{formatNumber(filteredTotals.totalInputTokens)}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Avg Duration</div>
				<div class="text-lg font-bold text-surface-200" style="font-family: 'Space Grotesk', sans-serif;">{formatDuration(filteredTotals.avgSessionDuration)}</div>
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-4">
				<div class="h-56"><canvas bind:this={dailyCostCanvas}></canvas></div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-4">
				<div class="h-56"><canvas bind:this={weeklyTrendCanvas}></canvas></div>
			</div>
		</div>

		<div class="bg-surface-900 border border-surface-800 rounded-lg p-4 mb-5">
			<div class="h-56"><canvas bind:this={tokenBarCanvas}></canvas></div>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-4">
				<div class="h-52"><canvas bind:this={modelDoughnutCanvas}></canvas></div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-4">
				<div class="h-52"><canvas bind:this={providerDoughnutCanvas}></canvas></div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-4 lg:col-span-2">
				<div class="h-52"><canvas bind:this={projectBarCanvas}></canvas></div>
			</div>
		</div>

		<div class="bg-surface-900 border border-surface-800 rounded-lg p-4 mb-5">
			<p class="text-[10px] text-surface-500 mb-2">Click a point to inspect that session</p>
			<div class="h-72"><canvas bind:this={scatterCanvas}></canvas></div>
		</div>

	{:else if sessionSummary}
		<!-- SESSION VIEW — same structure as global -->
		{@const dur = new Date(sessionSummary.lastActiveAt).getTime() - new Date(sessionSummary.startedAt).getTime()}
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Events</div>
				<div class="text-lg font-bold text-surface-100" style="font-family: 'Space Grotesk', sans-serif;">{sessionEvents.length}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Cost</div>
				<div class="text-lg font-bold text-emerald-400" style="font-family: 'Space Grotesk', sans-serif;">{formatCost(sessionSummary.estimatedCost)}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Tool Calls</div>
				<div class="text-lg font-bold text-cyan-400" style="font-family: 'Space Grotesk', sans-serif;">{sessionToolTotal}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Errors</div>
				<div class="text-lg font-bold {sessionToolErrors > 0 ? 'text-red-400' : 'text-emerald-400'}" style="font-family: 'Space Grotesk', sans-serif;">{sessionToolErrors}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Tokens In</div>
				<div class="text-lg font-bold text-amber-400" style="font-family: 'Space Grotesk', sans-serif;">{formatNumber(sessionSummary.inputTokens)}</div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
				<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-1">Duration</div>
				<div class="text-lg font-bold text-surface-200" style="font-family: 'Space Grotesk', sans-serif;">{formatDuration(dur)}</div>
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-4">
				<div class="h-56"><canvas bind:this={cumCostCanvas}></canvas></div>
			</div>
			<div class="bg-surface-900 border border-surface-800 rounded-lg p-4">
				<div class="h-56"><canvas bind:this={eventDoughnutCanvas}></canvas></div>
			</div>
		</div>

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
			{#if sessionToolBreakdown.length > 0}
				<div class="bg-surface-900 border border-surface-800 rounded-lg p-4">
					<div class="h-56"><canvas bind:this={toolBarCanvas}></canvas></div>
				</div>
			{/if}
			{#if sessionFileOps.length > 0}
				<div class="bg-surface-900 border border-surface-800 rounded-lg p-4">
					<div class="h-56"><canvas bind:this={fileBarCanvas}></canvas></div>
				</div>
			{/if}
		</div>
	{/if}
</div>
