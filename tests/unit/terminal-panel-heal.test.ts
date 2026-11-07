/**
 * TerminalPanel auto-heal tests (ADR The Surviving Shell, amendment
 * 2026-11-04): the write token is a baton with one holder — a 403
 * FOREIGN_SESSION write must heal (reattach once → fresh token → retry the
 * SAME keystroke → onAssigned re-synced → heal badge), and a dead SSE
 * stream must climb a reconnect ladder from the last painted offset
 * instead of freezing forever.
 *
 * Drive path: the fallback input + Enter (sendLine → writeWithHeal) —
 * xterm is forced OFF (xtermState.fail) because the happy-dom full-attach
 * path is a PRE-EXISTING failure (terminal-panel-coverage "full attach",
 * fails on a clean baseline too); sendLine and attachStream are the
 * surfaces under test and both run without xterm.
 */
import { mount, unmount, flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		options = {};
		loadAddon() {}
		open() {
			throw new Error('no xterm in the heal harness');
		}
		write() {}
		onResize() {}
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
	observe() {}
	disconnect() {}
}

interface FakeES {
	url: string;
	closed: boolean;
	onmessage: ((e: { data: string }) => void) | null;
	onerror: ((e: unknown) => void) | null;
	listeners: Map<string, Array<(e: MessageEvent) => void>>;
	close(): void;
	addEventListener(kind: string, fn: (e: MessageEvent) => void): void;
	emit(kind: string, data?: string): void;
	fail(): void;
}

const sources: FakeES[] = [];
let lastES: FakeES | null = null;

class FakeEventSource implements FakeES {
	url: string;
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	listeners = new Map<string, Array<(e: MessageEvent) => void>>();
	constructor(url: string) {
		this.url = url;
		sources.push(this);
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
	fail() {
		this.onerror?.(new Event('error'));
	}
}

interface Call {
	url: string;
	token: string | undefined;
	status: number;
}

const calls: Call[] = [];
/** token the server currently honors; a write with any other token is 403. */
let serverToken = 'old-tok';
let reattachCount = 0;

function route(_url: string, init?: RequestInit): Promise<Response> {
	const body = init?.body ? (JSON.parse(init.body as string) as { token?: string; action?: string }) : undefined;
	const path = new URL('http://x' + _url).pathname;
	if (path === '/api/terminal' && !init) {
		return Promise.resolve(new Response(JSON.stringify({ enabled: true, sessions: [{ id: 's1', exited: false }] })));
	}
	if (path.endsWith('/reattach')) {
		reattachCount += 1;
		serverToken = 'fresh-' + reattachCount;
		calls.push({ url: path, token: undefined, status: 200 });
		return Promise.resolve(new Response(JSON.stringify({ token: serverToken, fromByte: 4096 })));
	}
	if (path.endsWith('/send')) {
		const ok = body?.token === serverToken;
		calls.push({ url: path, token: body?.token, status: ok ? 200 : 403 });
		return Promise.resolve(
			new Response(JSON.stringify(ok ? { written: true } : { error: 'FOREIGN_SESSION' }), { status: ok ? 200 : 403 })
		);
	}
	return Promise.resolve(new Response(JSON.stringify({})));
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

async function mountPanel(props: Record<string, unknown> = {}): Promise<{ target: HTMLElement; cleanup: () => void }> {
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

/** Type one line into the fallback input and press Enter. */
async function typeLine(target: HTMLElement, line: string): Promise<void> {
	const input = target.querySelector('[data-testid="terminal-input"]') as HTMLInputElement;
	expect(input, 'fallback input present (xterm forced off)').not.toBeNull();
	input.value = line;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await tick(30);
	flushSync();
}

beforeEach(() => {
	resetStreamHubForTests();
	sources.length = 0;
	lastES = null;
	calls.length = 0;
	serverToken = 'old-tok';
	reattachCount = 0;
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver);
});

describe('TerminalPanel — the token auto-heal (FOREIGN_SESSION 403)', () => {
	it('heals once: reattach, fresh token, retry the SAME keystroke, re-sync onAssigned, badge', async () => {
		serverToken = 'held-elsewhere'; // the baton moved — the panel's token is stale
		vi.stubGlobal(
			'fetch',
			vi.fn((url: RequestInfo | URL, init?: RequestInit) => route(String(url), init))
		);
		const assignedTokens: string[] = [];
		const { target, cleanup } = await mountPanel({
			assigned: { sessionId: 's1', token: 'old-tok' },
			onAssigned: (_id: string, tok: string) => assignedTokens.push(tok)
		});
		await typeLine(target, 'echo hi');
		// the wire story: refused write → reattach → retried write with the fresh token
		const sends = calls.filter((c) => c.url.endsWith('/send'));
		expect(calls.filter((c) => c.url.endsWith('/reattach'))).toHaveLength(1);
		expect(sends.map((c) => c.status)).toEqual([403, 200]); // refused once, retried once
		expect(sends[1].token).toBe('fresh-1'); // the retry rides the NEW token
		expect(assignedTokens).toContain('fresh-1'); // the lease holder is re-synced
		expect(target.querySelector('[data-testid="terminal-heal-badge"]')).not.toBeNull();
		cleanup();
	});

	it('does not heal when the first write succeeds (no reattach, no badge)', async () => {
		serverToken = 'old-tok'; // the panel's token IS the server's — healthy
		vi.stubGlobal(
			'fetch',
			vi.fn((url: RequestInfo | URL, init?: RequestInit) => route(String(url), init))
		);
		const { target, cleanup } = await mountPanel({
			assigned: { sessionId: 's1', token: 'old-tok' }
		});
		await typeLine(target, 'echo hi');
		expect(calls.filter((c) => c.url.endsWith('/reattach'))).toHaveLength(0);
		const sends = calls.filter((c) => c.url.endsWith('/send'));
		expect(sends.map((c) => c.status)).toEqual([200]);
		expect(target.querySelector('[data-testid="terminal-heal-badge"]')).toBeNull();
		cleanup();
	});
});

describe('TerminalPanel — the HUB reconnect ladder (ADR-0053 D4, via the page\'s one source)', () => {
	it('reconnects from the last painted offset after a stream failure, backoff doubling', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn((url: RequestInfo | URL, init?: RequestInit) => route(String(url), init))
		);
		const { cleanup } = await mountPanel({
			assigned: { sessionId: 's1', token: 'old-tok' }
		});
		const first = lastES as FakeES;
		// a live frame paints the view AND pins the resume offset
		first.emit('output', JSON.stringify({ text: 'hi', nextOffset: 4096 }));
		first.fail();
		expect(first.closed).toBe(true); // the dead source is closed, not left auto-retrying
		await tick(1200);
		expect(sources).toHaveLength(2);
		expect(sources[1].url).toContain('resume=' + encodeURIComponent('{"s1":4096}')); // hub ladder resumes at the painted offset
		// second failure doubles the backoff: 2s — not yet at 1.1s, yes at 2.2s
		sources[1].fail();
		await tick(1100);
		expect(sources).toHaveLength(2);
		await tick(1200);
		expect(sources).toHaveLength(3);
		cleanup();
	});

	it('stops the ladder when the session really closed (closed frame then failure)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn((url: RequestInfo | URL, init?: RequestInit) => route(String(url), init))
		);
		const { cleanup } = await mountPanel({
			assigned: { sessionId: 's1', token: 'old-tok' }
		});
		const es = lastES as FakeES;
		es.emit('closed', JSON.stringify({ quiescent: true }));
		es.fail();
		await tick(3200);
		expect(sources).toHaveLength(1); // a closed session never re-attaches
		cleanup();
	});
});