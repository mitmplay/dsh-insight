/**
 * TerminalPanel HMR lease tests (Surviving Shell ADR amendment
 * 2026-11-04): a vite hot swap disposes WITHOUT a pagehide, so the
 * plain-unmount close would kill the session on every hot swap. The
 * lease arms on TWO paths — the module dispose hook (this file
 * invalidated) and the vite:beforeUpdate broadcast (ANY graph update;
 * an ancestor self-accepting boundary like the desk stops propagation
 * but the broadcast still reaches the panel) — and disarms on
 * vite:afterUpdate, so the lease window is exactly the swap's teardown
 * and a later deliberate close still fires. Hot-ABSENT teardown
 * (production shape) closes as fact 11 demands. Same mock harness as
 * terminal-panel-coverage.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeHot {
	dispose(cb: () => void): void;
	on(event: string, cb: (payload?: unknown) => void): void;
}

const hotState = vi.hoisted(() => ({
	hot: null as null | ((get: () => FakeHot | undefined) => FakeHot | undefined),
	fake: null as FakeHot | null
}));

vi.mock('$lib/components/terminal/terminal-hmr.js', () => ({
	panelHot: () => {
		const make = (): FakeHot => ({
			dispose: () => {},
			on: (_event: string, _cb: (payload?: unknown) => void) => {}
		});
		return hotState.fake ?? (hotState.hot ? hotState.hot(make) : undefined);
	}
}));

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

class FakeResizeObserver {
	constructor(cb: () => void) {
		void cb;
	}
	observe() {}
	disconnect() {}
}

interface FakeES {
	url: string;
	close(): void;
	addEventListener(kind: string, fn: (e: MessageEvent) => void): void;
}

class FakeEventSource implements FakeES {
	url: string;
	constructor(url: string) {
		this.url = url;
	}
	close() {}
	addEventListener() {}
}

type FetchRoute = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let fetchRoute: FetchRoute = () => undefined;

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

function closeCalls(): Array<Record<string, unknown>> {
	return vi
		.mocked(fetch)
		.mock.calls.filter((c) => String(c[0]).includes('/send'))
		.map((c) => JSON.parse(String((c[1] as RequestInit | undefined)?.body ?? '{}')) as Record<string, unknown>);
}

async function mountPanel(): Promise<{ cleanup: () => void }> {
	const { default: Host } = await import('./TerminalPanelHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, { target, props: {} });
	flushSync();
	await tick();
	flushSync();
	return {
		cleanup: () => {
			unmount(app);
			target.remove();
		}
	};
}

function openRoute(): FetchRoute {
	return (url, init) => {
		if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
		if (url === '/api/terminal' && init) return Promise.resolve(jsonResponse({ sessionId: 's1', token: 't1', totalBytes: 0 }));
		if (url.includes('/send')) return Promise.resolve(jsonResponse({ ok: true }));
		return Promise.resolve(jsonResponse({}));
	};
}

beforeEach(() => {
	hotState.fake = null;
	hotState.hot = null;
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver);
	vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => fetchRoute(String(url), init)));
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('TerminalPanel — HMR lease (Surviving Shell ADR 2026-11-04)', () => {
	it('hot ABSENT (production shape) — unmount sends the close POST (fact 11 untouched)', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();
		h.cleanup();
		await tick();
		const closes = closeCalls().filter((b) => b.action === 'close');
		expect(closes.length).toBe(1);
		expect(closes[0]).toMatchObject({ token: 't1', action: 'close' });
	});

	it('broadcast arm — vite:beforeUpdate opens the lease window; teardown sends NO close', async () => {
		const handlers = new Map<string, (payload?: unknown) => void>();
		hotState.fake = {
			dispose: () => {},
			on: (event: string, cb: (payload?: unknown) => void) => {
				handlers.set(event, cb);
			}
		};
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();
		expect(handlers.has('vite:beforeUpdate')).toBe(true);
		expect(handlers.has('vite:afterUpdate')).toBe(true);
		// ANY graph update broadcasts beforeUpdate — teardown inside the window
		handlers.get('vite:beforeUpdate')!();
		h.cleanup();
		await tick();
		expect(closeCalls().filter((b) => b.action === 'close')).toEqual([]);
	});

	it('broadcast disarm — vite:afterUpdate closes the window; a LATER deliberate close still fires', async () => {
		const handlers = new Map<string, (payload?: unknown) => void>();
		hotState.fake = {
			dispose: () => {},
			on: (event: string, cb: (payload?: unknown) => void) => {
				handlers.set(event, cb);
			}
		};
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();
		handlers.get('vite:beforeUpdate')!();
		handlers.get('vite:afterUpdate')!(); // the swap completed; window shut
		h.cleanup(); // operator's deliberate panel × AFTER the swap
		await tick();
		const closes = closeCalls().filter((b) => b.action === 'close');
		expect(closes.length).toBe(1);
		expect(closes[0]).toMatchObject({ token: 't1', action: 'close' });
	});
});
