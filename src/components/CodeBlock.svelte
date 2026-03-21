<script lang="ts">
	import { createHighlighter, type Highlighter } from 'shiki';

	let { content, language = 'text', maxHeight = '24rem', filePath = '' }: {
		content: string;
		language?: string;
		maxHeight?: string;
		filePath?: string;
	} = $props();

	let highlightedLines: string[] | null = $state(null);
	let highlighter: Highlighter | null = null;

	const BUNDLED_LANGS = [
		'typescript', 'javascript', 'tsx', 'jsx', 'json', 'python', 'bash',
		'markdown', 'css', 'scss', 'html', 'svelte', 'vue', 'rust', 'go',
		'yaml', 'toml', 'sql', 'ruby', 'java', 'kotlin', 'swift', 'c', 'cpp',
		'graphql', 'dockerfile'
	];

	async function highlight(code: string, lang: string) {
		if (lang === 'text' || !BUNDLED_LANGS.includes(lang)) {
			highlightedLines = null;
			return;
		}
		try {
			if (!highlighter) {
				highlighter = await createHighlighter({
					themes: ['github-dark-default'],
					langs: BUNDLED_LANGS
				});
			}
			const tokens = highlighter.codeToTokens(code, {
				lang,
				theme: 'github-dark-default'
			});
			highlightedLines = tokens.tokens.map(line =>
				line.map(token => {
					let color = token.color || '#a0a0b0';
					// Dim overly bright default text to match our surface-300
					if (isBright(color)) color = '#a0a0b0';
					return `<span style="color:${color}">${escapeHtml(token.content)}</span>`;
				}).join('')
			);
		} catch {
			highlightedLines = null;
		}
	}

	function isBright(hex: string): boolean {
		const c = hex.replace('#', '');
		const r = parseInt(c.substring(0, 2), 16);
		const g = parseInt(c.substring(2, 4), 16);
		const b = parseInt(c.substring(4, 6), 16);
		return (r + g + b) / 3 > 180;
	}

	function escapeHtml(str: string): string {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	$effect(() => {
		highlight(cleanContent, language);
	});

	// Strip line numbers already present in Claude Code output (e.g. "  1→content" or "  1\tcontent")
	let cleanContent = $derived.by(() => {
		const rawLines = content.split('\n');
		if (rawLines.length < 2) return content;
		// Check if first few non-empty lines match the pattern: optional spaces + number + tab/→
		const lineNumPattern = /^\s*\d+[\t→]/;
		const sample = rawLines.slice(0, 5).filter(l => l.trim());
		if (sample.length > 0 && sample.every(l => lineNumPattern.test(l))) {
			return rawLines.map(l => l.replace(/^\s*\d+[\t→]/, '')).join('\n');
		}
		return content;
	});

	let lines = $derived(cleanContent.split('\n'));
	let copied = $state(false);

	async function copyContent() {
		const text = filePath ? `${filePath}\n\n${cleanContent}` : cleanContent;
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="rounded-md border border-surface-800 overflow-hidden">
	<div class="flex items-center justify-between px-3 py-1.5 bg-surface-800/50 border-b border-surface-800">
		<span class="text-surface-500 text-xs font-mono">{lines.length} lines</span>
		<button
			onclick={copyContent}
			class="text-[10px] text-surface-500 hover:text-surface-300 transition-colors px-1.5 py-0.5 rounded border border-surface-700 hover:border-surface-600"
		>
			{copied ? '✓ copied' : 'copy'}
		</button>
	</div>
	<div class="overflow-x-auto font-mono text-xs" style="max-height: {maxHeight}; overflow-y: auto;">
		<table class="w-full">
			<tbody>
				{#each lines as line, i}
					<tr class="hover:bg-surface-800/30">
						<td class="text-surface-600 text-right px-2 py-0 select-none w-1 whitespace-nowrap border-r border-surface-800">
							{i + 1}
						</td>
						<td class="text-surface-300 px-3 py-0 whitespace-pre">
							{#if highlightedLines && highlightedLines[i] !== undefined}
								{@html highlightedLines[i]}
							{:else}
								{line}
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
