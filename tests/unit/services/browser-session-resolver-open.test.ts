import { afterEach, describe, expect, it } from 'vitest';

import {
	persistPanelIndex,
	readPersistedId,
	readPersistedIndex,
	resolveBrowserSession
} from '$lib/services/panels/browser-session-resolver.js';

/** Same fake-storage pattern as tests/unit/browser-session-resolver.test.ts. */
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

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('resolveBrowserSession — open path with no usable storage (SSR/privacy)', () => {
	const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

	afterEach(() => {
		if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
		else delete (globalThis as { localStorage?: unknown }).localStorage;
	});

	it('localStorage undefined → defaultStorage() returns null and the open still succeeds (line 16 else-branch)', async () => {
		Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
		const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) =>
			jsonRes({ id: 'fresh-no-ls' })) as typeof fetch;
		const r = await resolveBrowserSession('', { fetchImpl });
		expect(r).toEqual({ id: 'fresh-no-ls', reBound: false });
	});

	it('localStorage accessor throwing → defaultStorage() falls into the catch (line 18) and the open still succeeds', async () => {
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('SecurityError: localStorage blocked');
			}
		});
		const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) =>
			jsonRes({ id: 'fresh-thrown-ls' })) as typeof fetch;
		const r = await resolveBrowserSession('', { fetchImpl });
		expect(r).toEqual({ id: 'fresh-thrown-ls', reBound: false });
	});

	it('readPersistedId with a throwing getItem swallows the error (line 26)', () => {
		expect(
			readPersistedId({
				getItem() {
					throw new Error('boom');
				}
			})
		).toBeNull();
	});
});

describe('readPersistedIndex — the never-called slot reader', () => {
	it('missing key → null (raw undefined path, line 49)', () => {
		expect(readPersistedIndex(fakeStorage())).toBeNull();
	});

	it('null storage → null', () => {
		expect(readPersistedIndex(null)).toBeNull();
	});

	it("garbage string ('not-a-number') → null (Number NaN, Number.isInteger false)", () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', 'not-a-number');
		expect(readPersistedIndex(st)).toBeNull();
	});

	it('negative integer → null (n >= 0 false)', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '-1');
		expect(readPersistedIndex(st)).toBeNull();
	});

	it('non-integer float → null (Number.isInteger false)', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '2.5');
		expect(readPersistedIndex(st)).toBeNull();
	});

	it('valid zero slot → 0 (falsy-but-valid index must survive)', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '0');
		expect(readPersistedIndex(st)).toBe(0);
	});

	it('valid positive slot round-trips through persistPanelIndex', () => {
		const st = fakeStorage();
		persistPanelIndex(3, st);
		expect(readPersistedIndex(st)).toBe(3);
	});

	it('persistPanelIndex negative clears the slot (removeItem branch)', () => {
		const st = fakeStorage();
		st.setItem('dsi.browser.panelIndex', '5');
		persistPanelIndex(-2, st);
		expect(st.store.get('dsi.browser.panelIndex')).toBeUndefined();
	});

	it('throwing getItem → null (catch branch)', () => {
		expect(
			readPersistedIndex({
				getItem() {
					throw new Error('boom');
				}
			})
		).toBeNull();
	});
});
