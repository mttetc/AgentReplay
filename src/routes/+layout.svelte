<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	let currentPath = $derived(page.url.pathname);
	let transitionKey = $derived(currentPath);
</script>

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
			<div class="flex items-center gap-1 ml-4">
				<a
					href="/"
					class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
						{currentPath === '/' || currentPath.startsWith('/sessions')
							? 'bg-surface-800 text-surface-100'
							: 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'}"
				>Sessions</a>
				<a
					href="/analytics"
					class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
						{currentPath === '/analytics'
							? 'bg-surface-800 text-surface-100'
							: 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'}"
				>Analytics</a>
			</div>
			<span class="text-surface-400 text-xs hidden sm:inline ml-auto">DevTools for AI Agents</span>
		</nav>
	</header>

	<main class="flex-1">
		{#key transitionKey}
			<div class="page-transition">
				{@render children()}
			</div>
		{/key}
	</main>
</div>
