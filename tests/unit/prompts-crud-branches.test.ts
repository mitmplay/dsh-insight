/**
 * prompts/crud.ts branch sweep (Wave B coverage) — the failure arms the
 * happy-path suites (prompts-db.test.ts, prompts-routes.test.ts) never
 * enter: every catch arm (warn + degrade), every null-handle early
 * return, and the odd-leg results (counted:true with a vanished row,
 * UPDATE changes=0, blank-text PATCH). The real sqlite engine stays on
 * the seeded tmp DB for the real-DB arms (Behavioral Commitment 10); the
 * throw arms stub openPromptsDb through the connection seam's exported
 * spy (vitest module mock, per the browser-registry-*.test.ts convention).
 */

import type { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/prompts/connection.js', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('$lib/server/prompts/connection.js')>();
	return { ...actual, openPromptsDb: vi.fn(actual.openPromptsDb) };
});

const { openPromptsDb, __resetPromptsDbCache, PROMPTS_DB_ENV } = await import(
	'$lib/server/prompts/connection.js'
);
const {
	countPromptUse,
	createPrompt,
	deletePrompt,
	findPromptByText,
	listPrompts,
	recordPromptUse,
	renamePromptLabel,
	updatePrompt
} = await import('$lib/server/prompts/crud.js');

const openSpy = vi.mocked(openPromptsDb);

let tmpRoot: string;
let dbFile: string;

beforeEach(() => {
	tmpRoot = mkdtempSync(join(tmpdir(), 'dsi-prompts-crud-'));
	dbFile = join(tmpRoot, 'prompts.sqlite');
	process.env[PROMPTS_DB_ENV] = dbFile;
	openSpy.mockReset();
	openSpy.mockImplementation(realOpen);
	__resetPromptsDbCache();
});

afterEach(() => {
	openSpy.mockReset();
	__resetPromptsDbCache();
	delete process.env[PROMPTS_DB_ENV];
});

/** The genuine opener, captured via the mock's recorded implementation. */
const realOpen = openSpy.getMockImplementation() as (p?: string) => DatabaseSync;

/** A db stub whose every prepare throws (the SQLITE_CORRUPT stand-in). */
function throwingDb(): DatabaseSync {
	return {
		prepare: () => {
			throw new Error('corrupt stub');
		}
	} as unknown as DatabaseSync;
}

describe('findPromptByText — failure arms', () => {
	it('blank text → null before touching the db', () => {
		expect(findPromptByText('   ')).toBeNull();
		expect(openSpy).not.toHaveBeenCalled();
	});

	it('unopenable db (null handle) → null', () => {
		openSpy.mockReturnValue(null);
		expect(findPromptByText('anything')).toBeNull();
	});

	it('prepare throws → warn + null (never throws to the route)', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSpy.mockReturnValue(throwingDb());
		expect(findPromptByText('anything')).toBeNull();
		warnSpy.mockRestore();
	});
});

describe('recordPromptUse — failure arms', () => {
	it('blank text and null handle → null', () => {
		expect(recordPromptUse('  ')).toBeNull();
		openSpy.mockReturnValue(null);
		expect(recordPromptUse('anything')).toBeNull();
	});

	it('insert throws → warn + null', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSpy.mockReturnValue(throwingDb());
		expect(recordPromptUse('anything')).toBeNull();
		warnSpy.mockRestore();
	});
});

describe('recordPromptUse — prune throw containment (real engine, poisoned COUNT)', () => {
	it('a failing prune COUNT warns but the recorded row is still returned', () => {
		const handle = realOpen(dbFile)!;
		const originalPrepare = handle.prepare.bind(handle);
		openSpy.mockImplementation(() => {
			return {
				prepare(sql: string) {
					if (sql.includes('COUNT(*) AS n FROM prompts')) {
						throw new Error('prune probe boom');
					}
					return originalPrepare(sql);
				}
			} as unknown as DatabaseSync;
		});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const rec = recordPromptUse('prune-boom probe');
		expect(rec?.text).toBe('prune-boom probe');
		expect(rec?.use_count).toBe(1);
		expect(warnSpy).toHaveBeenCalledWith('[prompts-db] prune failed:', 'prune probe boom');
		warnSpy.mockRestore();
		handle.close();
	});
});

describe('countPromptUse — every arm', () => {
	it('blank text → null; null handle → null', () => {
		expect(countPromptUse(' ')).toBeNull();
		openSpy.mockReturnValue(null);
		expect(countPromptUse('x')).toBeNull();
	});

	it('update throws → warn + null', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSpy.mockReturnValue(throwingDb());
		expect(countPromptUse('x')).toBeNull();
		warnSpy.mockRestore();
	});

	it('changes=1 but the SELECT misses → null (row vanished mid-flight)', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const stub = {
			prepare(sql: string) {
				if (sql.startsWith('UPDATE')) {
					return { run: () => ({ changes: 1 }) };
				}
				return { get: () => undefined };
			}
		} as unknown as DatabaseSync;
		openSpy.mockReturnValue(stub);
		expect(countPromptUse('ghost row')).toBeNull();
		warnSpy.mockRestore();
	});

	it('changes=0 → counted:false (real engine, unknown text)', () => {
		expect(countPromptUse('no such row ever')).toEqual({ counted: false });
	});
});

describe('renamePromptLabel / deletePrompt — failure arms', () => {
	it('rename: blank label normalizes to NULL (clears), throw → false', () => {
		const created = createPrompt('rename probe', 'Handle');
		if (!('record' in created)) throw new Error('create failed');
		const id = created.record.id;
		expect(renamePromptLabel(id, '   ')).toBe(true); // '   '.trim() → null
		expect(findPromptByText('rename probe')?.label).toBeNull();

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSpy.mockReturnValue(throwingDb());
		expect(renamePromptLabel(id, 'x')).toBe(false);
		expect(deletePrompt(id)).toBe(false);
		warnSpy.mockRestore();
	});

	it('rename + delete on a null handle → false', () => {
		openSpy.mockReturnValue(null);
		expect(renamePromptLabel(1, 'x')).toBe(false);
		expect(deletePrompt(1)).toBe(false);
	});
});

describe('listPrompts — failure arms', () => {
	it('null handle → empty page', () => {
		openSpy.mockReturnValue(null);
		expect(listPrompts({})).toEqual({ rows: [], total: 0 });
	});

	it('q-path prepare throws → warn + empty page', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSpy.mockReturnValue(throwingDb());
		expect(listPrompts({ q: 'boom' })).toEqual({ rows: [], total: 0 });
		warnSpy.mockRestore();
	});

	it('tagless-path prepare throws → warn + empty page', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSpy.mockReturnValue(throwingDb());
		expect(listPrompts({})).toEqual({ rows: [], total: 0 });
		warnSpy.mockRestore();
	});
});

describe('createPrompt — failure arms', () => {
	it('blank text / null handle → { ok:false, existing:null }', () => {
		expect(createPrompt('   ')).toEqual({ ok: false, existing: null });
		openSpy.mockReturnValue(null);
		expect(createPrompt('x')).toEqual({ ok: false, existing: null });
	});

	it('existing-row SELECT throws → warn + { ok:false, existing:null }', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSpy.mockReturnValue(throwingDb());
		expect(createPrompt('x')).toEqual({ ok: false, existing: null });
		warnSpy.mockRestore();
	});

	it('a whitespace-only label normalizes to NULL', () => {
		const made = createPrompt('blank-label probe', '   ');
		if (!('record' in made)) throw new Error('create failed');
		expect(made.record.label).toBeNull();
	});
});

describe('updatePrompt — every branch arm', () => {
	it('null handle → null', () => {
		openSpy.mockReturnValue(null);
		expect(updatePrompt(1, { label: 'x' })).toBeNull();
	});

	it('blank text PATCH → null (rejected before SQL)', () => {
		const created = createPrompt('patch probe');
		if (!('record' in created)) throw new Error('create failed');
		expect(updatePrompt(created.record.id, { text: '   ' })).toBeNull();
	});

	it('whitespace label normalizes to NULL; macro false → 0; tags normalize', () => {
		const created = createPrompt('arms probe', 'Arms', ['git']);
		if (!('record' in created)) throw new Error('create failed');
		const id = created.record.id;
		const updated = updatePrompt(id, {
			label: '   ',
			macro: false,
			tags: 'Git +Rca! git'
		});
		expect(updated?.label).toBeNull();
		expect(updated?.macro).toBe(0);
		expect(updated?.tags).toBe('git');
	});

	it('PATCH hitting no row → null (changes=0 arm)', () => {
		expect(updatePrompt(9999, { label: 'ghost' })).toBeNull();
	});

	it('prepare throws → warn + null', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		openSpy.mockReturnValue(throwingDb());
		expect(updatePrompt(1, { label: 'x' })).toBeNull();
		warnSpy.mockRestore();
	});
});
