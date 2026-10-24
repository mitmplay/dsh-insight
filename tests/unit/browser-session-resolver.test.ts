import { describe, expect, it } from 'vitest';

import { browserSlotStore, persistId, readPersistedId, removeBrowserSlot, resolveBrowserSession } from '$lib/services/panels/browser-session-resolver.js';

/** Task 2.1-T (The Sticky Glass, ADR-0030 D1/D4): the resolver re-binds a
 *  live persisted id WITHOUT a POST open; a dead id falls through to a fresh
 *  open; the resolved id is written back exactly once per resolution. */
function fakeStorage(): { store: Map<string, string>; getItem: Storage['getItem']; setItem: Storage['setItem']; removeItem: Storage['removeItem'] } {
	const store = new Map<string, string>();
	return {
		store,
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	};
}

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('resolveBrowserSession', () => {
	it('live persisted id re-binds WITHOUT POSTing open', async () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.sessionId', 'live-id');
		const calls: { url: string; method: string }[] = [];
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), method: init?.method ?? 'GET' });
			return jsonRes({ sessions: [{ id: 'live-id' }] });
		}) as typeof fetch;
		const r = await resolveBrowserSession('', { fetchImpl, storage: st });
		expect(r).toEqual({ id: 'live-id', reBound: true });
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('GET');
	});

	it('dead persisted id falls through to a fresh open and the stale entry is replaced', async () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.sessionId', 'dead-id');
		const calls: { url: string; method: string }[] = [];
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), method: init?.method ?? 'GET' });
			if ((init?.method ?? 'GET') === 'POST') return jsonRes({ id: 'fresh-id' });
			return jsonRes({ sessions: [{ id: 'other-id' }] });
		}) as typeof fetch;
		const r = await resolveBrowserSession('', { fetchImpl, storage: st });
		expect(r).toEqual({ id: 'fresh-id', reBound: false });
		expect(st.store.get('dsi.browser.sessionId')).toBe('fresh-id');
		expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
	});

	it('no persisted id opens directly; the new id is persisted exactly once', async () => {
		const st = fakeStorage();
		let postCount = 0;
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			if ((init?.method ?? 'GET') === 'POST') {
				postCount += 1;
				return jsonRes({ id: 'new-id' });
			}
			return jsonRes({ sessions: [] });
		}) as typeof fetch;
		const r = await resolveBrowserSession('', { fetchImpl, storage: st });
		expect(r).toEqual({ id: 'new-id', reBound: false });
		expect(postCount).toBe(1);
		expect(st.store.get('dsi.browser.sessionId')).toBe('new-id');
	});

	it('open failure surfaces the status (never a silent wrong session)', async () => {
		const st = fakeStorage();
		const fetchImpl = (async () => jsonRes({ error: 'OPEN_FAILED' }, 500)) as typeof fetch;
		await expect(resolveBrowserSession('', { fetchImpl, storage: st })).rejects.toThrow('open failed: 500');
		expect(st.store.get('dsi.browser.sessionId')).toBeUndefined();
	});
});

describe('persistId / readPersistedId', () => {
	it('round-trips and tolerates a missing storage (SSR/privacy)', () => {
		const st = fakeStorage();
		persistId('abc', st);
		expect(readPersistedId(st)).toBe('abc');
		expect(readPersistedId(null)).toBeNull();
	});
});

// The Glass Close Ladder (2026-10-24) task 1.1: one writer that drops a
// dead glass's slot entry LIVE — the roster ghost and spine nest derive
// from the mirror, so the drop takes the rows with it in the same stroke.
describe('removeBrowserSlot', () => {
	function seedSlots(st: ReturnType<typeof fakeStorage>, slots: unknown): void {
		st.setItem('dsi.browser.panelIndex', JSON.stringify(slots));
	}

	it('drops the entry whose sessionId matches and keeps its siblings', () => {
		const st = fakeStorage();
		seedSlots(st, [
			{ index: 0, sessionId: 'aaa' },
			{ index: 1, sessionId: 'bbb', openedBy: 'opener', folded: true },
			{ index: 2, sessionId: 'ccc' }
		]);
		const removed = removeBrowserSlot('bbb', st);
		expect(removed).toBe(true);
		const kept = JSON.parse(st.store.get('dsi.browser.panelIndex')!) as Array<{ sessionId?: string }>;
		expect(kept.map((s) => s.sessionId)).toEqual(['aaa', 'ccc']);
	});

	it('persists the empty list by clearing the key when the last glass goes', () => {
		const st = fakeStorage();
		seedSlots(st, [{ index: 0, sessionId: 'only' }]);
		expect(removeBrowserSlot('only', st)).toBe(true);
		expect(st.store.has('dsi.browser.panelIndex')).toBe(false);
	});

	it('an unknown sessionId is a quiet no-op (nothing written)', () => {
		const st = fakeStorage();
		seedSlots(st, [{ index: 0, sessionId: 'aaa' }]);
		const before = st.store.get('dsi.browser.panelIndex');
		expect(removeBrowserSlot('ghost', st)).toBe(false);
		expect(st.store.get('dsi.browser.panelIndex')).toBe(before);
	});

	it('no slot list at all — quiet no-op, never a throw', () => {
		const st = fakeStorage();
		expect(removeBrowserSlot('anything', st)).toBe(false);
	});

	it('updates the reactive mirror so derived rows drop in the same stroke', () => {
		const st = fakeStorage();
		seedSlots(st, [{ index: 0, sessionId: 'aaa' }, { index: 1, sessionId: 'bbb' }]);
		const seen: Array<{ sessionId?: string }>[] = [];
		const un = browserSlotStore.subscribe((v) => void seen.push([...v]));
		try {
			removeBrowserSlot('aaa', st);
		} finally {
			un();
		}
		// initial sync emission + the post-drop emission
		expect(seen.at(-1)?.map((s) => s.sessionId)).toEqual(['bbb']);
	});
});
