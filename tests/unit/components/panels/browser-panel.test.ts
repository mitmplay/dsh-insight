/**
 * BrowserPanel (ADR-0029 Glass Browser, W2 task 2.1) — direct-mount suite.
 * Pins: the cold open (POST /api/browser → /page dpr → SSE stream attach),
 * the warm shape (prop seed, no open POST), frame arrival (status live +
 * canvas draw + viewport from frame ÷ dpr), operator input mapping (scaled
 * mouse press/release/wheel, printable-key text, move coalescing, 409
 * close), owner-release (panel-close single POST + onclose, unmount
 * DETACHES ONLY — no close POST, ADR-0030 D1) and the failure shapes (open
 * failure, SSE error).
 * fetch and EventSource are stubbed; rAF is captured so move coalescing is
 * deterministic.
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

// jsdom never decodes data: URLs — replace Image wholesale so onload fires.
// Dimensions are static per test (set before firing the frame event).
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
}
const env: FetchEnv = { inputBodies: [], inputStatus: 200, openOk: true, pageOk: true, closeCalls: [] };

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

describe('BrowserPanel — open + stream attach (ADR-0029)', () => {
	it('cold shape: opens a session, reads the page dpr, attaches the SSE stream', async () => {
		const view = mountPanel();
		await settle();
		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls).toContain('/api/browser');
		expect(urls).toContain('/api/browser/' + SESSION_ID + '/page');
		expect(StubEventSource.instances).toHaveLength(1);
		expect(StubEventSource.instances[0].url).toBe('/api/browser/' + SESSION_ID + '/stream?fromSeq=0');
		expect(statusOf(view.target)).toBe('connecting');
		// the status strip shows the registry id prefix
		expect(view.target.querySelector('[data-testid="browser-status"]')?.textContent).toContain('sess-123');
		view.un();
	});

	it('warm shape: the prop seeds the session — no open POST, straight to the stream', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		const urls = fetchMock.mock.calls.map((c) => String(c[0]));
		expect(urls.some((u) => u.endsWith('/api/browser'))).toBe(false);
		expect(StubEventSource.instances[0].url).toBe('/api/browser/warm-abc12345/stream?fromSeq=0');
		view.un();
	});

	it('apiBase is the test seam: every route carries the prefix', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345', apiBase: 'http://hop.test' });
		await settle();
		expect(StubEventSource.instances[0].url).toBe('http://hop.test/api/browser/warm-abc12345/stream?fromSeq=0');
		view.un();
	});

	it('cold open failure: the panel reports failed with the reason', async () => {
		env.openOk = false;
		const view = mountPanel();
		await settle();
		expect(statusOf(view.target)).toBe('failed');
		expect(StubEventSource.instances).toHaveLength(0);
		const failed = view.target.querySelector('[data-testid="browser-failed"]');
		expect(failed).not.toBeNull();
		expect(failed?.textContent).toContain('open failed: 500');
		view.un();
	});

	it('a /page miss leaves dpr at 1 — the frame itself is the viewport', async () => {
		env.pageOk = false;
		const view = mountPanel();
		await settle();
		await goLive(view);
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		expect(canvas.width).toBe(800);
		// dpr=1 → viewport {800,400}; scale = 200/800 = 0.25 → x=400
		vi.spyOn(view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
		canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 100, clientY: 50, bubbles: true }));
		await settle();
		expect(env.inputBodies).toEqual([{ kind: 'mouse', type: 'mouseReleased', x: 400, y: 200, button: 'left', clickCount: 1 }]);
		view.un();
	});

	it('SSE error flips the panel to failed', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		StubEventSource.instances[0].fireError();
		flushSync();
		expect(statusOf(view.target)).toBe('failed');
		view.un();
	});
});

describe('BrowserPanel — frames and the glass canvas', () => {
	it('a frame flips status to live, sizes the canvas from the frame, derives the viewport from frame ÷ dpr, and draws', async () => {
		const view = mountPanel();
		await settle(); // dpr=2 via /page
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		const drawImage = canvas.getContext('2d')!.drawImage as ReturnType<typeof vi.fn>;
		expect(view.target.querySelector('[data-testid="browser-placeholder"]')).not.toBeNull();
		await goLive(view);
		expect(canvas.width).toBe(800);
		expect(canvas.height).toBe(400);
		expect(drawImage).toHaveBeenCalledTimes(1);
		// frame 800 device px, dpr 2 → viewport 400×200 CSS px; scale = 200/400 = 0.5
		// (uniform scale: y uses the SAME divisor as x)
		vi.spyOn(view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
		canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 100, clientY: 50, bubbles: true }));
		await settle();
		expect(env.inputBodies).toEqual([{ kind: 'mouse', type: 'mouseReleased', x: 200, y: 100, button: 'left', clickCount: 1 }]);
		view.un();
	});

	it('placeholder text distinguishes the cold launch from the frame wait', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle(2);
		expect(view.target.querySelector('[data-testid="browser-placeholder"]')?.textContent).toContain('waiting for frames');
		view.un();
	});
});

describe('BrowserPanel — operator input mapping (D6)', () => {
	it('left mousedown/mouseup scale displayed ÷ viewport and POST the CDP shapes', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view); // warm: dpr=1 → viewport {800,400}; scale = 400/800 = 0.5
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		const glass = view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
		vi.spyOn(glass, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 200 } as DOMRect);
		// (50-10)/0.5, (70-20)/0.5
		canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 50, clientY: 70, bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 50, clientY: 70, bubbles: true }));
		await settle();
		expect(env.inputBodies).toEqual([
			{ kind: 'mouse', type: 'mousePressed', x: 80, y: 100, button: 'left', clickCount: 1 },
			{ kind: 'mouse', type: 'mouseReleased', x: 80, y: 100, button: 'left', clickCount: 1 }
		]);
		view.un();
	});

	it('non-primary buttons never post', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		const glass = view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
		vi.spyOn(glass, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
		canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 5, clientY: 5, bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, clientX: 5, clientY: 5, bubbles: true }));
		await settle();
		expect(env.inputBodies).toEqual([]);
		view.un();
	});

	it('wheel posts the scaled mouseWheel with delta and prevents page scroll', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		const glass = view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
		vi.spyOn(glass, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
		const evt = new WheelEvent('wheel', { deltaX: 3, deltaY: -30, cancelable: true });
		// jsdom's WheelEvent init ignores clientX/clientY — set them on the instance
		Object.defineProperty(evt, 'clientX', { value: 100 });
		Object.defineProperty(evt, 'clientY', { value: 50 });
		canvas.dispatchEvent(evt);
		await settle();
		expect(evt.defaultPrevented).toBe(true);
		expect(env.inputBodies).toEqual([{ kind: 'mouse', type: 'mouseWheel', x: 400, y: 200, deltaX: 3, deltaY: -30 }]);
		view.un();
	});

	it('printable keyDowns carry text; keyUp and non-printables do not', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
		canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
		canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
		await settle();
		expect(env.inputBodies).toEqual([
			{ kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'a' },
			{ kind: 'key', type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: undefined },
			{ kind: 'key', type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: undefined }
		]);
		view.un();
	});

	it('moves coalesce to one mouseMoved per animation frame — the LAST move wins', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		const glass = view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
		vi.spyOn(glass, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
		expect(rafCbs).toHaveLength(0);
		canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 20, clientY: 10, bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 30, bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 50, bubbles: true }));
		expect(rafCbs).toHaveLength(1); // exactly ONE frame scheduled for the flood
		expect(env.inputBodies).toEqual([]);
		rafCbs[0]();
		await settle();
		// 100 displayed px ÷ scale 0.25 → 400 viewport px
		expect(env.inputBodies).toEqual([{ kind: 'mouse', type: 'mouseMoved', x: 400, y: 200 }]);
		view.un();
	});

	it('a 409 from the input route closes the stream and marks the panel closed', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		env.inputStatus = 409;
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		const glass = view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
		vi.spyOn(glass, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
		canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 5, clientY: 5, bubbles: true }));
		await settle();
		expect(StubEventSource.instances[0].closed).toBe(true);
		expect(statusOf(view.target)).toBe('closed');
		view.un();
	});
});

describe('BrowserPanel — owner release (D8)', () => {
	it('panel-close POSTs /close exactly once, closes the stream, reports onclose', async () => {
		let closed = 0;
		const view = mountPanel({ browserSessionId: 'warm-abc12345', onclose: () => (closed += 1) });
		await settle();
		await goLive(view);
		const btn = view.target.querySelector('[data-testid="panel-close"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(false);
		btn.click();
		btn.click(); // the closing guard eats the double invocation
		await settle();
		expect(env.closeCalls).toEqual(['/api/browser/warm-abc12345/close']);
		expect(StubEventSource.instances[0].closed).toBe(true);
		expect(statusOf(view.target)).toBe('closed');
		expect(closed).toBe(1);
		view.un();
		// unmount after an owner-release does NOT post /close again
		expect(env.closeCalls).toHaveLength(1);
	});

	it('unmount DETACHES ONLY: no /close POST — the session survives the page (ADR-0030 D1)', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		view.un();
		await settle();
		expect(env.closeCalls).toEqual([]);
	});

	it('a close network blip still reports upward — the registry close is the authority', async () => {
		let closed = 0;
		const view = mountPanel({ browserSessionId: 'warm-abc12345', onclose: () => (closed += 1) });
		await settle();
		fetchMock.mockImplementationOnce(async () => {
			throw new TypeError('network down');
		});
		(view.target.querySelector('[data-testid="panel-close"]') as HTMLButtonElement).click();
		await settle();
		expect(statusOf(view.target)).toBe('closed');
		expect(closed).toBe(1);
		view.un();
	});

	it('a panel that never got a session closes nothing — close-click is a no-op and unmount posts nothing', async () => {
		env.openOk = false;
		const view = mountPanel();
		await settle();
		(view.target.querySelector('[data-testid="panel-close"]') as HTMLButtonElement).click();
		await settle();
		expect(statusOf(view.target)).toBe('failed'); // unchanged, no session to close
		view.un();
		await settle();
		expect(env.closeCalls).toEqual([]);
	});
});

describe('BrowserPanel — sticky glass (The Sticky Glass, ADR-0030)', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('remount with a persisted live id RE-BINDS: GET list only, no POST open, data-rebound=true', async () => {
		localStorage.setItem('dsi.browser.sessionId', 'persisted-id-1');
		// first the list must answer live — the default fetchMock 404s GET, so
		// layer a GET-aware implementation over it
		const base = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (...args: Parameters<typeof fetch>) => {
			const url = String(args[0]);
			const init = (args[1] ?? {}) as RequestInit;
			if (url.endsWith('/api/browser') && (init.method ?? 'GET') === 'GET') {
				return new Response(JSON.stringify({ sessions: [{ id: 'persisted-id-1' }] }), { status: 200 });
			}
			return base(...args);
		});
		const view = mountPanel();
		await settle();
		const opened = fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/browser') && (c[1] as RequestInit)?.method === 'POST');
		expect(opened).toBe(false); // re-bind, not a twin open
		const strip = view.target.querySelector('[data-testid="browser-status"]');
		expect(strip?.getAttribute('data-rebound')).toBe('true');
		view.un();
	});

	it('a cold open persists the resolved id so the NEXT reload re-binds', async () => {
		const view = mountPanel();
		await settle();
		expect(localStorage.getItem('dsi.browser.sessionId')).toBe(SESSION_ID);
		view.un();
	});

	it('hard-reload shape: unmount after a cold open posts NO close — the session survives', async () => {
		const view = mountPanel();
		await settle();
		view.un();
		await settle();
		expect(env.closeCalls).toEqual([]);
		// and the persisted id is still there for the remount
		expect(localStorage.getItem('dsi.browser.sessionId')).toBe(SESSION_ID);
	});

	it('panel-close still posts /close exactly once (D8 untouched)', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		(view.target.querySelector('[data-testid="panel-close"]') as HTMLButtonElement).click();
		await settle();
		expect(env.closeCalls).toEqual(['/api/browser/warm-abc12345/close']);
		view.un();
		// and the owner-release clears the persisted id? No — D8 closes the
		// session; the stale id falls through on the next mount (resolver D4)
		await settle();
	});
});

/*
 * Coverage addendum — the guard branches the earlier suite never took:
 * post() with no session, post() fetch rejection, the letterbox-bar null
 * (no phantom clicks/wheel/moves off-page), the draw() null-canvas guard
 * (frame lands after unmount), the /page 200 WITHOUT a dpr field (dpr
 * stays 1), and the mount catch (resolver throw).
 */
describe('BrowserPanel — guard branches (coverage addendum)', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('input dispatched before a session exists is a no-op — the post() guard', async () => {
		// cold mount: the resolver fetch is in flight, sessionId is still null,
		// but the canvas already exists (status 'opening'). A keydown posts
		// unconditionally, so it exercises the !sessionId early return.
		const view = mountPanel();
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		expect(canvas).not.toBeNull();
		canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }));
		await settle();
		expect(env.inputBodies).toEqual([]);
		expect(statusOf(view.target)).toBe('connecting');
		view.un();
	});

	it('a rejected /input fetch is swallowed — post() never throws', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		fetchMock.mockImplementationOnce(async () => {
			throw new TypeError('input route down');
		});
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		expect(() =>
			canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, bubbles: true }))
		).not.toThrow();
		await settle();
		expect(env.inputBodies).toEqual([]); // the request never landed
		expect(statusOf(view.target)).toBe('live'); // liveness untouched
		view.un();
	});

	it('letterbox-bar clicks, moves and wheel map to null — nothing posts, no scroll lock', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view); // warm: dpr=1 → viewport {800,400}
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		const glass = view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
		// 200×150 wrapper around a 2:1 image → contained rect 200×100, 25px bars
		vi.spyOn(glass, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 150 } as DOMRect);
		const wheel = new WheelEvent('wheel', { deltaX: 1, deltaY: -5, cancelable: true });
		Object.defineProperty(wheel, 'clientX', { value: 100 });
		Object.defineProperty(wheel, 'clientY', { value: 10 }); // top bar
		expect(rafCbs).toHaveLength(0);
		canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 140, bubbles: true })); // bottom bar
		canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 10, bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 100, clientY: 140, bubbles: true }));
		canvas.dispatchEvent(wheel);
		await settle();
		expect(env.inputBodies).toEqual([]); // no phantom dispatches off-page
		expect(rafCbs).toHaveLength(0); // bar moves never schedule a frame
		expect(wheel.defaultPrevented).toBe(false); // the guard returns BEFORE preventDefault
		view.un();
	});

	it('a frame whose Image onload lands after unmount finds no canvas — the draw() guard', async () => {
		const view = mountPanel({ browserSessionId: 'warm-abc12345' });
		await settle();
		await goLive(view);
		// fire a SECOND frame but tear down before its Image onload macrotask runs
		const b64 = Buffer.from('late-jpeg').toString('base64');
		StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
		view.un();
		await settle(); // onload fires against a nulled canvas binding
	});

	it('a /page 200 without a dpr field leaves dpr at 1 — the ?? default', async () => {
		const base = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (...args: Parameters<typeof fetch>) => {
			const url = String(args[0]);
			if (url.endsWith('/page')) return new Response(JSON.stringify({}), { status: 200 });
			return base(...args);
		});
		const view = mountPanel();
		await settle();
		await goLive(view);
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		expect(canvas.width).toBe(800);
		// dpr stayed 1 → viewport {800,400}; scale 200/800 = 0.25
		vi.spyOn(view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
		canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 100, clientY: 50, bubbles: true }));
		await settle();
		expect(env.inputBodies).toEqual([{ kind: 'mouse', type: 'mouseReleased', x: 400, y: 200, button: 'left', clickCount: 1 }]);
		view.un();
	});

	it('a mount-chain fetch failure is caught — failed with the reason, no stream', async () => {
		// the resolver swallows its own blips and falls back to a fresh open;
		// the /page fetch sits INSIDE the panel's try — its throw is the
		// observable path into the onMount catch
		// 1st fetch = the resolver's POST open (answered by the base), 2nd =
		// the panel's /page read, which throws into the onMount catch
		fetchMock.mockImplementationOnce(async (...args: Parameters<typeof fetch>) => {
			const base = fetchMock.getMockImplementation()!;
			return base(...args);
		});
		fetchMock.mockImplementationOnce(async () => {
			throw new TypeError('page route down');
		});
		const view = mountPanel();
		await settle();
		expect(statusOf(view.target)).toBe('failed');
		const failed = view.target.querySelector('[data-testid="browser-failed"]');
		expect(failed?.textContent).toContain('page route down');
		expect(StubEventSource.instances).toHaveLength(0); // the stream never attached
		view.un();
	});
});
