import { mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

/**
 * ADR-0036 Amendment 3 follow-up (the shared-profile bug): a chip-spawned
 * glass must OPEN FRESH (POST /api/browser) — never re-bind to the global
 * persisted id, which belongs to ANOTHER glass (both glasses showed the
 * same session id on the status strip).
 */
const calls: Array<{ method: string; url: string }> = [];
let openCount = 0;

beforeAll(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
			const url = String(_url);
			const method = init?.method ?? 'GET';
			calls.push({ method, url });
			if (url.endsWith('/api/browser') && method === 'POST') {
				openCount += 1;
				return Promise.resolve(new Response(JSON.stringify({ id: 'fresh-session-' + openCount }), { status: 200 }));
			}
			return Promise.reject(new Error('unexpected fetch: ' + method + ' ' + url));
		})
	);
});

afterEach(() => {
	document.body.innerHTML = '';
});

function mountPanel(props: Record<string, unknown> = {}): ReturnType<typeof mount> {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return mount(BrowserPanel, {
		target,
		props: Object.assign({ onclose: () => undefined }, props) as never
	});
}

describe('per-glass fresh open (Amendment 3)', () => {
	it('a glass with no seeded session OPENS FRESH and reports the new id', async () => {
		const reported: string[] = [];
		const instance = mountPanel({ onsession: (id: string) => reported.push(id) });
		await vi.waitFor(() => expect(reported).toHaveLength(1));
		expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/browser'))).toBe(true);
		// the bug's signature was a re-bind GET/verify against the global id —
		// a fresh spawn must not consult it
		expect(calls.some((c) => c.url.includes('/api/browser?') || c.url === '' + '/api/browser' && c.method === 'GET')).toBe(false);
		expect(reported[0]).toBe('fresh-session-1');
		unmount(instance);
	});

	it('a second glass opens a SECOND distinct session, not the first one', async () => {
		const reported: string[] = [];
		const i1 = mountPanel({ onsession: (id: string) => reported.push(id) });
		await vi.waitFor(() => expect(reported.length).toBeGreaterThanOrEqual(1));
		const i2 = mountPanel({ onsession: (id: string) => reported.push(id) });
		await vi.waitFor(() => expect(reported.length).toBe(2));
		expect(reported[0]).not.toBe(reported[1]);
		unmount(i1);
		unmount(i2);
	});

	it('a seeded session (slot restore) binds WITHOUT a fresh POST', async () => {
		calls.length = 0;
		const instance = mountPanel({ browserSessionId: 'restored-1' });
		// the prop-seeded path adopts the session (no open, no re-bind — its
		// stream attach uses EventSource, not fetch). The ADR-0040 D5 tab strip
		// polls GET /tabs on the adopted session too — furniture reads are fine;
		// what this test forbids is any session-lifecycle call (open POST).
		await new Promise((r) => setTimeout(r, 50));
		expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/browser'))).toBe(false);
		expect(calls.some((c) => !c.url.endsWith('/tabs'))).toBe(false); // only /tabs reads ride along
		unmount(instance);
	});
});