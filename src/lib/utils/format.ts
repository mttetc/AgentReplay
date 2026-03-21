/** Format a duration in ms to a human readable string */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return `${hours}h ${remainingMinutes}m`;
}

/** Format a duration between two ISO timestamps */
export function formatDurationBetween(start: string, end: string): string {
	const ms = new Date(end).getTime() - new Date(start).getTime();
	if (ms <= 0) return '0s';
	return formatDuration(ms);
}

/** Format a date to a relative/short string */
export function formatDate(isoString: string): string {
	const date = new Date(isoString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffMins < 1) return 'just now';
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;

	return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a date to a full datetime string */
export function formatFullDate(isoString: string): string {
	return new Date(isoString).toLocaleString('en-US', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

/** Format a number with K/M suffix */
export function formatNumber(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

/** Format cost in USD */
export function formatCost(cost: number): string {
	if (cost < 0.01) return '<$0.01';
	return `$${cost.toFixed(2)}`;
}

/** Format cost with plan awareness */
export function formatCostWithPlan(cost: number, included: boolean): string {
	const base = formatCost(cost);
	return included ? `~${base}` : base;
}

/** Extract a short display name from a model ID (e.g. "claude-opus-4-6" → "Opus 4.6") */
export function shortModel(model: string): string {
	if (!model || model === 'synthetic') return 'Unknown';
	const m = model.toLowerCase();
	const versionMatch = m.match(/(\d+)-(\d+)(?:-|$)/);
	const version = versionMatch ? ` ${versionMatch[1]}.${versionMatch[2]}` : '';
	if (m.includes('opus')) return `Opus${version}`;
	if (m.includes('sonnet')) return `Sonnet${version}`;
	if (m.includes('haiku')) return `Haiku${version}`;
	return model;
}

/** Truncate text to a maximum length */
export function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 1) + '…';
}

/** Infer language from a file path extension */
export function inferLanguage(filePath: string): string {
	const ext = filePath.split('.').pop()?.toLowerCase() || '';
	const map: Record<string, string> = {
		ts: 'typescript',
		tsx: 'tsx',
		js: 'javascript',
		jsx: 'jsx',
		json: 'json',
		md: 'markdown',
		py: 'python',
		rs: 'rust',
		go: 'go',
		sh: 'bash',
		bash: 'bash',
		zsh: 'bash',
		css: 'css',
		scss: 'scss',
		html: 'html',
		svelte: 'svelte',
		vue: 'vue',
		yaml: 'yaml',
		yml: 'yaml',
		toml: 'toml',
		sql: 'sql',
		graphql: 'graphql',
		dockerfile: 'dockerfile',
		rb: 'ruby',
		java: 'java',
		kt: 'kotlin',
		swift: 'swift',
		c: 'c',
		cpp: 'cpp',
		h: 'c',
		hpp: 'cpp'
	};
	return map[ext] || 'text';
}
