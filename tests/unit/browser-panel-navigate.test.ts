/**
 * BrowserPanel — proxy controls + wrap-null guard (ADR-0031 D1/D2,
 * branch-coverage addendum for feat/glass-header-proxy-controls).
 *
 * Pins:
 * - toViewportCx's !wrap early return: mouse events dispatched BEFORE the
 *   bind:this effects land (wrap still null) map to null — nothing posts,
 *   no rAF is scheduled, and scalePoint is never reached (proven via a
 *   module-mock spy around the real scalePoint).
 * - toTarget through the REAL address bar (BrowserHeader input + Enter):
 *   https?:// passthrough, search-phrase encoding, data:text/html
 *   passthrough — asserted on the navigate POST body.
 * - proxy()'s guards and outcomes: !sessionId, the in-flight proxyBusy
 *   single-POST guard, the ok path (history bounds + clearInput), the
 *   404 close, and the swallowed network blip.
 *
 * fetch and EventSource are stubbed with the same shapes as
 * tests/unit/components/panels/browser-panel.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';
// The spy wraps the REAL scalePoint — toViewportCx reaches it only when
// wrap is bound, so "scalePoint never called" proves the !wrap early return.
import { scalePoint } from '$lib/components/browser/mirror-input.ts';

vi.mock('$lib/components/browser/mirror-input.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/components/browser/mirror-input.ts')>();
	return { ...actual, scalePoint: vi.fn(actual.scalePoint) };
});

const scalePointSpy = vi.mocked(scalePoint);

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

interface Env {
	inputBodies: Record<string, unknown>[];
	navBodies: Record<string, unknown>[];
	navStatus: number;
	navThrow: boolean;
}
const env: Env = { inputBodies: [], navBodies: [], navStatus: 200, navThrow: false };

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	if (url.endsWith('/api/browser') && init.method === 'POST') {
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.endsWith('/page')) {
		return new Response(JSON.stringify({ dpr: 1 }), { status: 200 });
	}
	if (url.includes('/navigate')) {
		if (env.navThrow) throw new TypeError('navigate route down');
		env.navBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
		return new Response(JSON.stringify({ currentIndex: 1, entryCount: 3 }), { status: env.navStatus });
	}
	if (url.includes('/input')) {
		env.inputBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
		return new Response('{}', { status: 200 });
	}
	return new Response('unrouted: ' + url, { status: 404 });
});

let rafCbs: Array<() => void>;
beforeEach(() => {
	StubEventSource.instances = [];
	env.inputBodies = [];
	env.navBodies = [];
	env.navStatus = 200;
	env.navThrow = false;
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

function mountPanel(props: { browserSessionId?: string } = {}) {
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

/** Fire a frame and await its draw; the panel must be live afterwards. */
async function goLive(view: { target: HTMLElement }): Promise<void> {
	const source = StubEventSource.instances[0];
	const b64 = Buffer.from('fakejpeg').toString('base64');
	source.emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
	await settle();
	expect(statusOf(view.target)).toBe('live');
}

/** Type into the address bar and press Enter — the operator's navigate path. */
function submitInBar(target: HTMLElement, text: string): void {
	const input = target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function navCalls(): string[] {
	return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/navigate')).map((c) => String(c[0]));
}

describe('BrowserPanel — mouse events before wrap exists (toViewportCx !wrap guard)', () => {
	it('mousedown/mousemove/mouseup in the pre-bind tick map to null — no posts, no rAF, scalePoint never reached', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		// The canvas element exists (status 'opening' renders the glass), but
		// the bind:this effects have not landed: wrap is still null. Keydown
		// control proves the delegated handlers are alive in this same tick.
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		expect(canvas).not.toBeNull();
		// Svelte stores delegated handlers under a Symbol on the element and
		// attaches them synchronously at creation — the dispatches below REACH
		// onPointerDown/onPointerUp/onPointerMove in this pre-bind tick.
		expect(Object.getOwnPropertySymbols(canvas).length).toBeGreaterThan(0);
		canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 10, clientY: 10, bubbles: true }));
		canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 10, clientY: 10, bubbles: true }));
		await settle();
		expect(env.inputBodies).toEqual([]); // every pointer event mapped to null
		expect(rafCbs).toHaveLength(0); // a null move never schedules a frame
		// toViewportCx returned BEFORE calling scalePoint: the handlers ran
		// (handler props above), so the only early exit is !wrap. Had wrap
		// been bound, scalePoint would run even against a 0×0 viewport.
		expect(scalePointSpy).not.toHaveBeenCalled();
		view.un();
	});

	it('once wrap is bound the same mousedown DOES reach scalePoint', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		await goLive(view);
		expect(scalePointSpy).not.toHaveBeenCalled(); // nothing yet
		const canvas = view.target.querySelector('canvas') as HTMLCanvasElement;
		const glass = view.target.querySelector('[data-testid="browser-glass"]') as HTMLElement;
		vi.spyOn(glass, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
		canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 50, bubbles: true }));
		await settle();
		expect(scalePointSpy).toHaveBeenCalled(); // wrap bound → the mapper runs
		expect(env.inputBodies[0]).toMatchObject({ type: 'mousePressed', x: 400, y: 200 });
		view.un();
	});
});

describe('BrowserPanel — the address bar speaks: toTarget through proxy()', () => {
	it('an https URL rides verbatim — the passthrough side of the route regex', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		await goLive(view);
		submitInBar(view.target, 'https://example.com/svelte?lang=ts');
		await settle();
		expect(navCalls()).toEqual(['/api/browser/' + SESSION_ID + '/navigate']);
		expect(env.navBodies).toEqual([{ url: 'https://example.com/svelte?lang=ts' }]);
		// the ANSWER cleared the box, and the history bounds came back
		const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		expect(input.value).toBe('');
		expect((view.target.querySelector('[data-testid="browser-back"]') as HTMLButtonElement).disabled).toBe(false);
		expect((view.target.querySelector('[data-testid="browser-forward"]') as HTMLButtonElement).disabled).toBe(false);
		view.un();
	});

	it('a search phrase rides the engine — the encoded fallback operand', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		await goLive(view);
		submitInBar(view.target, 'hello wide world');
		await settle();
		expect(env.navBodies).toEqual([{ url: 'https://www.google.com/search?q=hello%20wide%20world' }]);
		view.un();
	});

	it('a data:text/html URL rides verbatim — the second regex arm', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		await goLive(view);
		submitInBar(view.target, 'data:text/html,<h1>hi</h1>');
		await settle();
		expect(env.navBodies).toEqual([{ url: 'data:text/html,<h1>hi</h1>' }]);
		view.un();
	});

	it('an Enter in the pre-session tick is a guard no-op — proxy never fires', async () => {
		// cold mount: the resolver fetch is in flight, sessionId is still null;
		// the input is rendered (status 'opening') and dispatchEvent ignores
		// the disabled state, so the proxy !sessionId guard is exercised.
		const view = mountPanel();
		submitInBar(view.target, 'https://example.com/early');
		await settle();
		expect(navCalls()).toEqual([]);
		view.un();
	});
});

describe('BrowserPanel — proxy() outcomes', () => {
	it('a second Enter while a navigate is in flight is eaten by the busy guard', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		await goLive(view);
		submitInBar(view.target, 'https://one.test/');
		submitInBar(view.target, 'https://two.test/'); // same tick: proxyBusy still true
		await settle();
		expect(navCalls()).toHaveLength(1);
		expect(env.navBodies).toEqual([{ url: 'https://one.test/' }]);
		view.un();
	});

	it('a 404 navigate marks the panel closed and detaches the stream', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		await goLive(view);
		env.navStatus = 404;
		submitInBar(view.target, 'https://gone.test/');
		await settle();
		expect(statusOf(view.target)).toBe('closed');
		expect(StubEventSource.instances[0].closed).toBe(true);
		view.un();
	});

	it('a navigate network blip is swallowed — status untouched, no crash', async () => {
		const view = mountPanel({ browserSessionId: SESSION_ID });
		await settle();
		await goLive(view);
		env.navThrow = true;
		expect(() => submitInBar(view.target, 'https://blip.test/')).not.toThrow();
		await settle();
		expect(statusOf(view.target)).toBe('live');
		// the box is NOT cleared — only a route ANSWER clears it
		const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		expect(input.value).toBe('https://blip.test/');
		view.un();
	});
});
