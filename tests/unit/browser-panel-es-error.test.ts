/**
 * BrowserPanel — SSE/error-path branch coverage (coverage addendum).
 * Pins the branches the main suite never took BOTH ways:
 *  - L248: es.onerror's guard — an error while the panel is already
 *    'closed' must LEAVE it closed (no failed flip), vs the open case
 *    that flips to 'failed'.
 *  - the EventSource CONSTRUCTOR throwing → the onMount catch sets
 *    status='failed' with failReason from the thrown error.
 *  - the proxy() network-failure shape: a rejected /navigate fetch is
 *    swallowed (status untouched, busy guard released), while a 409/404
 *    from /navigate closes the stream and marks the panel closed.
 * Reuses the mounting/mocking patterns of
 * tests/unit/components/panels/browser-panel.test.ts.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

/** Minimal EventSource stub: records instances, lets tests fire events. */
class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	readyState = 1;
	handlers = new Map<string, Set<(e: { data?: string }) => void>>();
	onerror: (() => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (e: { data?: string }) => void): void {
		if (!this.handlers.has(type)) this.handlers.set(type, new Set());
		this.handlers.get(type)!.add(cb);
	}
	close(): void {
		this.closed = true;
	}
	emit(type: string, data?: string): void {
		for (const cb of this.handlers.get(type) ?? []) cb({ data });
	}
	fireError(readyState = 2): void {
		this.readyState = readyState;
		this.onerror?.();
	}
}

/** EventSource stub whose CONSTRUCTOR throws — the stream attach fails. */
class ThrowingEventSource {
	constructor(url: string) {
		throw new Error('stream endpoint refused: ' + url);
	}
}

// jsdom never decodes data: URLs — replace Image wholesale so onload fires.
const frameSize = { w: 800, h: 400 };
const FrameImage = class {
		onload: (() => void) | null = null;
		_src = '';
		width = 0;
		height = 0;
		constructor() {
			this.width = frameSize.w;
			this.height = frameSize.h;
		}
		set src(v: string) {
			this._src = v;
			setTimeout(() => this.onload?.(), 0);
		}
		get src() {
			return this._src;
		}
};

const SESSION_ID = 'sess-1234567890abcdef';

interface FetchEnv {
	inputBodies: Record<string, unknown>[];
	inputStatus: number;
	openOk: boolean;
	pageOk: boolean;
	closeCalls: string[];
	navigateResponses: Array<{ status: number; reject?: Error }>;
}
const env: FetchEnv = {
	inputBodies: [],
	inputStatus: 200,
	openOk: true,
	pageOk: true,
	closeCalls: [],
	navigateResponses: []
};

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	if (url.endsWith('/api/browser') && init.method === 'POST') {
		if (!env.openOk) return new Response('boom', { status: 500 });
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.endsWith('/page')) {
		return new Response(env.pageOk ? JSON.stringify({ dpr: 2 }) : 'nope', { status: env.pageOk ? 200 : 500 });
	}
	if (url.includes('/navigate')) {
		const next = env.navigateResponses.shift();
		if (next?.reject) throw next.reject;
		return new Response(JSON.stringify({ currentIndex: 0, entryCount: 1 }), { status: next?.status ?? 200 });
	}
	if (url.includes('/input')) {
		env.inputBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
		return new Response('{}', { status: env.inputStatus });
	}
	if (url.includes('/close')) {
		env.closeCalls.push(url);
		return new Response('{}', { status: 200 });
	}
	return new Response('unrouted: ' + url, { status: 404 });
});

let rafCbs: Array<() => void>;
beforeEach(() => {
	StubEventSource.instances = [];
	env.inputBodies = [];
	env.inputStatus = 200;
	env.openOk = true;
	env.pageOk = true;
	env.closeCalls = [];
	env.navigateResponses = [];
	frameSize.w = 800;
	frameSize.h = 400;
	rafCbs = [];
	vi.stubGlobal('Image', FrameImage as unknown as typeof Image);
	vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
	fetchMock.mockClear();
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	vi.stubGlobal(
		'requestAnimationFrame',
		vi.fn((cb: () => void) => {
			rafCbs.push(cb);
			return rafCbs.length;
		}) as unknown as typeof requestAnimationFrame
	);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function mountPanel(props: { browserSessionId?: string; onclose?: () => void; apiBase?: string } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserPanel, { target, props });
	return {
		target,
		un: () => {
			unmount(instance);
			target.remove();
		}
	};
}

/** Drain the mount-time async open chain (microtasks + Image macrotasks). */
async function settle(times = 4): Promise<void> {
	for (let i = 0; i < times; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
	}
	flushSync();
}

function statusOf(target: HTMLElement): string {
	return target.querySelector('[data-testid="browser-status"]')?.getAttribute('data-status') ?? '';
}

/** Fire a frame and await its draw; the panel must be live afterwards. */
async function goLive(view: { target: HTMLElement }): Promise<StubEventSource> {
	const source = StubEventSource.instances[0];
	const b64 = Buffer.from('fakejpeg').toString('base64');
	source.emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
	await settle();
	expect(statusOf(view.target)).toBe('live');
	return source;
}

function clickReload(view: { target: HTMLElement }): void {
	(view.target.querySelector('[data-testid="browser-reload"]') as HTMLButtonElement).click();
}

describe('BrowserPanel — SSE error-path branches (coverage addendum)', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('es.onerror while the panel is OPEN flips it to failed — the taken guard side', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		StubEventSource.instances[0].fireError(2);
		flushSync();
		expect(statusOf(view.target)).toBe('failed');
		view.un();
	});

	it('es.onerror while the panel is already CLOSED stays closed — the never-taken guard side (L248)', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		// a 409 from /navigate closes the stream and marks the panel closed
		env.navigateResponses.push({ status: 409 });
		clickReload(view);
		await settle();
		expect(StubEventSource.instances[0].closed).toBe(true);
		expect(statusOf(view.target)).toBe('closed');
		// now the stream errors AFTER the close — the guard must hold 'closed'
		StubEventSource.instances[0].fireError(2);
		flushSync();
		expect(statusOf(view.target)).toBe('closed');
		view.un();
	});

	it('an EventSource constructor throw lands in the onMount catch — failed with failReason from the error', async () => {
		vi.stubGlobal('EventSource', ThrowingEventSource as unknown as typeof EventSource);
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		expect(statusOf(view.target)).toBe('failed');
		expect(StubEventSource.instances).toHaveLength(0);
		const failed = view.target.querySelector('[data-testid="browser-failed"]');
		expect(failed).not.toBeNull();
		expect(failed?.textContent).toContain('stream endpoint refused');
		view.un();
	});

	it('a rejected /navigate fetch is swallowed — the proxy catch leaves liveness and releases the busy guard', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		env.navigateResponses.push({ status: 200, reject: new TypeError('navigate route down') });
		expect(() => clickReload(view)).not.toThrow();
		await settle();
		expect(statusOf(view.target)).toBe('live'); // transient — frames show liveness
		// proxyBusy was released: the NEXT navigate goes through
		env.navigateResponses.push({ status: 200 });
		clickReload(view);
		await settle();
		expect(statusOf(view.target)).toBe('live');
		view.un();
	});

	it('a 404 from /navigate also closes — the other side of the proxy status branch', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		env.navigateResponses.push({ status: 404 });
		clickReload(view);
		await settle();
		expect(StubEventSource.instances[0].closed).toBe(true);
		expect(statusOf(view.target)).toBe('closed');
		view.un();
	});
});
