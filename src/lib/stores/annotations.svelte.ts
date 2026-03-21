/** Persistent annotations store using localStorage */

export interface Annotation {
	eventId: string;
	text: string;
	createdAt: string;
}

const STORAGE_KEY = 'agent-replay-annotations';

function loadAnnotations(): Map<string, Map<string, Annotation>> {
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

function saveAnnotations(map: Map<string, Map<string, Annotation>>) {
	if (typeof localStorage === 'undefined') return;
	const obj: Record<string, Annotation[]> = {};
	for (const [sessionId, eventMap] of map) {
		obj[sessionId] = [...eventMap.values()];
	}
	localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

let store = $state(loadAnnotations());

export function getAnnotation(sessionId: string, eventId: string): Annotation | undefined {
	return store.get(sessionId)?.get(eventId);
}

export function getSessionAnnotations(sessionId: string): Map<string, Annotation> {
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
	saveAnnotations(store);
}

export function getAnnotationCount(sessionId: string): number {
	return store.get(sessionId)?.size || 0;
}
