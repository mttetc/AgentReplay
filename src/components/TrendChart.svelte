<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	interface Dataset {
		label: string;
		data: number[];
		borderColor: string;
		backgroundColor?: string;
		fill?: boolean;
		borderWidth?: number;
	}

	let {
		labels,
		datasets,
		title
	}: {
		labels: string[];
		datasets: Dataset[];
		title: string;
	} = $props();

	import type { Chart as ChartType } from 'chart.js';

	let canvas: HTMLCanvasElement | undefined = $state();
	let chartInstance: ChartType | null = null;

	onMount(() => {
		if (!browser || !canvas || labels.length < 2) return;

		initChart();

		return () => {
			chartInstance?.destroy();
		};
	});

	async function initChart() {
		if (!canvas) return;

		const { Chart, LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip } = await import('chart.js');
		Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip);

		chartInstance = new Chart(canvas, {
			type: 'line',
			data: { labels, datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: false },
					tooltip: { mode: 'index', intersect: false }
				},
				scales: {
					x: {
						grid: { color: 'rgba(255,255,255,0.05)' },
						ticks: { color: '#666', font: { size: 10 } }
					},
					y: {
						grid: { color: 'rgba(255,255,255,0.05)' },
						ticks: { color: '#666', font: { size: 10 } },
						beginAtZero: true
					}
				},
				elements: {
					point: { radius: 2, hoverRadius: 4 },
					line: { tension: 0.3 }
				}
			}
		});
	}
</script>

<div class="bg-surface-900 border border-surface-800 rounded-lg p-3">
	<div class="text-[10px] text-surface-500 uppercase tracking-wider mb-2">{title}</div>
	<div class="h-40">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
