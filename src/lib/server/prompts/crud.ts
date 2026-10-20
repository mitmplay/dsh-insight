/**
 * prompts-db crud (2026-10-10) — the Shelf's desk, moved WHOLE from db.ts
 * (ADR-0019 standard, ADR-0022 W4): exact-text find, use recording (first
 * send creates the row), the 5,000-row LRU-of-one-offs prune, rename/
 * delete, and the manager queries (list/sort/page, create, update).
 *
 * Imports the connection seam (open/MAX_ROWS/SELECT_COLS/warn/PromptRecord),
 * the search seam (escLike), and the tag codec. Moved verbatim from db.ts
 * by line range.
 */
import type { DatabaseSync } from 'node:sqlite';
import { joinTagWords, parseTagWords } from './tags.js';
import { MAX_ROWS, openPromptsDb, SELECT_COLS, warn, type PromptRecord } from './connection.js';
import { escLike } from './search.js';

// ── Queries ──


/** Find a prompt by exact (trimmed) text. Null on miss/failure. */
export function findPromptByText(text: string): PromptRecord | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const db = openPromptsDb();
	if (!db) return null;
	try {
		const row = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		return row ?? null;
	} catch (e) {
		warn('findPromptByText failed:', e);
		return null;
	}
}

/**
 * Record a sent prompt (ADR D5/D15): insert on first send, increment
 * use_count + refresh last_used_at afterwards. Enforces the row cap.
 * Returns the updated record, or null on failure (DB unavailable/empty text).
 */
export function recordPromptUse(text: string): PromptRecord | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const db = openPromptsDb();
	if (!db) return null;

	try {
		db.prepare(
			`INSERT INTO prompts (label, text, use_count, last_used_at, created_at)
       VALUES (NULL, ?, 1, datetime('now'), datetime('now'))
       ON CONFLICT(text) DO UPDATE SET
         use_count = use_count + 1,
         last_used_at = datetime('now')`
		).run(trimmed);
		pruneIfNeeded(db);
		const row = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		return row ?? null;
	} catch (e) {
		warn('recordPromptUse failed:', e);
		return null;
	}
}

/**
 * Count-only use recording (The Prompt Tags ADR, 2026-09-14, D7): bump
 * use_count + refresh last_used_at for an EXISTING row; unknown text
 * returns { counted: false } and inserts NOTHING — the wire's only path
 * to a row is an operator save. Null on failure (DB unavailable/empty text).
 */
export function countPromptUse(
	text: string
): { counted: true; record: PromptRecord } | { counted: false } | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const db = openPromptsDb();
	if (!db) return null;
	try {
		const res = db
			.prepare(
				`UPDATE prompts
       SET use_count = use_count + 1, last_used_at = datetime('now')
       WHERE text = ?`
			)
			.run(trimmed);
		if (res.changes === 0) return { counted: false };
		const row = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		return row ? { counted: true, record: row } : null;
	} catch (e) {
		warn('countPromptUse failed:', e);
		return null;
	}
}

/**
 * Cap enforcement (ADR D13): if rows > MAX_ROWS, delete the oldest
 * use_count=1 rows until at cap. Multi-use prompts are never pruned.
 */
function pruneIfNeeded(db: DatabaseSync): void {
	try {
		const overflow =
			(
				db.prepare('SELECT COUNT(*) AS n FROM prompts').get() as { n: number }
			).n - MAX_ROWS;
		if (overflow <= 0) return;
		db.prepare(
			`DELETE FROM prompts
       WHERE id IN (
         SELECT id FROM prompts
         WHERE use_count <= 1
         ORDER BY last_used_at ASC, id ASC
         LIMIT ?
       )`
		).run(overflow);
	} catch (e) {
		warn('prune failed:', e);
	}
}



/**
 * Rename a prompt's label (ADR D3). Label is the one-line handle used for
 * matching and display; passing null clears it. Fails (returns false) if
 * another prompt already claims the label (unique partial index).
 */
export function renamePromptLabel(id: number, label: string | null): boolean {
	const db = openPromptsDb();
	if (!db) return false;
	try {
		const clean = label === null ? null : label.trim().slice(0, 60) || null;
		const res = db.prepare('UPDATE prompts SET label = ? WHERE id = ?').run(clean, id);
		return res.changes > 0;
	} catch (e) {
		warn('renamePromptLabel failed:', e);
		return false;
	}
}

/** Delete a prompt row. Returns true when a row was removed. */
export function deletePrompt(id: number): boolean {
	const db = openPromptsDb();
	if (!db) return false;
	try {
		const res = db.prepare('DELETE FROM prompts WHERE id = ?').run(id);
		return res.changes > 0;
	} catch (e) {
		warn('deletePrompt failed:', e);
		return false;
	}
}

// ── Manager queries (ADR v1.1 E4) ──

/** Sort param → ORDER BY clause (col + direction). */
const SORT_MAP: Record<string, { col: string; asc: string; desc: string }> = {
	uses: { col: 'use_count', asc: 'use_count ASC', desc: 'use_count DESC' },
	last_used: {
		col: 'last_used_at',
		asc: 'last_used_at ASC',
		desc: 'last_used_at DESC'
	},
	created: { col: 'created_at', asc: 'created_at ASC', desc: 'created_at DESC' },
	// Sorts the visible "Label / Text" column by its display handle
	// (label when present, else text).
	display: {
		col: 'COALESCE(label, text)',
		asc: 'COALESCE(label, text) ASC',
		desc: 'COALESCE(label, text) DESC'
	}
};

/**
 * List prompts for the manager (ADR E4). Supports optional contains
 *  filter (substring match on label/text — mid-string words like the
 *  `coverage` of `pnpm test:coverage` now hit), sort, and offset paging.
 *  sort, and offset paging. Returns rows + total count (for cap-footer UX).
 */
export function listPrompts(opts: {
	q?: string;
	/** Active tag filter words (The Prompt Tags ADR, 2026-09-14, D4):
	 *  AND semantics via a padded LIKE per word — `' ' || tags || ' '`
	 *  LIKE '% word %' — so `git` never matches `github` and underscore
	 *  is literal. Words are grammar-validated by the route first, so the
	 *  LIKE payload cannot carry wildcards. */
	tags?: string[];
	limit?: number;
	offset?: number;
	sort?: string;
	dir?: 'asc' | 'desc';
}): { rows: PromptRecord[]; total: number } {
	const db = openPromptsDb();
	if (!db) return { rows: [], total: 0 };

	const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
	const offset = Math.max(opts.offset ?? 0, 0);
	const sortKey = opts.sort && SORT_MAP[opts.sort] ? opts.sort : 'last_used';
	const dir: 'asc' | 'desc' = opts.dir === 'asc' ? 'asc' : 'desc';
	const orderBy = SORT_MAP[sortKey][dir];
	const q = opts.q?.trim();
	const tagWords = opts.tags ?? [];
	// D4 padded LIKE: one condition per word, AND-composed. Padded on both
	// sides so a word matches whole words only; ESCAPE keeps `_` literal.
	const tagConds = tagWords.map(() => "(' ' || tags || ' ') LIKE ? ESCAPE '\\'");
	const tagParams = tagWords.map((t) => `% ${escLike(t)} %`);
	const qCond = "(label LIKE ? ESCAPE '\\' OR text LIKE ? ESCAPE '\\')";

	try {
		if (q) {
			// Contains filter: `%q%` — the 2026-09-19 fix; the old prefix
			// (`q%`) could never match a word mid-text (e.g. `coverage`).
			const like = `%${escLike(q)}%`;
			const where = [qCond, ...tagConds].join(' AND ');
			const rows = db
				.prepare(
					`SELECT ${SELECT_COLS} FROM prompts
           WHERE ${where}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`
				)
				.all(like, like, ...tagParams, limit, offset) as unknown as PromptRecord[];
			const total = (
				db.prepare(`SELECT COUNT(*) AS n FROM prompts WHERE ${where}`).get(like, like, ...tagParams) as {
					n: number;
				}
			).n;
			return { rows, total };
		}
		const where = tagConds.join(' AND ');
		const whereSql = where ? ` WHERE ${where}` : '';
		const rows = db
			.prepare(
				`SELECT ${SELECT_COLS} FROM prompts${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
			)
			.all(...tagParams, limit, offset) as unknown as PromptRecord[];
		const total = (
			db.prepare(`SELECT COUNT(*) AS n FROM prompts${whereSql}`).get(...tagParams) as {
				n: number;
			}
		).n;
		return { rows, total };
	} catch (e) {
		warn('listPrompts failed:', e);
		return { rows: [], total: 0 };
	}
}

/**
 * Create a prompt manually (ADR E4). If text already exists, returns the
 * existing row as a 409-info object instead of inserting. Manual create ≠
 * upsert — never silently bumps use_count.
 */
export function createPrompt(
	text: string,
	label?: string | null,
	tags?: string[],
	opts?: { use_count?: number; macro?: boolean }
): { ok: true; record: PromptRecord } | { ok: false; existing: PromptRecord | null } {
	const trimmed = text.trim();
	if (!trimmed) return { ok: false, existing: null };
	const db = openPromptsDb();
	if (!db) return { ok: false, existing: null };

	try {
		const existing = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		if (existing) return { ok: false, existing };

		const cleanLabel = label ? label.trim().slice(0, 60) || null : null;
		// D1: words are grammar-normalized (lowercase, dedupe, drop invalid)
		// and space-joined — the stored form is always canonical.
		const cleanTags = joinTagWords(tags ?? []);
		// Seed overrides (Add dialog aligned with Edit): use_count floored at
		// 1 like the PATCH path; absent = the insert defaults (1 / 0).
		const seededUses = Math.max(1, Math.floor(opts?.use_count ?? 1));
		const seededMacro = opts?.macro === true ? 1 : 0;
		db.prepare(
			`INSERT INTO prompts (label, text, use_count, macro, last_used_at, created_at, tags)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)`
		).run(cleanLabel, trimmed, seededUses, seededMacro, cleanTags);
		pruneIfNeeded(db);
		const row = db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE text = ?`)
			.get(trimmed) as unknown as PromptRecord | undefined;
		return { ok: true, record: row! };
	} catch (e) {
		warn('createPrompt failed:', e);
		return { ok: false, existing: null };
	}
}

/**
 * Update a prompt's text, label, and/or use_count (ADR E4 PATCH extend).
 * `use_count` is floored at 1 (reset). Returns the updated row or null.
 */
export function updatePrompt(
	id: number,
	fields: { text?: string; label?: string | null; use_count?: number; macro?: boolean; tags?: string }
): PromptRecord | null {
	const db = openPromptsDb();
	if (!db) return null;
	try {
		const sets: string[] = [];
		const args: (string | number | null)[] = [];

		if (fields.text !== undefined) {
			const trimmed = fields.text.trim();
			if (!trimmed) return null;
			sets.push('text = ?');
			args.push(trimmed);
		}
		if (fields.label !== undefined) {
			const clean =
				fields.label === null ? null : fields.label.trim().slice(0, 60) || null;
			sets.push('label = ?');
			args.push(clean);
		}
		if (fields.use_count !== undefined) {
			sets.push('use_count = ?');
			args.push(Math.max(1, Math.floor(fields.use_count)));
		}
		if (fields.macro !== undefined) {
			sets.push('macro = ?');
			args.push(fields.macro ? 1 : 0);
		}
		if (fields.tags !== undefined) {
			// Normalize through the grammar (D3): parse + join, so the stored
			// form is always the canonical space-joined lowercase words.
			sets.push('tags = ?');
			args.push(joinTagWords(parseTagWords(fields.tags)));
		}
		if (sets.length === 0) return null;

		args.push(id);
		const res = db
			.prepare(`UPDATE prompts SET ${sets.join(', ')} WHERE id = ?`)
			.run(...args);
		if (res.changes === 0) return null;
		return db
			.prepare(`SELECT ${SELECT_COLS} FROM prompts WHERE id = ?`)
			.get(id) as unknown as PromptRecord;
	} catch (e) {
		warn('updatePrompt failed:', e);
		return null;
	}
}
