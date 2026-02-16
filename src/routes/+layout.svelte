<script lang="ts">
	import '../app.css';
	import { getPlan, setPlan, PLAN_LABELS, type PlanType } from '$lib/stores/plan.svelte';

	let { children } = $props();
	let planOpen = $state(false);

	const planTypes: PlanType[] = ['api', 'pro', 'max', 'enterprise'];

	function selectPlan(p: PlanType) {
		setPlan(p);
		planOpen = false;
	}
</script>

<svelte:window onclick={() => (planOpen = false)} />

<div class="min-h-screen flex flex-col">
	<header class="bg-surface-900/80 backdrop-blur-sm sticky top-0 z-50">
		<nav class="px-4 h-14 flex items-center gap-4">
			<a href="/" class="flex items-center gap-2 text-surface-100 hover:text-white transition-colors">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" class="w-6 h-6">
					<defs>
						<linearGradient id="ghost-grad" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="#67e8f9"/>
							<stop offset="100%" stop-color="#818cf8"/>
						</linearGradient>
					</defs>
					<path d="M16 2C9.373 2 4 7.373 4 14v14l3-3 3 3 3-3 3 3 3-3 3 3 3-3 3 3V14c0-6.627-5.373-12-12-12z" fill="url(#ghost-grad)"/>
					<circle cx="12" cy="14" r="2.5" fill="#0f172a"/>
					<circle cx="20" cy="14" r="2.5" fill="#0f172a"/>
					<circle cx="13" cy="13.2" r="0.8" fill="#fff"/>
					<circle cx="21" cy="13.2" r="0.8" fill="#fff"/>
				</svg>
				<span class="font-semibold tracking-tight">Agent Replay</span>
			</a>
			<span class="text-surface-600 text-xs hidden sm:inline">DevTools for AI Agents</span>

			<div class="ml-auto relative">
				<button
					onclick={(e: MouseEvent) => { e.stopPropagation(); planOpen = !planOpen; }}
					class="px-2.5 py-1 rounded-full text-xs font-medium bg-surface-800 text-surface-300 hover:text-surface-100 border border-surface-700 hover:border-surface-600 transition-colors"
				>
					{PLAN_LABELS[getPlan()]}
				</button>
				{#if planOpen}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						onclick={(e: MouseEvent) => e.stopPropagation()}
						class="absolute right-0 mt-2 w-36 bg-surface-900 border border-surface-700 rounded-lg shadow-xl overflow-hidden z-50"
					>
						{#each planTypes as p}
							<button
								onclick={() => selectPlan(p)}
								class="w-full text-left px-3 py-2 text-xs transition-colors {getPlan() === p
									? 'bg-surface-800 text-surface-100'
									: 'text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'}"
							>
								{PLAN_LABELS[p]}
								{#if p !== 'api'}
									<span class="text-surface-600 ml-1">included</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</nav>
		<div class="h-[2px] bg-gradient-to-r from-purple-500/50 via-blue-500/50 to-cyan-500/50"></div>
	</header>

	<main class="flex-1">
		{@render children()}
	</main>
</div>
