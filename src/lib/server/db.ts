import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DB_DIR = join(homedir(), '.agent-replay');
const DB_PATH = join(DB_DIR, 'data.db');

let db: Database.Database | null = null;

/** Get or create the SQLite database */
export function getDb(): Database.Database {
	if (db) return db;

	// Ensure directory exists
	mkdirSync(DB_DIR, { recursive: true });

	db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');

	// Create schema
	db.exec(`
		CREATE TABLE IF NOT EXISTS annotations (
			session_id TEXT NOT NULL,
			event_id TEXT NOT NULL,
			text TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (session_id, event_id)
		);

		CREATE TABLE IF NOT EXISTS bookmarks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			event_id TEXT,
			label TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);

		CREATE TABLE IF NOT EXISTS tags (
			session_id TEXT NOT NULL,
			tag TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (session_id, tag)
		);

		CREATE TABLE IF NOT EXISTS analysis_cache (
			cache_key TEXT PRIMARY KEY,
			data TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			expires_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_annotations_session ON annotations(session_id);
		CREATE INDEX IF NOT EXISTS idx_bookmarks_session ON bookmarks(session_id);
		CREATE INDEX IF NOT EXISTS idx_tags_session ON tags(session_id);
		CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
	`);

	return db;
}

// --- Annotations ---

export interface DbAnnotation {
	sessionId: string;
	eventId: string;
	text: string;
	createdAt: string;
	updatedAt: string;
}

export function getAnnotations(sessionId: string): DbAnnotation[] {
	const db = getDb();
	const rows = db.prepare(
		'SELECT session_id, event_id, text, created_at, updated_at FROM annotations WHERE session_id = ?'
	).all(sessionId) as Array<{ session_id: string; event_id: string; text: string; created_at: string; updated_at: string }>;

	return rows.map(r => ({
		sessionId: r.session_id,
		eventId: r.event_id,
		text: r.text,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	}));
}

export function setAnnotation(sessionId: string, eventId: string, text: string): void {
	const db = getDb();
	if (text.trim() === '') {
		db.prepare('DELETE FROM annotations WHERE session_id = ? AND event_id = ?').run(sessionId, eventId);
	} else {
		db.prepare(`
			INSERT INTO annotations (session_id, event_id, text, updated_at)
			VALUES (?, ?, ?, datetime('now'))
			ON CONFLICT (session_id, event_id)
			DO UPDATE SET text = excluded.text, updated_at = datetime('now')
		`).run(sessionId, eventId, text);
	}
}

// --- Tags ---

export function getTags(sessionId: string): string[] {
	const db = getDb();
	const rows = db.prepare('SELECT tag FROM tags WHERE session_id = ?').all(sessionId) as Array<{ tag: string }>;
	return rows.map(r => r.tag);
}

export function setTag(sessionId: string, tag: string): void {
	const db = getDb();
	db.prepare('INSERT OR IGNORE INTO tags (session_id, tag) VALUES (?, ?)').run(sessionId, tag);
}

export function removeTag(sessionId: string, tag: string): void {
	const db = getDb();
	db.prepare('DELETE FROM tags WHERE session_id = ? AND tag = ?').run(sessionId, tag);
}

export function getAllTags(): Array<{ tag: string; count: number }> {
	const db = getDb();
	return db.prepare('SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC').all() as Array<{ tag: string; count: number }>;
}

// --- Bookmarks ---

export interface DbBookmark {
	id: number;
	sessionId: string;
	eventId: string | null;
	label: string;
	createdAt: string;
}

export function getBookmarks(sessionId: string): DbBookmark[] {
	const db = getDb();
	const rows = db.prepare(
		'SELECT id, session_id, event_id, label, created_at FROM bookmarks WHERE session_id = ? ORDER BY created_at DESC'
	).all(sessionId) as Array<{ id: number; session_id: string; event_id: string | null; label: string; created_at: string }>;

	return rows.map(r => ({
		id: r.id,
		sessionId: r.session_id,
		eventId: r.event_id,
		label: r.label,
		createdAt: r.created_at
	}));
}

export function addBookmark(sessionId: string, eventId: string | null, label: string): number {
	const db = getDb();
	const result = db.prepare(
		'INSERT INTO bookmarks (session_id, event_id, label) VALUES (?, ?, ?)'
	).run(sessionId, eventId, label);
	return result.lastInsertRowid as number;
}

export function removeBookmark(id: number): void {
	const db = getDb();
	db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
}

// --- Analysis Cache ---

export function getCachedAnalysis(cacheKey: string): string | null {
	const db = getDb();
	const row = db.prepare(
		"SELECT data FROM analysis_cache WHERE cache_key = ? AND expires_at > datetime('now')"
	).get(cacheKey) as { data: string } | undefined;
	return row?.data ?? null;
}

export function setCachedAnalysis(cacheKey: string, data: string, ttlMs: number): void {
	const db = getDb();
	const expiresAt = new Date(Date.now() + ttlMs).toISOString();
	db.prepare(`
		INSERT INTO analysis_cache (cache_key, data, expires_at)
		VALUES (?, ?, ?)
		ON CONFLICT (cache_key)
		DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at, created_at = datetime('now')
	`).run(cacheKey, data, expiresAt);
}

export function clearExpiredCache(): void {
	const db = getDb();
	db.prepare("DELETE FROM analysis_cache WHERE expires_at <= datetime('now')").run();
}

// --- Migration from localStorage ---

export function importAnnotationsFromLocalStorage(data: Record<string, Array<{ eventId: string; text: string; createdAt: string }>>): number {
	const db = getDb();
	let count = 0;
	const stmt = db.prepare(`
		INSERT OR IGNORE INTO annotations (session_id, event_id, text, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`);

	const transaction = db.transaction(() => {
		for (const [sessionId, anns] of Object.entries(data)) {
			for (const ann of anns) {
				stmt.run(sessionId, ann.eventId, ann.text, ann.createdAt, ann.createdAt);
				count++;
			}
		}
	});

	transaction();
	return count;
}
