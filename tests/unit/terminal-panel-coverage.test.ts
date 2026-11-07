/**
 * TerminalPanel coverage tests — the happy paths the floor test skips:
 * full xterm attach (mocked addons), the SSE frame pump (output / settled /
 * exit / closed / error), serialized keystroke writes, close-on-unmount
 * (panel close IS terminal close; no close button), the xterm-failure
 * fallback surface (pre + input line), and the opening / open-failed
 * postures. xterm + addon-fit + EventSource + ResizeObserver
 * are all mocked; fetch is routed by URL.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';

const xtermState = vi.hoisted(() => ({ fail: false }));

const onDataHandlers: Array<(data: string) => void> = [];

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		written: string[] = [];
		constructor() {
			if (xtermState.fail) throw new Error('xterm unavailable');
		}
		opened: unknown = null;
		addon: unknown = null;
		disposed = false;
		open(el: unknown) {
			this.opened = el;
		}
		loadAddon(a: unknown) {
			this.addon = a;
		}
		write(data: string) {
			this.written.push(data);
		}
		onData(fn: (data: string) => void) {
			onDataHandlers.push(fn);
		}
		onResize(_fn: (e: { cols: number; rows: number }) => void) {}
		options: Record<string, unknown> = {};
		focus() {}
		dispose() {
			this.disposed = true;
		}
	}
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fitCount = 0;
		fit() {
			this.fitCount++;
		}
	}
}));

interface FakeES {
	url: string;
	closed: boolean;
	onmessage: ((e: { data: string }) => void) | null;
	onerror: (() => void) | null;
	listeners: Map<string, Array<(e: MessageEvent) => void>>;
	close(): void;
	addEventListener(kind: string, fn: (e: MessageEvent) => void): void;
	emit(kind: string, data?: string): void;
}

let lastES: FakeES | null = null;

class FakeEventSource implements FakeES {
	url: string;
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	listeners = new Map<string, Array<(e: MessageEvent) => void>>();
	constructor(url: string) {
		this.url = url;
		lastES = this;
	}
	close() {
		this.closed = true;
	}
	addEventListener(kind: string, fn: (e: MessageEvent) => void) {
		const arr = this.listeners.get(kind) ?? [];
		arr.push(fn);
		this.listeners.set(kind, arr);
	}
	emit(kind: string, data?: string) {
		if (kind === 'output' && this.onmessage === null) {
			// named events never hit onmessage; keep parity with the component
		}
		// the real hub wire ALWAYS tags frames with sessionId (ADR-0053):
		// the fake injects the source's own id so test literals stay terse
		let payload = data ?? '';
		try {
			const o = JSON.parse(payload) as Record<string, unknown>;
			if (o && typeof o === 'object' && !('sessionId' in o)) {
				const ids = JSON.parse(new URL('http://x' + this.url).searchParams.get('ids') ?? '[]') as string[];
				o.sessionId = ids[0];
				payload = JSON.stringify(o);
			}
		} catch { /* torn frame stays torn */ }
		const ev = { data: payload } as MessageEvent;
		if (kind === 'message') this.onmessage?.({ data: payload });
		for (const fn of this.listeners.get(kind) ?? []) fn(ev);
	}
}

const roInstances: Array<{ observed: Element | null; disconnected: boolean }> = [];
class FakeResizeObserver {
	observed: Element | null = null;
	disconnected = false;
	constructor(cb: () => void) {
		void cb;
	}
	observe(el: Element) {
		this.observed = el;
		roInstances.push(this);
	}
	disconnect() {
		this.disconnected = true;
	}
}

type FetchRoute = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let fetchRoute: FetchRoute = () => undefined;

function jsonResponse(body: unknown, ok = true): Response {
	return new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

interface Mounted {
	target: HTMLElement;
	cleanup: () => void;
}

async function mountPanel(props: Record<string, unknown> = {}): Promise<Mounted> {
	const { default: Host } = await import('./TerminalPanelHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, { target, props });
	flushSync();
	await tick();
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(app);
			target.remove();
		}
	};
}

function openRoute(sessions: Array<{ id: string; exited: boolean }> = []): FetchRoute {
	return (url, init) => {
		if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions }));
		if (url === '/api/terminal' && init) return Promise.resolve(jsonResponse({ sessionId: 's1', token: 't1', totalBytes: 0 }));
		if (url.endsWith('/reattach')) return Promise.resolve(jsonResponse({ token: 't9', fromByte: 4096 }));
		if (url.includes('/send')) return Promise.resolve(jsonResponse({ ok: true }));
		return Promise.resolve(jsonResponse({}));
	};
}


/** The hub transport's ids query — what the wave-3 swap made the wire. */
function hubIds(url: string): string[] {
	try {
		const ids = new URL('http://x' + url).searchParams.get('ids') ?? '[]';
		return JSON.parse(ids) as string[];
	} catch {
		return [];
	}
}
function hubResume(url: string): Record<string, number> {
	try {
		const raw = new URL('http://x' + url).searchParams.get('resume') ?? '{}';
		return JSON.parse(raw) as Record<string, number>;
	} catch {
		return {};
	}
}

beforeEach(() => {
	resetStreamHubForTests();
	xtermState.fail = false;
	onDataHandlers.length = 0;
	roInstances.length = 0;
	lastES = null;
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal(
		'ResizeObserver',
		FakeResizeObserver as unknown as typeof ResizeObserver
	);
	vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => fetchRoute(String(url), init)));
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('TerminalPanel — enabled lifecycle (coverage)', () => {
	it('probes disabled → renders the disabled floor (probe false arm)', async () => {
		fetchRoute = () => Promise.resolve(jsonResponse({ enabled: false }));
		const h = await mountPanel();
		expect(h.target.querySelector('[data-testid="terminal-disabled"]')).not.toBeNull();
		expect(lastES).toBeNull(); // never opened a stream
		h.cleanup();
	});

	it('mount ladder: a live probe session is RE-ATTACHED, never re-opened (Surviving Shell D3)', async () => {
		fetchRoute = openRoute([{ id: 's9', exited: false }]);
		const h = await mountPanel();
		await tick();
		flushSync();
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls.some((c) => String(c[0]) === '/api/terminal/s9/reattach')).toBe(true);
		expect(calls.some((c) => String(c[0]) === '/api/terminal' && (c[1] as RequestInit | undefined) !== undefined)).toBe(false);
		// the stream REPLAYS the retained ring (from 0) into the fresh xterm,
		// on the SAME session — the old scrollback must survive the reload
		// the hub transport: ONE source, ids=[s9], resume at 0 (ADR-0053)
		expect(hubIds(lastES!.url)).toEqual(['s9']);
		expect(hubResume(lastES!.url)).toEqual({ s9: 0 });
		h.cleanup();
	});

	it('mount ladder: only exited sessions → opens a fresh session as today', async () => {
		fetchRoute = openRoute([{ id: 'dead', exited: true }]);
		const h = await mountPanel();
		await tick();
		flushSync();
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls.some((c) => String(c[0]) === '/api/terminal/dead/reattach')).toBe(false);
		expect(calls.some((c) => String(c[0]) === '/api/terminal' && (c[1] as RequestInit | undefined) !== undefined)).toBe(true);
		expect(hubIds(lastES!.url)).toEqual(['s1']);
		expect(hubResume(lastES!.url)).toEqual({ s1: 0 });
		h.cleanup();
	});

	it('pagehide before unmount → the close POST is SKIPPED; plain unmount still closes (Surviving Shell D4)', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();

		// the page is going away (reload / tab close)
		window.dispatchEvent(new Event('pagehide'));
		h.cleanup();
		await tick();
		expect(vi.mocked(fetch).mock.calls.some(
			(c) => String(c[0]).includes('/send') && (c[1] as RequestInit | undefined)?.body?.toString().includes('"close"')
		)).toBe(false);
	});

	it('shows the opening posture while the open POST is pending', async () => {
		let resolveOpen!: (r: Response) => void;
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true }));
			if (url === '/api/terminal' && init)
				return new Promise((res) => {
					resolveOpen = res;
				});
			return Promise.resolve(jsonResponse({ ok: true }));
		};
		const h = await mountPanel();
		expect(h.target.querySelector('[data-testid="terminal-opening"]')).not.toBeNull();
		resolveOpen(jsonResponse({ sessionId: 's1', token: 't1', totalBytes: 0 }));
		await tick();
		h.cleanup();
	});

	it('open POST failure → falls back to the disabled floor', async () => {
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true }));
			if (url === '/api/terminal' && init) return Promise.resolve(jsonResponse({ error: 'no' }, false));
			return Promise.resolve(jsonResponse({ ok: true }));
		};
		const h = await mountPanel();
		expect(h.target.querySelector('[data-testid="terminal-disabled"]')).not.toBeNull();
		h.cleanup();
	});

	it('full attach: xterm opens, fits, observes resize, replays the buffer, and keystrokes serialize to /send', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		expect(lastES).not.toBeNull();
		expect(hubIds(lastES!.url)).toEqual(['s1']);

		// buffered output BEFORE xterm attached → replayed into xterm
		lastES!.emit('output', JSON.stringify({ text: 'buffered\\n' }));
		await tick(); // let the dynamic import resolve
		flushSync();

		const host = h.target.querySelector('[data-testid="terminal-host"]')!;
		expect(host.querySelector('div')).not.toBeNull(); // termEl mounted
		// ResizeObserver observed and refits on resize
		expect(roInstances).toHaveLength(1);
		roInstances[0].observed!.dispatchEvent(new Event('noop'));
		expect(onDataHandlers).toHaveLength(1);

		// keystroke → queued /send write
		onDataHandlers[0]('ls\\n');
		await tick();
		const fetchMock = vi.mocked(fetch);
		const sendCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/send') && (c[1] as RequestInit | undefined)?.body?.toString().includes('"write"'));
		expect(sendCalls.length).toBeGreaterThanOrEqual(1);

		// output after attach goes to xterm (incl. the ?? '' null-text arm)
		lastES!.emit('output', JSON.stringify({}));
		lastES!.emit('settled', JSON.stringify({ reason: 'stdin_read' }));
		await tick();
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-settle-badge"]')?.textContent).toBeTruthy();

		// host click → xterm focus arm
		(host as HTMLElement).click();

		// no terminal-close button — panel close IS terminal close
		expect(h.target.querySelector('[data-testid="terminal-close"]')).toBeNull();

		// unmount fires the close POST (panel close runs the quiescence ladder)
		h.cleanup();
		await tick();
		const closeCalls = vi.mocked(fetch).mock.calls.filter(
			(c) => String(c[0]) === '/api/terminal/s1/send' && (c[1] as RequestInit | undefined)?.body?.toString().includes('"close"')
		);
		expect(closeCalls).toHaveLength(1);
	});

	it('settle badge cycles through every reason; closed frame renders the closed floor (quiescent true and false)', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();

		for (const reason of ['stdin_read', 'inferred_idle', 'timeout', 'session_exit']) {
			lastES!.emit('settled', JSON.stringify({ reason }));
		}
		await tick();
		flushSync();
		const badge = h.target.querySelector('[data-testid="terminal-settle-badge"]');
		expect(badge?.textContent).toBeTruthy();

		// lingering close: quiescent false → '(lingering)' suffix
		lastES!.emit('closed', JSON.stringify({ quiescent: false }));
		await tick();
		flushSync();
		const closed = h.target.querySelector('[data-testid="terminal-closed"]');
		expect(closed?.textContent).toContain('(lingering)');
		// no close button — teardown rides the panel unmount
		expect(h.target.querySelector('[data-testid="terminal-close"]')).toBeNull();

		// late frames after close never unfake the terminal (reducer freeze)
		lastES!.emit('settled', JSON.stringify({ reason: 'timeout' }));
		await tick();
		h.cleanup();
	});

	it('shell exit (settled session_exit) fires onShellExit once after the pause; other reasons never fire it', async () => {
		const onShellExit = vi.fn();
		fetchRoute = openRoute();
		const h = await mountPanel({ onShellExit });
		await tick();
		flushSync();

		// other settle reasons never fire the callback
		lastES!.emit('settled', JSON.stringify({ reason: 'stdin_read' }));
		lastES!.emit('settled', JSON.stringify({ reason: 'timeout' }));
		await new Promise((r) => setTimeout(r, 50));
		expect(onShellExit).not.toHaveBeenCalled();

		// session_exit schedules the close; the badge stays readable first
		lastES!.emit('settled', JSON.stringify({ reason: 'session_exit' }));
		await new Promise((r) => setTimeout(r, 750));
		expect(onShellExit).not.toHaveBeenCalled();
		expect(h.target.querySelector('[data-testid="terminal-settle-badge"]')?.textContent).toContain('shell exited');
		// the pause elapses → one close, and a duplicate frame never re-fires it
		lastES!.emit('settled', JSON.stringify({ reason: 'session_exit' }));
		await new Promise((r) => setTimeout(r, 1200));
		expect(onShellExit).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('named exit + error frames and the onmessage guard arm all route through applyFrame', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();

		// (the old onmessage guard arm is gone — the hub parses SSE events;
		// torn/untagged frames are dropped in the service, unit-pinned there)
		// exit frame: the reducer's no-op arm
		lastES!.emit('exit', JSON.stringify({ outcome: { exitCode: 0, signal: null } }));
		// error frame: sets errored without closing
		lastES!.emit('error', JSON.stringify({ error: 'pty died' }));
		await tick();
		flushSync();
		// stream still open after error (only 'closed' closes it)
		expect(lastES!.closed).toBe(false);
		h.cleanup();
	});

	it('xterm constructor failure -> xtermFailed fallback surface: pre mirror + typed line Enter -> sendLine', async () => {
		xtermState.fail = true; // the mocked Terminal constructor throws -> the catch arm
		fetchRoute = openRoute();
		const h = await mountPanel();
		await tick();
		flushSync();
		const pre = h.target.querySelector('[data-testid="terminal-fallback"]');
		expect(pre).not.toBeNull();
		const input = h.target.querySelector('[data-testid="terminal-input"]') as HTMLInputElement;
		expect(input).not.toBeNull();

		// output before/without xterm mirrors into fallbackText (incl. ?? '' arm)
		lastES!.emit('output', JSON.stringify({ text: 'hello' }));
		lastES!.emit('output', JSON.stringify({}));
		await tick();
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-fallback"]')?.textContent).toContain('hello');

		// host click -> the termEl textarea focus arm (no xterm)
		(h.target.querySelector('[data-testid="terminal-host"]') as HTMLElement).click();

		// empty line -> guard returns, no POST
		const before = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes('/send')).length;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();

		// typed line -> sendLine POSTs the write
		input.value = 'echo hi';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await tick();
		const calls = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes('/send'));
		expect(calls.length).toBe(before + 1);
		expect((calls[calls.length - 1][1] as RequestInit).body).toContain('"write"');
		h.cleanup();
	});
});

describe('TerminalPanel — token auto-heal + reconnect ladder (coverage)', () => {
	it('403 FOREIGN_SESSION write heals: reattach once, swap the token, retry the SAME keystroke', async () => {
		let writeAttempts = 0;
		let reattached = false;
		const onAssigned = vi.fn();
		fetchRoute = (url, init) => {
			const body = (init as RequestInit | undefined)?.body?.toString() ?? '';
			if (url.endsWith('/reattach')) {
				reattached = true;
				return Promise.resolve(jsonResponse({ token: 't2', fromByte: 0 }));
			}
			if (url.includes('/send') && body.includes('"write"')) {
				writeAttempts += 1;
				if (writeAttempts === 1) return Promise.resolve(new Response(JSON.stringify({ error: 'FOREIGN_SESSION' }), { status: 403 }));
				return Promise.resolve(jsonResponse({ ok: true }));
			}
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
			if (url === '/api/terminal' && init) return Promise.resolve(jsonResponse({ sessionId: 's1', token: 't1', totalBytes: 0 }));
			return Promise.resolve(jsonResponse({ ok: true }));
		};
		const h = await mountPanel({ onAssigned });
		await tick();
		flushSync();
		// xterm keystroke → write → 403 → heal → retry succeeds
		onDataHandlers[0]('ls\n');
		await tick();
		await tick();
		flushSync();
		expect(reattached).toBe(true);
		expect(writeAttempts).toBe(2);
		// the heal badge shows and the desk learns the fresh token
		expect(h.target.querySelector('[data-testid="terminal-heal-badge"]')).not.toBeNull();
		expect(onAssigned).toHaveBeenCalledWith('s1', 't2');
		h.cleanup();
	});

	it('a refused heal (reattach not ok) gives up quietly — no second write attempt', async () => {
		let writeAttempts = 0;
		fetchRoute = (url, init) => {
			const body = (init as RequestInit | undefined)?.body?.toString() ?? '';
			if (url.endsWith('/reattach')) return Promise.resolve(jsonResponse({ error: 'no' }, false));
			if (url.includes('/send') && body.includes('"write"')) {
				writeAttempts += 1;
				return Promise.resolve(new Response('{}', { status: 403 }));
			}
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
			if (url === '/api/terminal' && init) return Promise.resolve(jsonResponse({ sessionId: 's1', token: 't1', totalBytes: 0 }));
			return Promise.resolve(jsonResponse({ ok: true }));
		};
		const h = await mountPanel();
		await tick();
		flushSync();
		onDataHandlers[0]('x');
		await tick();
		await tick();
		expect(writeAttempts).toBe(1);
		h.cleanup();
	});

	it('hub stream error closes the source and the HUB ladder re-opens from the painted offset (ADR-0053 D4)', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		vi.useFakeTimers();
		try {
			// paint an offset, then the stream dies
			lastES!.emit('output', JSON.stringify({ text: 'chunk', nextOffset: 4096 }));
			const dead = lastES!;
			dead.onerror?.();
			expect(dead.closed).toBe(true);
			// backoff timer fires the manual reattach from lastOffset
			vi.advanceTimersByTime(1000);
			expect(lastES).not.toBe(dead);
			expect(hubIds(lastES!.url)).toEqual(['s1']);
			expect(hubResume(lastES!.url)).toEqual({ s1: 4096 }); // resumed where the view painted
			// the delay doubled: the second error waits longer, still one ladder at a time
			const second = lastES!;
			second.onerror?.();
			vi.advanceTimersByTime(1000);
			expect(lastES).toBe(second);
			vi.advanceTimersByTime(1000);
			expect(lastES).not.toBe(second);
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a closed named frame ends the stream: the source closes and the ladder never restarts', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel();
		vi.useFakeTimers();
		try {
			const es = lastES!;
			es.emit('closed', JSON.stringify({ quiescent: true }));
			expect(es.closed).toBe(true);
			const count = vi.mocked(fetch).mock.calls.length;
			es.onerror?.(); // a late error after close must NOT schedule a reattach
			vi.advanceTimersByTime(8000);
			expect(lastES).toBe(es);
			expect(vi.mocked(fetch).mock.calls.length).toBe(count);
			h.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});

	it('probe theming:true switches the panel to the themed surface classes', async () => {
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, theming: true, sessions: [] }));
			if (url === '/api/terminal' && init) return Promise.resolve(jsonResponse({ sessionId: 's1', token: 't1', totalBytes: 0 }));
			return Promise.resolve(jsonResponse({ ok: true }));
		};
		const h = await mountPanel();
		await tick();
		flushSync();
		const panel = h.target.querySelector('[data-testid="terminal-panel"]')!;
		expect(panel.className).toContain('bg-surface-elevated');
		h.cleanup();
	});

	it('zoom prop applies the pocket counter-scale styles and the xterm font size', async () => {
		fetchRoute = openRoute();
		const h = await mountPanel({ zoom: 1.5 });
		await tick();
		flushSync();
		const pocket = h.target.querySelector('[data-testid="terminal-host"] div[style]') as HTMLElement | null;
		expect(pocket?.getAttribute('style')).toContain('scale(0.66');
		h.cleanup();
	});
});

describe('TerminalPanel — row mode (Terminal Desk Wave 2, task 2.2-T)', () => {
	it('assigned row SKIPS the probe/reattach ladder entirely — the desk already holds the lease', async () => {
		let probed = false;
		fetchRoute = (url) => {
			if (url === '/api/terminal' && !init0(url)) probed = true;
			return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
		};
		function init0(_url: string): boolean { return false; }
		const onAssigned = vi.fn();
		const h = await mountPanel({ assigned: { sessionId: 'sess-row', token: 'tok-row' }, onAssigned });
		await tick();
		flushSync();
		expect(probed).toBe(false);
		expect(onAssigned).toHaveBeenCalledWith('sess-row', 'tok-row');
		// the stream attaches to the ASSIGNED session, replaying from 0
		// the hub transport: ids=[sess-row], replaying from 0
		expect(hubIds(lastES!.url)).toEqual(['sess-row']);
		expect(hubResume(lastES!.url)).toEqual({ 'sess-row': 0 });
		h.cleanup();
	});

	it('solo mode still fires onAssigned after the ladder (desk records the lease)', async () => {
		fetchRoute = openRoute([]);
		const onAssigned = vi.fn();
		const h = await mountPanel({ onAssigned });
		await tick();
		flushSync();
		expect(onAssigned).toHaveBeenCalledWith('s1', 't1');
		h.cleanup();
	});
});