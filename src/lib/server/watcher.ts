import { watch, type FSWatcher } from 'fs';
import { CLAUDE_DIR } from './config';

type WatchCallback = (event: { type: 'session-changed'; file: string }) => void;

let watcher: FSWatcher | null = null;
const listeners = new Set<WatchCallback>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function startWatching() {
	if (watcher) return;
	try {
		watcher = watch(CLAUDE_DIR, { recursive: true }, (_eventType, filename) => {
			if (!filename || !filename.endsWith('.jsonl')) return;

			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				// Invalidate discovery cache so next request fetches fresh data
				invalidateDiscoveryCache();

				for (const cb of listeners) {
					cb({ type: 'session-changed', file: filename });
				}
			}, 500);
		});
	} catch {
		// Directory might not exist yet
	}
}

function stopWatching() {
	if (watcher) {
		watcher.close();
		watcher = null;
	}
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
}

export function onSessionChange(cb: WatchCallback): () => void {
	listeners.add(cb);
	if (listeners.size === 1) startWatching();

	return () => {
		listeners.delete(cb);
		if (listeners.size === 0) stopWatching();
	};
}

// Inline cache invalidation to avoid circular imports
function invalidateDiscoveryCache() {
	// Dynamic import to avoid circular dependency at module load time
	import('./providers/index.js').then((mod) => {
		mod.invalidateDiscoveryCache();
	}).catch(() => {
		// Silently ignore if module isn't available
	});
}
