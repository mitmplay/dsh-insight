/**
 * BrowserPanel proxy() branch cover (ADR-0031 D1/D2) — Slice C.
 * Pins: the no-session guard, the proxyBusy single-flight guard, the
 * history-bounds matrix from the navigate answer (currentIndex /
 * entryCount → canBack / canForward), the header clearInput() answer,
 * and the dead-session shapes (404 / 409 → status closed + SSE detach).
 * fetch and EventSource are stubbed exactly as in
 * tests/unit/components/panels/browser-panel.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte';
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

const SESSION_ID = 'sess-proxy0001';

/** /navigate answer controls — each test shapes its own answer. */
const nav: { status: number; body: string; gate: (() => Promise<void>) | null; calls: string[]; bodies: unknown[] } = {
	status: 200,
	body: JSON.stringify({ currentIndex: 0, entryCount: 1 }),
	gate: null,
	calls: [],
	bodies: []
};

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	if (url.includes('/navigate')) {
		nav.calls.push(url);
		nav.bodies.push(JSON.parse(String(init.body)) as unknown);
		if (nav.gate) await nav.gate();
		return new Response(nav.body, { status: nav.status });
	}
	if (url.endsWith('/api/browser') && init.method === 'POST') {
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.endsWith('/page')) {
		return new Response(JSON.stringify({ dpr: 1 }), { status: 200 });
	}
	return new Response('{}', { status: 200 });
});

beforeEach(() => {
	StubEventSource.instances = [];
	nav.status = 200;
	nav.body = JSON.stringify({ currentIndex: 0, entryCount: 1 });
	nav.gate = null;
	nav.calls = [];
	nav.bodies = [];
	vi.stubGlobal('Image', FrameImage as unknown as typeof Image);
	vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
	fetchMock.mockClear();
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1) as unknown as typeof requestAnimationFrame);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function mountPanel(props: { browserSessionId?: string; onclose?: () => void } = {}) {
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

/** Warm-mount, fire a frame so the panel is live (input + reload enabled). */
async function goLive(): Promise<ReturnType<typeof mountPanel>> {
	const view = mountPanel({ browserSessionId: SESSION_ID });
	await settle();
	const b64 = Buffer.from('fakejpeg').toString('base64');
	StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
	await settle();
	expect(statusOf(view.target)).toBe('live');
	return view;
}

function backBtn(target: HTMLElement): HTMLButtonElement {
	return target.querySelector('[data-testid="browser-back"]') as HTMLButtonElement;
}
function fwdBtn(target: HTMLElement): HTMLButtonElement {
	return target.querySelector('[data-testid="browser-forward"]') as HTMLButtonElement;
}
/** Reload is the always-enabled-when-live verb — the reliable trigger. */
function reloadBtn(target: HTMLElement): HTMLButtonElement {
	return target.querySelector('[data-testid="browser-reload"]') as HTMLButtonElement;
}

describe('BrowserPanel proxy() — guards (ADR-0031 D1)', () => {
	it('no session yet: the proxy verb is a no-op (no navigate POST)', async () => {
		const view = mountPanel(); // cold shape — sessionId still unbound
		// fire the verb BEFORE the mount chain resolves the session
		backBtn(view.target).click();
		fwdBtn(view.target).click();
		await settle();
		expect(nav.calls).toHaveLength(0);
		view.un();
	});

	it('proxyBusy: a second verb during the in-flight POST is swallowed', async () => {
		let release!: () => void;
		nav.gate = () => new Promise<void>((r) => (release = r));
		const view = await goLive();

		const fire = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		fire(reloadBtn(view.target));
		fire(reloadBtn(view.target)); // busy — dropped (dispatched past the disabled attr)
		await settle(2);
		expect(nav.calls).toHaveLength(1);

		// while gated, the answer lands: back+forward both open afterwards
		nav.body = JSON.stringify({ currentIndex: 1, entryCount: 3 });
		release();
		await settle(2);
		expect(nav.calls).toHaveLength(1); // still one — the second never fired

		// after the finally clears proxyBusy, the next verb goes through
		nav.gate = null;
		fire(fwdBtn(view.target));
		await settle(2);
		expect(nav.calls).toHaveLength(2);
		expect(nav.bodies[1]).toEqual({ action: 'forward' });
		view.un();
	});
});

describe('BrowserPanel proxy() — history bounds from the navigate answer', () => {
	const cases: Array<{ label: string; idx: number; count: number; back: boolean; forward: boolean }> = [
		{ label: 'single entry: both bounds closed', idx: 0, count: 1, back: false, forward: false },
		{ label: 'middle of history: both bounds open', idx: 2, count: 5, back: true, forward: true },
		{ label: 'first of many: forward only', idx: 0, count: 3, back: false, forward: true },
		{ label: 'last of many: back only', idx: 2, count: 3, back: true, forward: false }
	];
	for (const c of cases) {
		it(c.label, async () => {
			nav.body = JSON.stringify({ currentIndex: c.idx, entryCount: c.count });
			const view = await goLive();
			reloadBtn(view.target).click(); // back/forward start disabled — reload carries the verb
			await settle(2);
			expect(backBtn(view.target).disabled).toBe(!c.back);
			expect(fwdBtn(view.target).disabled).toBe(!c.forward);
			view.un();
		});
	}

	it('missing fields fall back to idx=0 / count=1 — both bounds closed', async () => {
		nav.body = JSON.stringify({});
		const view = await goLive();
		reloadBtn(view.target).click();
		await settle(2);
		expect(backBtn(view.target).disabled).toBe(true);
		expect(fwdBtn(view.target).disabled).toBe(true);
		view.un();
	});

	it('a success answer clears the header input via clearInput()', async () => {
		const view = await goLive();
		const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		input.value = 'example.com';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle(2);
		expect(nav.bodies[0]).toEqual({ url: 'https://www.google.com/search?q=example.com' });
		expect(input.value).toBe('');
		view.un();
	});
});

describe('BrowserPanel proxy() — dead-session answers (ADR-0031 D1)', () => {
	it('404: status flips to closed and the SSE stream detaches', async () => {
		nav.status = 404;
		nav.body = 'gone';
		const view = await goLive();
		const source = StubEventSource.instances[0];
		reloadBtn(view.target).click();
		await settle(2);
		expect(statusOf(view.target)).toBe('closed');
		expect(source.closed).toBe(true);
		view.un();
	});

	it('409: status flips to closed and the SSE stream detaches', async () => {
		nav.status = 409;
		nav.body = 'conflict';
		const view = await goLive();
		const source = StubEventSource.instances[0];
		reloadBtn(view.target).click();
		await settle(2);
		expect(statusOf(view.target)).toBe('closed');
		expect(source.closed).toBe(true);
		view.un();
	});
});
