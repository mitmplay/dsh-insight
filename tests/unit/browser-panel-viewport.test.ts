/**
 * BrowserPanel — syncViewport guard branches (ADR-0031 amendment 2,
 * viewport-follow). Direct-mount suite reusing the browser-panel.test.ts
 * mounting/mocking patterns. Pins each early return of syncViewport():
 *   L58 no sessionId (ResizeObserver fired before the resolver answered)
 *   L58 no wrap (callback fired after unmount — wrap unbound)
 *   L61 collapsed glass (clientWidth < 100 or clientHeight < 80)
 *   L62 duplicate viewport (debounce early-return — no second POST)
 *   L63 timer-present path (a second viewport change inside the debounce
 *       window clears the pending timer — exactly ONE /viewport POST,
 *       the LAST size wins)
 * fetch and EventSource are stubbed; ResizeObserver is captured so the
 * observation callback is fired manually and deterministically.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

const DEBOUNCE_MS = 250;

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
}

// happy-dom never decodes data: URLs — replace Image wholesale so onload
// fires. The frame dimensions double as the viewport (dpr stays 1).
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

const SESSION_ID = 'warm-abc12345';

/** Captured ResizeObserver instances — callbacks are fired manually. */
interface RoInstance {
	callback: (entries?: unknown[]) => void;
	observe: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
}
let roInstances: RoInstance[] = [];
const StubResizeObserver = class {
	observe: ReturnType<typeof vi.fn>;
	disconnect: ReturnType<typeof vi.fn>;
	callback: (entries?: unknown[]) => void;
	constructor(cb: (entries?: unknown[]) => void) {
		this.callback = cb;
		this.observe = vi.fn();
		this.disconnect = vi.fn();
		roInstances.push(this);
	}
};

let rafCbs: Array<() => void> = [];

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	return new Response("unrouted: " + url, { status: 404 });
});

function viewportCalls(): { url: string; body: Record<string, unknown> }[] {
	return fetchMock.mock.calls
		.map((c) => ({ url: String(c[0]), init: (c[1] ?? {}) as RequestInit }))
		.filter((c) => c.url.includes('/viewport'))
		.map((c) => ({ url: c.url, body: JSON.parse(String(c.init.body)) as Record<string, unknown> }));
}

beforeEach(() => {
	StubEventSource.instances = [];
	roInstances = [];
	frameSize.w = 800;
	frameSize.h = 400;
	rafCbs = [];
	vi.stubGlobal("Image", FrameImage as unknown as typeof Image);
	vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
	vi.stubGlobal("EventSource", StubEventSource as unknown as typeof EventSource);
	vi.stubGlobal("ResizeObserver", StubResizeObserver as unknown as typeof ResizeObserver);
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((cb: () => void) => {
			rafCbs.push(cb);
			return rafCbs.length;
		}) as unknown as typeof requestAnimationFrame
	);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
	// every route the panel may touch answers 200; viewport calls are recorded
	fetchMock.mockClear();
	fetchMock.mockImplementation(async (...args: Parameters<typeof fetch>): Promise<Response> => {
		const url = String(args[0]);
		const init = (args[1] ?? {}) as RequestInit;
		if (url.includes('/viewport')) return new Response('{}', { status: 200 });
		if (url.includes('/input')) return new Response('{}', { status: 200 });
		if (url.includes('/close')) return new Response('{}', { status: 200 });
		return new Response("unrouted: " + url, { status: 404 });
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

/** Override the glass wrap clientWidth/clientHeight (happy-dom reports 0). */
function sizeWrap(target: HTMLElement, w: number, h: number): void {
	const wrap = target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
	Object.defineProperty(wrap, 'clientWidth', { value: w, configurable: true });
	Object.defineProperty(wrap, 'clientHeight', { value: h, configurable: true });
}

function mountPanel(props: { browserSessionId?: string } = {}) {
	const target = document.createElement("div");
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

/** Fire a frame and await its draw; the panel must be live afterwards. */
async function goLive(view: { target: HTMLElement }): Promise<StubEventSource> {
	const source = StubEventSource.instances[0];
	const b64 = Buffer.from('fakejpeg').toString('base64');
	source.emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
	await settle();
	expect(view.target.querySelector('[data-testid="browser-status"]')?.getAttribute('data-status')).toBe('live');
	return source;
}

function fireFrame(source: StubEventSource, tag: string): void {
	source.emit('frame', JSON.stringify({ jpeg: Buffer.from(tag).toString('base64'), metadata: {} }));
}

/** Await past the 250ms debounce window. */
async function settleViewport(): Promise<void> {
	await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 60));
	flushSync();
}

describe('BrowserPanel — syncViewport guard branches (viewport-follow)', () => {
	it('a ResizeObserver callback before any session exists returns on the !sessionId guard — nothing posts', async () => {
		// COLD mount with the open POST held PENDING: the resolver never
		// answers, so sessionId stays null even after the effects have flushed
		// and the $effect has armed the ResizeObserver on the bound wrap.
		fetchMock.mockImplementationOnce(async () => new Promise<Response>(() => undefined));
		const view = mountPanel();
		await settle(2);
		expect(roInstances.length).toBeGreaterThan(0);
		roInstances.forEach((ro) => ro.callback());
		await settle();
		await settleViewport();
		expect(viewportCalls()).toEqual([]);
		view.un();
	});

	it('a ResizeObserver callback after unmount returns on the !wrap guard — nothing posts', async () => {
		// WARM mount: sessionId is set synchronously in onMount; after unmount
		// the wrap binding is gone, so the captured callback now hits the
		// !wrap arm of the SAME guard.
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		expect(roInstances.length).toBeGreaterThan(0);
		sizeWrap(view.target, 400, 300);
		view.un();
		roInstances.forEach((ro) => ro.callback());
		await settle();
		await settleViewport();
		expect(viewportCalls()).toEqual([]);
	});

	it('a collapsed glass (width < 100) returns on the size guard — the debounce never arms', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		const source = await goLive(view);
		sizeWrap(view.target, 90, 300); // width below the 100px floor
		fireFrame(source, "f");
		await settle();
		await settleViewport();
		expect(viewportCalls()).toEqual([]);
		// a real ResizeObserver tick changes nothing either — the guard lives
		// inside syncViewport, not in the observation path
		roInstances.forEach((ro) => ro.callback());
		await settleViewport();
		expect(viewportCalls()).toEqual([]);
		view.un();
	});

	it('a collapsed glass (height < 80) returns on the size guard too', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		const source = await goLive(view);
		sizeWrap(view.target, 400, 70); // height below the 80px floor
		fireFrame(source, "f");
		await settle();
		await settleViewport();
		expect(viewportCalls()).toEqual([]);
		view.un();
	});

	it('a duplicate viewport returns on the debounce guard — one POST per settle', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		const source = await goLive(view);
		sizeWrap(view.target, 400, 300);
		// first observation: {0,0} → {400,300} passes the guard, arms the timer
		fireFrame(source, "f");
		await settle();
		await settleViewport();
		expect(viewportCalls()).toEqual([{ url: '/api/browser/' + SESSION_ID + '/viewport', body: { width: 400, height: 300 } }]);
		// same size again: |Δ| < 2 on BOTH axes → the early return eats it
		fireFrame(source, "g");
		roInstances.forEach((ro) => ro.callback());
		await settle();
		await settleViewport();
		expect(viewportCalls()).toHaveLength(1); // no second POST
		view.un();
	});

	it('two viewport changes inside the debounce window clear the first timer — exactly ONE POST, the LAST size wins', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		const source = await goLive(view);
		sizeWrap(view.target, 400, 300);
		fireFrame(source, "f");
		await settle();
		// SECOND change before the 250ms timer fires → clearTimeout runs
		sizeWrap(view.target, 500, 350);
		fireFrame(source, "g");
		roInstances.forEach((ro) => ro.callback());
		await settle();
		await settleViewport();
		const calls = viewportCalls();
		expect(calls).toHaveLength(1); // the first timer was cleared, not fired
		expect(calls[0].body).toEqual({ width: 500, height: 350 });
		view.un();
		await settleViewport();
		expect(viewportCalls()).toHaveLength(1); // nothing straggles after unmount
	});
});
