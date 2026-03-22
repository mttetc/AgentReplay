/** Persistent annotations store — uses SQLite via API with localStorage fallback/migration */

export interface Annotation {
	eventId: string;
	text: string;
	createdAt: string;
}

const STORAGE_KEY = 'agent-replay-annotations';
const MIGRATED_KEY = 'agent-replay-annotations-migrated';

function loadFromLocalStorage(): Map<string, Map<string, Annotation>> {
	if (typeof localStorage === 'undefined') return new Map();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return new Map();
		const parsed = JSON.parse(raw) as Record<string, Annotation[]>;
		const map = new Map<string, Map<string, Annotation>>();
		for (const [sessionId, anns] of Object.entries(parsed)) {
			const eventMap = new Map<string, Annotation>();
			for (const ann of anns) {
				eventMap.set(ann.eventId, ann);
			}
			map.set(sessionId, eventMap);
		}
		return map;
	} catch {
		return new Map();
	}
}

// Migrate localStorage data to SQLite (one-time)
async function migrateToSqlite() {
	if (typeof localStorage === 'undefined') return;
	if (localStorage.getItem(MIGRATED_KEY)) return;

	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) {
		localStorage.setItem(MIGRATED_KEY, 'true');
		return;
	}

	try {
		const parsed = JSON.parse(raw) as Record<string, Annotation[]>;
		const response = await fetch('/api/annotations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ migrate: true, data: parsed })
		});
		if (response.ok) {
			localStorage.setItem(MIGRATED_KEY, 'true');
		}
	} catch {
		// Will retry next time
	}
}

let store = $state(loadFromLocalStorage());
let initialized = false;

// Auto-migrate on first load
if (typeof window !== 'undefined') {
	migrateToSqlite();
}

/** Load annotations from API for a specific session */
async function loadFromApi(sessionId: string): Promise<void> {
	try {
		const response = await fetch(`/api/annotations?sessionId=${encodeURIComponent(sessionId)}`);
		if (!response.ok) return;
		const annotations = await response.json() as Array<{ sessionId: string; eventId: string; text: string; createdAt: string }>;

		const eventMap = new Map<string, Annotation>();
		for (const ann of annotations) {
			eventMap.set(ann.eventId, { eventId: ann.eventId, text: ann.text, createdAt: ann.createdAt });
		}
		store.set(sessionId, eventMap);
		store = new Map(store); // Trigger reactivity
	} catch {
		// Fall back to localStorage data
	}
}

export function getAnnotation(sessionId: string, eventId: string): Annotation | undefined {
	return store.get(sessionId)?.get(eventId);
}

export function getSessionAnnotations(sessionId: string): Map<string, Annotation> {
	// Trigger API load on first access
	if (typeof window !== 'undefined' && !store.has(sessionId)) {
		loadFromApi(sessionId);
	}
	return store.get(sessionId) || new Map();
}

export function setAnnotation(sessionId: string, eventId: string, text: string) {
	if (!store.has(sessionId)) {
		store.set(sessionId, new Map());
	}
	const sessionMap = store.get(sessionId)!;
	if (text.trim() === '') {
		sessionMap.delete(eventId);
	} else {
		sessionMap.set(eventId, { eventId, text, createdAt: new Date().toISOString() });
	}
	// Trigger reactivity
	store = new Map(store);

	// Persist to SQLite via API (non-blocking)
	if (typeof window !== 'undefined') {
		fetch('/api/annotations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId, eventId, text })
		}).catch(() => {
			// Fallback: save to localStorage
			saveToLocalStorage();
		});
	}
}

function saveToLocalStorage() {
	if (typeof localStorage === 'undefined') return;
	const obj: Record<string, Annotation[]> = {};
	for (const [sessionId, eventMap] of store) {
		obj[sessionId] = [...eventMap.values()];
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}
