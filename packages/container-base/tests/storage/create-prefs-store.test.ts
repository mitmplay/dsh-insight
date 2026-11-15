import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// imports go through the package's ONLY public surface (index.ts) —
// internal reach-ins would defeat the 5.3-T boundary audit's spirit.
import { createPrefsStore, sanitizeWorkspaceProfile, storageKey } from '../../src/index';
import { storageKey as nsKey } from '../../src/index';

interface Prefs { a: number; b: string }

const good = { a: 1, b: 'x' };

function makeStore(opts: Parameters<typeof createPrefsStore<Prefs>>[0]) {
	return createPrefsStore<Prefs>(opts);
}

beforeEach(() => {
	localStorage.clear();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('createPrefsStore (W2, D4)', () => {
	it('SSR guard: no localStorage → defaults on load, no-op on save', () => {
		vi.stubGlobal('localStorage', undefined);
		let written = false;
		const probe = makeStore({
			key: 'k',
			defaults: () => ({ ...good }),
			revive: () => null,
			clamp: (p) => ({ ...p, a: p.a + 100 })
		});
		expect(probe.load()).toEqual(good);
		expect(() => probe.save({ a: 9, b: 'y' })).not.toThrow();
		expect(written).toBe(false);
	});

	it('junk / truncated blob tolerance: parse error, non-object, revive-null → defaults', () => {
		localStorage.setItem('k', '{not json at all');
		localStorage.setItem('k2', '5');
		localStorage.setItem('k3', '{"a":1}');
		const store = makeStore({
			key: 'k',
			defaults: () => ({ ...good }),
			revive: (raw) => (raw !== null && typeof raw === 'object' && 'b' in (raw as object) ? raw as Prefs : null)
		});
		expect(store.load()).toEqual(good);
		const store2 = makeStore({ key: 'k2', defaults: () => ({ ...good }), revive: () => null });
		expect(store2.load()).toEqual(good);
		// revive rejecting (null) on an object blob still falls back
		const store3 = makeStore({ key: 'k3', defaults: () => ({ ...good }), revive: () => null });
		expect(store3.load()).toEqual(good);
	});

	it('missing key → defaults', () => {
		const store = makeStore({ key: 'absent', defaults: () => ({ ...good }), revive: () => null });
		expect(store.load()).toEqual(good);
	});

	it('clamp runs AFTER revive, on every load', () => {
		localStorage.setItem('k', JSON.stringify({ a: 100, b: 'raw' }));
		const order: string[] = [];
		const store = makeStore({
			key: 'k',
			defaults: () => ({ ...good }),
			revive: (raw) => {
				order.push('revive');
				return raw as Prefs;
			},
			clamp: (p) => {
				order.push('clamp');
				return { ...p, a: Math.min(10, p.a) };
			}
		});
		expect(store.load()).toEqual({ a: 10, b: 'raw' });
		expect(order).toEqual(['revive', 'clamp']);
	});

	it('write failure is swallowed (never throws)', () => {
		const failing = {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
			clear: () => undefined,
			key: () => null,
			removeItem: () => undefined,
			length: 0
		};
		vi.stubGlobal('localStorage', failing);
		const store = makeStore({ key: 'k', defaults: () => ({ ...good }), revive: () => null });
		expect(() => store.save({ a: 2, b: 'z' })).not.toThrow();
	});

	it('bare round-trip: save → load returns the same blob shape (no envelope)', () => {
		const store = makeStore({
			key: 'k',
			defaults: () => ({ ...good }),
			revive: (raw) => (raw && typeof raw === 'object' && 'b' in (raw as object) ? raw as Prefs : null),
			clamp: (p) => ({ ...p, a: Math.min(5, p.a) })
		});
		store.save({ a: 3, b: 'bare' });
		expect(localStorage.getItem('k')).toBe('{"a":3,"b":"bare"}');
		expect(store.load()).toEqual({ a: 3, b: 'bare' });
	});

	it('envelope round-trip for new consumers (opt-in, D4); read still accepts bare', () => {
		const store = makeStore({
			key: 'env',
			defaults: () => ({ ...good }),
			revive: (raw) => (raw && typeof raw === 'object' && 'b' in (raw as object) ? raw as Prefs : null),
			envelope: { version: 1 }
		});
		store.save({ a: 7, b: 'wrapped' });
		expect(JSON.parse(localStorage.getItem('env') as string)).toEqual({
			v: 1,
			data: { a: 7, b: 'wrapped' }
		});
		expect(store.load()).toEqual({ a: 7, b: 'wrapped' });
		// a bare legacy blob in an envelope-enabled store still loads
		localStorage.setItem('env', '{"a":4,"b":"legacy"}');
		expect(store.load()).toEqual({ a: 4, b: 'legacy' });
	});

	it('profile-aware keys via the exact key() pass-through', () => {
		const store = makeStore({ key: 'k', defaults: () => ({ ...good }), revive: () => null });
		store.save({ a: 1, b: 'p' }, 'widi');
		expect(localStorage.getItem('k_widi')).toBe('{"a":1,"b":"p"}');
		expect(localStorage.getItem('k')).toBe(null);
		expect(store.key()).toBe('k');
		expect(store.key('widi')).toBe('k_widi');
		expect(store.key(null)).toBe('k');
	});
});

describe('namespace fn key-string stability (W2, D4)', () => {
	it('storageKey preserves exact base strings and the _profile suffix rule', () => {
		expect(storageKey('dsi-panels')).toBe('dsi-panels');
		expect(storageKey('dsi-panels', null)).toBe('dsi-panels');
		expect(storageKey('dsi-panels', 'widi')).toBe('dsi-panels_widi');
		expect(nsKey('dsi-sidebar', 'wid_i-2')).toBe('dsi-sidebar_wid_i-2');
	});

	it('sanitizeWorkspaceProfile keeps [A-Za-z0-9_-], caps at 40, null on empty', () => {
		expect(sanitizeWorkspaceProfile('widi')).toBe('widi');
		expect(sanitizeWorkspaceProfile('a b?c')).toBe('abc');
		expect(sanitizeWorkspaceProfile('?!')).toBe(null);
		expect(sanitizeWorkspaceProfile('x'.repeat(50))).toBe('x'.repeat(40));
	});
});
