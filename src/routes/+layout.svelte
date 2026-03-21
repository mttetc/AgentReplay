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
	<header class="bg-[#08080a]/80 backdrop-blur-xl backdrop-saturate-[1.2] sticky top-0 z-50 border-b border-surface-800/50">
		<nav class="px-4 h-14 flex items-center gap-4">
			<a href="/" class="flex items-center gap-2 hover:opacity-80 transition-opacity">
				<svg width="20" height="20" viewBox="0 0 32 32">
					<rect width="32" height="32" rx="7" fill="#1a1a1f"/>
					<text x="4" y="22" font-family="'Space Grotesk',system-ui" font-weight="700" font-size="14" fill="#3b82f6">ar</text>
				</svg>
				<span class="font-bold text-[16px] tracking-[-0.03em]" style="font-family: 'Space Grotesk', -apple-system, sans-serif;">
					<span class="text-surface-100">agent</span><span class="text-blue-500">replay</span>
				</span>
			</a>
			<span class="text-surface-600 text-xs hidden sm:inline">DevTools for AI Agents</span>

			<div class="ml-auto relative">
				<button
					onclick={(e: MouseEvent) => { e.stopPropagation(); planOpen = !planOpen; }}
					class="px-2.5 py-1 rounded-md text-xs font-medium bg-surface-900 text-surface-400 hover:text-surface-200 border border-surface-800 hover:border-surface-600 transition-colors"
				>
					{PLAN_LABELS[getPlan()]}
				</button>
				{#if planOpen}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						onclick={(e: MouseEvent) => e.stopPropagation()}
						class="absolute right-0 mt-2 w-36 bg-surface-900 border border-surface-800 rounded-lg shadow-xl overflow-hidden z-50"
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
	</header>

	<main class="flex-1">
		{@render children()}
	</main>
</div>
