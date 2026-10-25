/**
 * BrowserPanel — misc branch coverage (Slice E addendum): the proxy verb
 * pipeline (navigate POST ok / 404 / 409 / fetch-throw / in-flight guard,
 * ADR-0031 D1/D2), the address-bar toTarget URL-vs-search split, the
 * viewport-follow debounced sync (size gate, change gate, timer re-arm),
 * and the SSE onerror arm when the panel is already closed.
 * Fetch/EventSource/Image are stubbed exactly like the main suite.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

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

interface NavAnswer {
	status: number;
	body: unknown;
}
const env: {
	navigate: NavAnswer | null;
	navigateCalls: unknown[];
	navigateThrow: boolean;
	inputStatus: number;
	openOk: boolean;
	pageOk: boolean;
	viewportBodies: unknown[];
	closeCalls: string[];
} = {
	navigate: null,
	navigateCalls: [],
	navigateThrow: false,
	inputStatus: 200,
	openOk: true,
	pageOk: true,
	viewportBodies: [],
	closeCalls: []
};

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	if (url.endsWith('/api/browser') && init.method === 'POST') {
		if (!env.openOk) return new Response('boom', { status: 500 });
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.endsWith('/page')) {
		return new Response(env.pageOk ? JSON.stringify({ dpr: 1 }) : 'nope', { status: env.pageOk ? 200 : 500 });
	}
	if (url.includes('/navigate')) {
		env.navigateCalls.push(JSON.parse(String(init.body)) as unknown);
		if (env.navigateThrow) throw new TypeError('navigate route down');
		const a = env.navigate ?? { status: 200, body: { currentIndex: 0, entryCount: 1 } };
		return new Response(JSON.stringify(a.body), { status: a.status });
	}
	if (url.includes('/viewport')) {
		env.viewportBodies.push(JSON.parse(String(init.body)) as unknown);
		return new Response('{}', { status: 200 });
	}
	if (url.includes('/input')) {
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
	env.navigate = null;
	env.navigateCalls = [];
	env.navigateThrow = false;
	env.inputStatus = 200;
	env.openOk = true;
	env.pageOk = true;
	env.viewportBodies = [];
	env.closeCalls = [];
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

async function goLive(view: { target: HTMLElement }): Promise<StubEventSource> {
	const source = StubEventSource.instances[0];
	const b64 = Buffer.from('fakejpeg').toString('base64');
	source.emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
	await settle();
	expect(statusOf(view.target)).toBe('live');
	return source;
}

/** Type into the header address bar and press Enter. */
function submitAddress(target: HTMLElement, text: string): void {
	const input = target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('BrowserPanel — proxy verbs (ADR-0031, slice E)', () => {
	it('a URL phrase rides verbatim: navigate POST, bounds refreshed, input cleared', async () => {
		env.navigate = { status: 200, body: { currentIndex: 1, entryCount: 3 } };
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		expect(view.target.querySelector('[data-testid="browser-back"]')?.hasAttribute('disabled')).toBe(true);
		submitAddress(view.target, 'https://example.com/a?b=c');
		await settle();
		expect(env.navigateCalls).toEqual([{ url: 'https://example.com/a?b=c' }]);
		const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		expect(input.value).toBe(''); // the ANSWER clears the box
		// idx=1 of 3: back enabled, forward enabled
		expect(view.target.querySelector('[data-testid="browser-back"]')?.hasAttribute('disabled')).toBe(false);
		expect(view.target.querySelector('[data-testid="browser-forward"]')?.hasAttribute('disabled')).toBe(false);
		view.un();
	});

	it('a search phrase rides the engine; idx 0 of 2 → back off, forward on', async () => {
		env.navigate = { status: 200, body: { currentIndex: 0, entryCount: 2 } };
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		submitAddress(view.target, 'cats & dogs');
		await settle();
		expect(env.navigateCalls).toEqual([{ url: 'https://www.google.com/search?q=cats%20%26%20dogs' }]);
		expect(view.target.querySelector('[data-testid="browser-back"]')?.hasAttribute('disabled')).toBe(true);
		expect(view.target.querySelector('[data-testid="browser-forward"]')?.hasAttribute('disabled')).toBe(false);
		view.un();
	});

	it('a data:text/html phrase is a URL too — the second toTarget arm', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		submitAddress(view.target, 'data:text/html,<h1>hi</h1>');
		await settle();
		expect(env.navigateCalls).toEqual([{ url: 'data:text/html,<h1>hi</h1>' }]);
		view.un();
	});

	it('a 404 navigate marks the panel closed and detaches the stream', async () => {
		env.navigate = { status: 404, body: 'gone' };
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		submitAddress(view.target, 'https://dead.test/');
		await settle();
		expect(statusOf(view.target)).toBe('closed');
		expect(StubEventSource.instances[0].closed).toBe(true);
		view.un();
	});

	it('a 409 navigate also lands in the closed posture', async () => {
		env.navigate = { status: 409, body: 'conflict' };
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		submitAddress(view.target, 'https://busy.test/');
		await settle();
		expect(statusOf(view.target)).toBe('closed');
		view.un();
	});

	it('a navigate fetch throw is swallowed — status stays live, busy resets, the next verb still goes', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		env.navigateThrow = true;
		submitAddress(view.target, 'https://down.test/');
		await settle();
		expect(env.navigateCalls).toHaveLength(1);
		expect(statusOf(view.target)).toBe('live'); // transient, no crash
		// busy cleared: a second verb (reload) goes out once the route is back
		env.navigateThrow = false;
		env.navigate = { status: 200, body: { currentIndex: 0, entryCount: 1 } };
		(view.target.querySelector('[data-testid="browser-reload"]') as HTMLButtonElement).click();
		await settle();
		expect(env.navigateCalls).toEqual([
			{ url: 'https://down.test/' },
			{ action: 'reload' }
		]);
		view.un();
	});

	it('the in-flight guard: a second proxy verb during a pending navigate is dropped', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		let release!: (v: Response) => void;
		const gate = new Promise<Response>((r) => (release = r));
		fetchMock.mockImplementationOnce(async (...args: Parameters<typeof fetch>) => {
			env.navigateCalls.push(JSON.parse(String((args[1] ?? {}).body)) as unknown);
			return gate;
		});
		submitAddress(view.target, 'https://slow.test/');
		await new Promise((r) => setTimeout(r, 0));
		expect(env.navigateCalls).toHaveLength(1);
		// second verb while busy → dropped by the proxyBusy guard
		submitAddress(view.target, 'https://second.test/');
		await new Promise((r) => setTimeout(r, 0));
		expect(env.navigateCalls).toHaveLength(1);
		release(new Response(JSON.stringify({ currentIndex: 0, entryCount: 1 }), { status: 200 }));
		await settle();
		expect(env.navigateCalls).toEqual([{ url: 'https://slow.test/' }]);
		view.un();
	});

	it('history buttons POST their action verbs', async () => {
		env.navigate = { status: 200, body: { currentIndex: 2, entryCount: 5 } };
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		// the bounds come only from a navigate answer — open history first
		submitAddress(view.target, 'https://seed.test/');
		await settle();
		env.navigateCalls = [];
		(view.target.querySelector('[data-testid="browser-back"]') as HTMLButtonElement).click();
		await settle();
		(view.target.querySelector('[data-testid="browser-forward"]') as HTMLButtonElement).click();
		await settle();
		expect(env.navigateCalls).toEqual([{ action: 'back' }, { action: 'forward' }]);
		view.un();
	});
});

describe('BrowserPanel — viewport-follow sync (ADR-0031 amendment 2, slice E)', () => {
	function sizeGlass(view: { target: HTMLElement }, w: number, h: number): void {
		const glass = view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
		Object.defineProperty(glass, 'clientWidth', { configurable: true, value: w });
		Object.defineProperty(glass, 'clientHeight', { configurable: true, value: h });
		// ADR-0041: the panel measures the transform-true rect — stub it to
		// the SAME size (layout = visual at zoom 1, this suite's premise)
		Object.defineProperty(glass, 'getBoundingClientRect', {
			value: () => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h }),
			configurable: true
		});
	}

	// ADR-0041 Wave 3 flake hardening: this trio races the real 250ms
	// debounce against worker scheduling — under parallel load a tick can
	// straggle (observed 2026-10-25: alone 15/15, parallel 2 fails). Two
	// retries turn the race into a pass without fake-timer surgery.
	const RETRY = { retry: 2 } as const;
	it('a frame with a big-enough changed wrap debounces one /viewport POST', RETRY, async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		sizeGlass(view, 320, 240);
		await goLive(view); // frame fires syncViewport; timer set
		expect(env.viewportBodies).toEqual([]); // not yet — 250ms debounce
		await new Promise((r) => setTimeout(r, 350));
		flushSync();
		expect(env.viewportBodies).toEqual([{ width: 320, height: 240 }]);
		view.un();
	});

	it('a collapsed wrap (w<100) sends nothing', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		sizeGlass(view, 80, 240);
		await goLive(view);
		await new Promise((r) => setTimeout(r, 350));
		expect(env.viewportBodies).toEqual([]);
		view.un();
	});

	it('a short wrap (h<80) sends nothing — the second arm of the size gate', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		sizeGlass(view, 400, 60);
		await goLive(view);
		await new Promise((r) => setTimeout(r, 350));
		expect(env.viewportBodies).toEqual([]);
		view.un();
	});

	it('a wrap within 2px of the last synced size sends nothing — the no-change gate', RETRY, async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		sizeGlass(view, 320, 240);
		await goLive(view);
		await new Promise((r) => setTimeout(r, 350));
		expect(env.viewportBodies).toEqual([{ width: 320, height: 240 }]);
		// second frame, 1px drift → inside the ±2 tolerance, no new POST
		sizeGlass(view, 321, 241);
		const b64 = Buffer.from('again').toString('base64');
		StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
		await new Promise((r) => setTimeout(r, 350));
		flushSync();
		expect(env.viewportBodies).toEqual([{ width: 320, height: 240 }]);
		view.un();
	});

	it('a burst of frames re-arms the pending timer — still one POST per settle', RETRY, async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		sizeGlass(view, 320, 240);
		const source = await goLive(view);
		const b64 = Buffer.from('burst').toString('base64');
		source.emit('frame', JSON.stringify({ jpeg: b64, metadata: {} })); // clearTimeout + re-arm
		await new Promise((r) => setTimeout(r, 350));
		flushSync();
		expect(env.viewportBodies).toEqual([{ width: 320, height: 240 }]); // exactly one
		view.un();
	});
});

describe('BrowserPanel — late SSE error after close (slice E)', () => {
	it('a late SSE error after the FOLD lands on a detached stream - no crash, no failed flip (ADR-0037 D1)', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		(view.target.querySelector('[data-testid="browse-close"]') as HTMLButtonElement).click();
		await settle();
		view.un(); // the fold removes the panel - the unmount detaches the stream
		expect(StubEventSource.instances[0].closed).toBe(true);
		StubEventSource.instances[0].fireError(); // late disconnect on the detached stream
		flushSync();
		// no throw, no state write - the component is gone
	});

	it('an empty address bar Enter is a no-op', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		submitAddress(view.target, '   ');
		await settle();
		expect(env.navigateCalls).toEqual([]);
		view.un();
	});
});
