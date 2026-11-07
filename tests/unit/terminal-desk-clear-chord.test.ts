/**
 * TerminalDesk CLEAR-TAB tests (spec 2026-11-07 Terminal Prune Verb; ADR
 * amendments 2026-11-07 D2-extension + D6, reworked onto the ADR-0052
 * chord): the Alt+T, c VERB reaches the desk as applyAction('clear-tab')
 * — the same action channel as new-tab/split-down. The desk destroys
 * EVERY session the selected tab renders through the prune verb
 * (DELETE /api/terminal/[id]/delete), removes the tab without
 * re-killing, and the last tab's removal is the panel close
 * (onShellExit). A stale token heals exactly once: reattach, retry the
 * SAME verb. Same mock harness as terminal-desk.test.ts.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		open() {}
		loadAddon() {}
		write() {}
		onData() {}
		focus() {}
		dispose() {}
	}
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	}
}));

class FakeEventSource {
	listeners = new Map<string, Array<(e: MessageEvent) => void>>();
	constructor(public url: string) {}
	close() {}
	addEventListener(kind: string, fn: (e: MessageEvent) => void) {
		const arr = this.listeners.get(kind) ?? [];
		arr.push(fn);
		this.listeners.set(kind, arr);
	}
}

class FakeResizeObserver {
	constructor(cb: () => void) {
		void cb;
	}
	observe() {}
	disconnect() {}
}

type FetchRoute = (url: string, init?: RequestInit) => Promise<Response> | undefined;
type DeskRef = { applyAction: (a: 'new-tab' | 'split-down' | 'clear-tab') => void };
let fetchRoute: FetchRoute = () => undefined;
const deleteCalls: Array<{ id: string; token: string }> = [];
let reattachCalls = 0;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

let deskRef: DeskRef | null = null;

async function mountDesk(onShellExit: () => void = () => undefined): Promise<{ target: HTMLElement; cleanup: () => void }> {
	const { default: Host } = await import('./TerminalDeskHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, {
		target,
		props: {
			register: (d: unknown) => {
				deskRef = d as DeskRef;
			},
			onShellExit
		}
	});
	flushSync();
	await tick();
	flushSync();
	return { target, cleanup: () => { unmount(app); target.remove(); } };
}

function chordRoute(staleTokens: Set<string>): FetchRoute {
	let n = 0;
	return (url, init) => {
		if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
		if (url === '/api/terminal' && init) {
			return Promise.resolve(jsonResponse({ sessionId: 'desk-' + ++n, token: 'tok-' + n, totalBytes: 0 }));
		}
		if (url.includes('/reattach')) {
			reattachCalls++;
			return Promise.resolve(jsonResponse({ token: 'tok-fresh', fromByte: 0 }));
		}
		if (url.includes('/delete') && init) {
			const m = url.match(new RegExp('terminal/([^/]+)/delete'));
			const id = m ? m[1] : '?';
			const token = (JSON.parse(String(init.body ?? '{}')) as { token?: string }).token ?? '';
			deleteCalls.push({ id, token });
			const stale = staleTokens.has(token);
			return Promise.resolve(jsonResponse(stale ? { error: 'FOREIGN_SESSION' } : { quiescent: true, pruned: true }, stale ? 403 : 200));
		}
		if (url.includes('/send')) return Promise.resolve(jsonResponse({ ok: true }));
		return Promise.resolve(jsonResponse({}));
	};
}

beforeEach(() => {
	resetStreamHubForTests();
	deleteCalls.length = 0;
	reattachCalls = 0;
	deskRef = null;
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver);
	vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => fetchRoute(String(url), init)));
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('TerminalDesk - the clear-tab verb (Alt+T, c desk half, D6)', () => {
	it('clear-tab destroys the rendered session and removes the tab', async () => {
		fetchRoute = chordRoute(new Set());
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('clear-tab');
		await tick(30);
		flushSync();
		expect(deleteCalls.length).toBe(1);
		expect(deleteCalls[0].id).toBe('desk-1');
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')).toBeNull();
		h.cleanup();
	});

	it('a stale token heals exactly once - reattach then retry the SAME verb', async () => {
		fetchRoute = chordRoute(new Set(['tok-1']));
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('clear-tab');
		await tick(30);
		flushSync();
		expect(deleteCalls.map((c) => c.token)).toEqual(['tok-1', 'tok-fresh']);
		expect(reattachCalls).toBe(1);
		h.cleanup();
	});

	it('clear on the LAST tab removes the desk slot (onShellExit fires)', async () => {
		fetchRoute = chordRoute(new Set());
		let exited = 0;
		const h = await mountDesk(() => {
			exited++;
		});
		await tick();
		deskRef!.applyAction('clear-tab');
		await tick(30);
		flushSync();
		expect(exited).toBe(1);
		h.cleanup();
	});
});