import { describe, expect, it } from 'vitest';

import {
	persistBrowserSlots,
	persistPanelIndex,
	readBrowserSlots,
	readPersistedIndex
} from '$lib/services/panels/browser-session-resolver.js';

function fakeStorage(): {
	store: Map<string, string>;
	getItem: Storage['getItem'];
	setItem: Storage['setItem'];
	removeItem: Storage['removeItem'];
} {
	const store = new Map<string, string>();
	return {
		store,
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	};
}

describe('readPersistedIndex', () => {
	it('round-trips a stored integer index', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '3');
		expect(readPersistedIndex(st)).toBe(3);
	});

	it('returns null with no storage (SSR/privacy)', () => {
		expect(readPersistedIndex(null)).toBeNull();
	});

	it('returns null when nothing is stored', () => {
		expect(readPersistedIndex(fakeStorage())).toBeNull();
	});

	it('coerces numeric strings but rejects non-integer junk', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '7');
		expect(readPersistedIndex(st)).toBe(7);
		st.setItem('dsi.browser.panelIndex', 'not-a-number');
		expect(readPersistedIndex(st)).toBeNull();
	});

	it('rejects negative and fractional values', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '-1');
		expect(readPersistedIndex(st)).toBeNull();
		st.setItem('dsi.browser.panelIndex', '1.5');
		expect(readPersistedIndex(st)).toBeNull();
	});

	it('survives a throwing getItem (quota/security error)', () => {
		const throwing = {
			getItem: () => {
				throw new Error('blocked');
			}
		};
		expect(readPersistedIndex(throwing)).toBeNull();
	});
});

describe('persistPanelIndex', () => {
	it('stores a valid index as a string', () => {
		const st = fakeStorage();
		persistPanelIndex(2, st);
		expect(st.store.get('dsi.browser.panelIndex')).toBe('2');
	});

	it('removes the key for a negative index', () => {
		const st = fakeStorage();
		persistPanelIndex(4, st);
		persistPanelIndex(-1, st);
		expect(st.store.has('dsi.browser.panelIndex')).toBe(false);
	});

	it('removes the key for a non-integer index', () => {
		const st = fakeStorage();
		persistPanelIndex(4, st);
		persistPanelIndex(2.5, st);
		expect(st.store.has('dsi.browser.panelIndex')).toBe(false);
	});

	it('removes the key for NaN', () => {
		const st = fakeStorage();
		persistPanelIndex(NaN, st);
		expect(st.store.has('dsi.browser.panelIndex')).toBe(false);
	});

	it('tolerates a missing storage entirely (SSR/privacy)', () => {
		expect(() => persistPanelIndex(0, null)).not.toThrow();
		expect(() => persistPanelIndex(-3, null)).not.toThrow();
	});

	it('swallows a throwing setItem (quota)', () => {
		const throwing = {
			setItem: () => {
				throw new Error('quota exceeded');
			},
			removeItem: () => {}
		};
		expect(() => persistPanelIndex(1, throwing)).not.toThrow();
	});

	it('swallows a throwing removeItem', () => {
		const throwing = {
			setItem: () => {},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(() => persistPanelIndex(-1, throwing)).not.toThrow();
	});
});

// ── The browser slot LIST (Amendment 3): one entry per glass ──────────
describe('browser slot list', () => {
	it('round-trips a full slot: index, width, openedBy, sessionId', () => {
		const st = fakeStorage();
		persistBrowserSlots([{ index: 2, width: 1200, openedBy: 'sess-a', sessionId: 'bs-1' }], st);
		expect(readBrowserSlots(st)).toEqual([{ index: 2, width: 1200, openedBy: 'sess-a', sessionId: 'bs-1' }]);
	});

	it('round-trips MULTIPLE glasses sorted by floor position', () => {
		const st = fakeStorage();
		persistBrowserSlots(
			[
				{ index: 3, openedBy: 'sess-b', sessionId: 'bs-2' },
				{ index: 0, openedBy: 'sess-a', sessionId: 'bs-1' }
			],
			st
		);
		expect(readBrowserSlots(st)).toEqual([
			{ index: 0, openedBy: 'sess-a', sessionId: 'bs-1' },
			{ index: 3, openedBy: 'sess-b', sessionId: 'bs-2' }
		]);
	});

	it('reads the legacy plain-number slot as a bare index', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '5');
		expect(readBrowserSlots(st)).toEqual([{ index: 5 }]);
	});

	it('reads the legacy single-object slot (width era) into the list', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', JSON.stringify({ index: 1, width: 1000, openedBy: 'sess-a' }));
		expect(readBrowserSlots(st)).toEqual([{ index: 1, width: 1000, openedBy: 'sess-a' }]);
	});

	it('drops junk entries field-wise, keeps the usable ones', () => {
		const st = fakeStorage();
		st.setItem(
			'dsi.browser.panelIndex',
			JSON.stringify([{ index: -1 }, { index: 2, width: 'wide' }, { index: 4, openedBy: '' }, { index: 6, openedBy: 'sess-a' }])
		);
		expect(readBrowserSlots(st)).toEqual([{ index: 2 }, { index: 4 }, { index: 6, openedBy: 'sess-a' }]);
	});

	it('junk JSON is an empty list, never a throw', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '{oops');
		expect(readBrowserSlots(st)).toEqual([]);
	});

	it('an empty list clears the key; null storage stays safe', () => {
		const st = fakeStorage();
		persistBrowserSlots([{ index: 1 }], st);
		persistBrowserSlots([], st);
		expect(st.store.has('dsi.browser.panelIndex')).toBe(false);
		expect(readBrowserSlots(st)).toEqual([]);
		expect(readBrowserSlots(null)).toEqual([]);
		expect(() => persistBrowserSlots([{ index: 0, width: 700 }], null)).not.toThrow();
	});
});
