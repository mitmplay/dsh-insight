/**
 * AddWorkspaceButton — branch floor: the payoff's failure arms the main
 * suite (tests/unit/components/common/layout/
 * add-workspace-button.test.ts) never reaches, plus the honest-fallback
 * `??` arms on the wire shapes the host may legitimately answer. Source
 * branches cited by src/lib/components/common/layout/AddWorkspaceButton.svelte:
 *   L246-253 oncreated THROWS after a successful adopt+create — the outcome
 *            must not be swallowed: the panel REOPENS on the 'done' step
 *            with the error visible (L251-252; both arms of the
 *            `instanceof Error` ternary), dismissible, no picker rows.
 *   L254-255 the payoff's OUTER catch — adopt or create rejects (network):
 *            the error lane shows it, the picker stays, busy releases
 *            (both ternary arms).
 *   L147/L181/L213/L234 `error?.message ?? '<verb> failed (<status>)'` — a
 *            host failure with no message gets the honest status fallback.
 *   L245 `createBody.agentPreset ?? null` — a create receipt without the
 *            field lands oncreated with null (host default).
 *   L143 the refusal code matches but the capability detail does not →
 *            the error lane, NOT the native switch.
 *   L184 `body.path === undefined` (field absent) — a quiet cancel too.
 * Same harness as the sibling: happy-dom + route-aware fetch stub, the
 * settle() microtask ladder (no timers).
 */

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AddWorkspaceButton from '$lib/components/common/layout/AddWorkspaceButton.svelte';
import type { DsiDirectoryListing } from '$lib/types';

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LISTING: DsiDirectoryListing = {
	path: '/Users/x/proj',
	home: '/Users/x',
	crumbs: [
		{ name: 'Users', path: '/Users', hidden: false },
		{ name: 'x', path: '/Users/x', hidden: false },
		{ name: 'proj', path: '/Users/x/proj', hidden: false }
	],
	entries: [{ name: 'alpha', path: '/Users/x/proj/alpha', hidden: false }],
	truncated: false
};

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
interface Harness {
	target: HTMLElement;
	created: Array<{ sessionId: string; agentPreset: string | null; path: string }>;
	calls: Array<{ url: string; method: string; body?: unknown }>;
	unmount: () => void;
}

/** Route-aware fetch: the browse level always succeeds; everything else is
 *  the case's own implementation. oncreated records, then optionally throws. */
function render(other: FetchImpl, oncreatedThrows?: unknown): Harness {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const created: Harness['created'] = [];
	const calls: Harness['calls'] = [];
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
		if (url === '/api/dsh/directory') return jsonResponse({ ok: true, listing: LISTING });
		return other(url, init);
	});
	const comp = mount(AddWorkspaceButton, {
		target,
		props: {
			oncreated: (sessionId: string, agentPreset: string | null, path: string) => {
				created.push({ sessionId, agentPreset, path });
				if (oncreatedThrows !== undefined) throw oncreatedThrows;
			}
		}
	});
	flushSync(); // effects (the window listeners) land before any click
	return { target, created, calls, unmount: () => unmount(comp) };
}

async function settle(rounds = 25): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

async function openAndConfirm(h: Harness): Promise<void> {
	(h.target.querySelector('[data-testid="add-workspace-button"]') as HTMLElement).click();
	await settle();
	(h.target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLElement).click();
	await settle();
}

const panel = (h: Harness) => h.target.querySelector('[data-testid="add-workspace-panel"]');
const error = (h: Harness) => h.target.querySelector('[data-testid="add-workspace-error"]')?.textContent ?? '';
const byText = (h: Harness, text: string) =>
	[...h.target.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement | undefined;

const okAdopt: FetchImpl = async (url) =>
	url === '/api/dsh/workspaces' ? jsonResponse({ ok: true }) : jsonResponse({ ok: true, sessionId: 's-1', agentPreset: 'main' });

describe('AddWorkspaceButton floor — oncreated throws (L246-253)', () => {
	let h: Harness;
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	it('an Error from oncreated reopens the panel on the done step with the message — outcome never swallowed', async () => {
		h = render(okAdopt, new Error('navigation failed'));
		await openAndConfirm(h);
		expect(h.created).toEqual([{ sessionId: 's-1', agentPreset: 'main', path: '/Users/x/proj' }]);
		expect(panel(h)).not.toBeNull(); // reopened — the error must be visible
		expect(error(h)).toContain('navigation failed');
		expect(h.target.querySelector('[data-testid="add-workspace-error"]')?.getAttribute('role')).toBe('alert');
		// the done step renders NO picker rows and no confirm target
		expect(h.target.querySelector('[data-testid="add-workspace-listing"]')).toBeNull();
		expect(h.target.querySelector('[data-testid="add-workspace-target"]')).toBeNull();
		expect((h.target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLButtonElement).disabled).toBe(true);
		// busy released → Cancel is live and dismisses
		const cancel = byText(h, 'Cancel') as HTMLButtonElement;
		expect(cancel.disabled).toBe(false);
		cancel.click();
		flushSync();
		expect(panel(h)).toBeNull();
	});

	it('a NON-Error throw (a string) lands through String(err) (L252 right arm)', async () => {
		h = render(okAdopt, 'nav blew up');
		await openAndConfirm(h);
		expect(panel(h)).not.toBeNull();
		expect(error(h)).toBe('nav blew up');
	});
});

describe('AddWorkspaceButton floor — the payoff outer catch (L254-255)', () => {
	let h: Harness;
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	it('adopt REJECTS: the error lane shows it, the picker stays, create never runs, busy releases', async () => {
		h = render(async (url) => {
			if (url === '/api/dsh/workspaces') throw new Error('ECONNREFUSED adopt');
			return jsonResponse({ ok: true, sessionId: 'never' });
		});
		await openAndConfirm(h);
		expect(error(h)).toBe('ECONNREFUSED adopt');
		expect(panel(h)).not.toBeNull();
		expect(h.target.querySelector('[data-testid="add-workspace-target"]')?.textContent).toBe('/Users/x/proj');
		expect(h.calls.find((c) => c.url === '/api/dsh/sessions')).toBeUndefined();
		expect(h.created).toEqual([]);
		expect((byText(h, 'Cancel') as HTMLButtonElement).disabled).toBe(false);
		expect((h.target.querySelector('[data-testid="add-workspace-confirm"]') as HTMLButtonElement).disabled).toBe(false);
	});

	it('create rejects with a NON-Error (a string): String(err) shows it; the adoption stood', async () => {
		h = render(async (url) => {
			if (url === '/api/dsh/workspaces') return jsonResponse({ ok: true });
			throw 'socket hang up';
		});
		await openAndConfirm(h);
		expect(error(h)).toBe('socket hang up');
		expect(h.calls.filter((c) => c.url === '/api/dsh/workspaces')).toHaveLength(1);
		expect(h.created).toEqual([]);
		expect(panel(h)).not.toBeNull();
	});
});

describe('AddWorkspaceButton floor — honest fallbacks for message-less host failures', () => {
	let h: Harness;
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	it('adopt fails with no error.message → adopt failed (<status>) (L213 right arm)', async () => {
		h = render(async (url) =>
			url === '/api/dsh/workspaces' ? jsonResponse({ ok: false }, 409) : jsonResponse({ ok: true })
		);
		await openAndConfirm(h);
		expect(error(h)).toBe('adopt failed (409)');
		expect(h.calls.find((c) => c.url === '/api/dsh/sessions')).toBeUndefined();
	});

	it('create fails with no error.message → create failed (<status>); a missing sessionId fails the same way (L234 right arm)', async () => {
		h = render(async (url) => (url === '/api/dsh/workspaces' ? jsonResponse({ ok: true }) : jsonResponse({ ok: false }, 500)));
		await openAndConfirm(h);
		expect(error(h)).toBe('create failed (500)');
		expect(h.created).toEqual([]);
		h.unmount();
		vi.unstubAllGlobals();

		h = render(async (url) =>
			url === '/api/dsh/workspaces' ? jsonResponse({ ok: true }) : jsonResponse({ ok: true })
		);
		await openAndConfirm(h);
		expect(error(h)).toBe('create failed (200)');
		expect(h.created).toEqual([]);
	});

	it('a create receipt WITHOUT agentPreset lands oncreated with null (L245 right arm)', async () => {
		h = render(async (url) =>
			url === '/api/dsh/workspaces' ? jsonResponse({ ok: true }) : jsonResponse({ ok: true, sessionId: 's-bare' })
		);
		await openAndConfirm(h);
		expect(h.created).toEqual([{ sessionId: 's-bare', agentPreset: null, path: '/Users/x/proj' }]);
		expect(panel(h)).toBeNull(); // full success dismisses
	});
});

describe('AddWorkspaceButton floor — listing / native-pick fallback arms', () => {
	let h: Harness;
	afterEach(() => {
		h.unmount();
		vi.unstubAllGlobals();
	});

	/** A render whose directory route is the case's own too. */
	function renderDir(dir: FetchImpl, pick?: FetchImpl): Harness {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const calls: Harness['calls'] = [];
		vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, method: init?.method ?? 'GET' });
			return url === '/api/dsh/directory' ? dir(url) : pick ? pick(url) : jsonResponse({ ok: true });
		});
		const comp = mount(AddWorkspaceButton, { target, props: { oncreated: () => {} } });
		flushSync();
		return { target, created: [], calls, unmount: () => unmount(comp) };
	}
	async function open(hh: Harness): Promise<void> {
		(hh.target.querySelector('[data-testid="add-workspace-button"]') as HTMLElement).click();
		await settle();
	}

	it('listing fails with no error.message → listing failed (<status>) (L147 right arm)', async () => {
		h = renderDir(async () => jsonResponse({ ok: false }, 503));
		await open(h);
		expect(error(h)).toBe('listing failed (503)');
	});

	it('listing THROWS a non-Error → String(err) shows it (L153 right arm)', async () => {
		h = renderDir(async () => {
			throw 'boom';
		});
		await open(h);
		expect(error(h)).toBe('boom');
	});

	it('the refusal code matches but the capability detail does not → the error lane, NOT the native switch (L143 right arm)', async () => {
		h = renderDir(async () =>
			jsonResponse({ ok: false, error: { code: 'directory-picker/unavailable', message: 'picker off' }, details: { capability: 'other' } }, 501)
		);
		await open(h);
		expect(error(h)).toBe('picker off');
		expect(h.target.querySelector('[data-testid="add-workspace-native"]')).toBeNull();
		expect(h.calls.find((c) => c.url === '/api/dsh/pick-directory')).toBeUndefined();
	});

	it('pick fails with no error.message → pick failed (<status>); a non-Error throw → String(err) (L181 / L191 right arms)', async () => {
		const native = async () =>
			jsonResponse({ ok: false, error: { code: 'directory-picker/unavailable', message: 'native only', details: { capability: 'native' } } }, 501);
		h = renderDir(native, async () => jsonResponse({ ok: false }, 502));
		await open(h);
		expect(error(h)).toBe('pick failed (502)');
		expect(h.target.querySelector('[data-testid="add-workspace-native-retry"]')).not.toBeNull();
		h.unmount();
		vi.unstubAllGlobals();

		h = renderDir(native, async () => {
			throw 'dialog gone';
		});
		await open(h);
		expect(error(h)).toBe('dialog gone');
	});

	it('a pick receipt with NO path field is a quiet cancel too — the panel closes (L184 right arm)', async () => {
		h = renderDir(
			async () => jsonResponse({ ok: false, error: { code: 'directory-picker/unavailable', message: 'native only', details: { capability: 'native' } } }, 501),
			async () => jsonResponse({ ok: true })
		);
		await open(h);
		expect(panel(h)).toBeNull();
		expect(error(h)).toBe('');
	});
});
