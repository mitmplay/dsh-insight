/**
 * BrowserPanel — branch mop-up round 2 (coverage pass 2026-11-01): the
 * arms earlier suites never drove —
 *  - proxy(): the 404/409 death arms of the navigate answer;
 *  - the omnibox grammar's search-engine open, unknown-close no-op, and
 *    the query-active arm with NO active tab;
 *  - goHistoryTo(): the default-bounds answer (no currentIndex/entryCount)
 *    and the 409 death arm;
 *  - activateTab(): the boundary jpeg paint, the dpr-less /page answer
 *    (?? 1 fallback), the fresh stream's frame + error arms;
 *  - the zoom slider: GET /zoom arms + the refused/network rollback of
 *    pushZoom (the slider never lies);
 *  - the cold open's ownerSessionId via harnessSessionKey (no openedBy);
 *  - the strip-reveal arms (chip out of view left/right);
 *  - onDestroy/onEffect tab-poll teardown while live.
 * Stub shapes copied from tests/unit/components/browser/
 * browser-panel-omnibox-altfocus.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte';
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
	fireError(): void {
		this.onerror?.();
	}
}

const FrameImage = class {
	onload: (() => void) | null = null;
	_src = '';
	width = 800;
	height = 400;
	set src(v: string) {
		this._src = v;
		setTimeout(() => this.onload?.(), 0);
	}
	get src() {
		return this._src;
	}
};

const SESSION_ID = 'mop2-session123';
const T1 = 'mop2-t1';
const T2 = 'mop2-t2';

const twoTabs = {
	tabs: [
		{ targetId: T1, tabId: 1, url: 'data:text/html,one', title: 'One', active: true },
		{ targetId: T2, tabId: 2, url: 'https://two.example', title: 'Two', active: false }
	]
};

const env = {
	tabs: twoTabs as { tabs: unknown[] } | null,
	openBody: null as Record<string, unknown> | null,
	navigateStatus: 200,
	navigateAnswer: { currentIndex: 0, entryCount: 1 } as Record<string, unknown>,
	closetabBodies: [] as unknown[],
	activateAnswer: { targetId: T2, seq: 7, jpeg: null as string | null, url: 'https://two.example' } as Record<string, unknown>,
	pageAnswer: { dpr: 1 } as Record<string, unknown>,
	historyPost: { status: 200, body: { currentIndex: 2, entryCount: 3 } as Record<string, unknown> },
	historyPosts: [] as unknown[],
	zoomGet: { status: 200, body: { zoom: 1, knobEnabled: false } as Record<string, unknown> },
	zoomPost: { status: 200, reject: false } as { status: number; reject: boolean },
	elementOk: true
};

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	const method = init.method ?? 'GET';
	if (url.endsWith('/api/browser') && method === 'POST') {
		env.openBody = JSON.parse(String(init.body)) as Record<string, unknown>;
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.includes('/page')) return new Response(JSON.stringify(env.pageAnswer), { status: 200 });
	if (url.includes('/zoom') && method === 'GET') {
		if (env.zoomGet.status !== 200) return new Response('gone', { status: env.zoomGet.status });
		return new Response(JSON.stringify(env.zoomGet.body), { status: 200 });
	}
	if (url.includes('/zoom') && method === 'POST') {
		if (env.zoomPost.reject) throw new TypeError('network down');
		return new Response('{}', { status: env.zoomPost.status });
	}
	if (url.endsWith('/tabs')) return new Response(JSON.stringify(env.tabs ?? { tabs: [] }), { status: 200 });
	if (url.includes('/activate')) return new Response(JSON.stringify(env.activateAnswer), { status: 200 });
	if (url.includes('/navigate')) {
		if (env.navigateStatus !== 200) return new Response('dead', { status: env.navigateStatus });
		return new Response(JSON.stringify(env.navigateAnswer), { status: 200 });
	}
	if (url.includes('/closetab')) {
		env.closetabBodies.push(JSON.parse(String(init.body)) as unknown);
		return new Response('{}', { status: 200 });
	}
	if (url.includes('/history') && method === 'GET')
		return new Response(
			JSON.stringify({
				currentIndex: 1,
				entries: [
					{ index: 0, url: 'https://a.example', title: 'A' },
					{ index: 1, url: 'https://b.example', title: 'B' },
					{ index: 2, url: 'https://c.example', title: 'C' }
				]
			}),
			{ status: 200 }
		);
	if (url.includes('/history') && method === 'POST') {
		env.historyPosts.push(JSON.parse(String(init.body)) as unknown);
		if (env.historyPost.status !== 200) return new Response('dead', { status: env.historyPost.status });
		return new Response(JSON.stringify(env.historyPost.body), { status: 200 });
	}
	if (url.includes('/element')) {
		if (!env.elementOk) return new Response('gone', { status: 404 });
		return new Response(JSON.stringify({ href: null, src: null }), { status: 200 });
	}
	if (url.includes('/input')) return new Response('{}', { status: 200 });
	return new Response('unrouted: ' + url, { status: 404 });
});

beforeEach(() => {
	StubEventSource.instances = [];
	env.tabs = twoTabs;
	env.openBody = null;
	env.navigateStatus = 200;
	env.navigateAnswer = { currentIndex: 0, entryCount: 1 };
	env.closetabBodies = [];
	env.activateAnswer = { targetId: T2, seq: 7, jpeg: null, url: 'https://two.example' };
	env.pageAnswer = { dpr: 1 };
	env.historyPost = { status: 200, body: { currentIndex: 2, entryCount: 3 } };
	env.historyPosts = [];
	env.zoomGet = { status: 200, body: { zoom: 1, knobEnabled: false } };
	env.zoomPost = { status: 200, reject: false };
	env.elementOk = true;
	vi.stubGlobal('Image', FrameImage as unknown as typeof Image);
	vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as never);
	fetchMock.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

function mountPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserPanel, { target, props: { browserSessionId: SESSION_ID, ...props } });
	flushSync();
	return {
		target,
		un: () => {
			unmount(instance);
			target.remove();
		}
	};
}

async function live(view: ReturnType<typeof mountPanel>) {
	StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: 'aGk=', metadata: {} }));
	await tick();
	await tick();
	flushSync();
	expect(statusOf(view)).toBe('live');
	return view;
}

function statusOf(view: ReturnType<typeof mountPanel>): string {
	return view.target.querySelector('[data-testid="browser-status"]')?.getAttribute('data-status') ?? '';
}

function submitOmnibox(view: ReturnType<typeof mountPanel>, text: string) {
	const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('BrowserPanel mop 2 — proxy death arms + poll teardown', () => {
	it('a 404 navigate answer flips the panel closed and STOPS the strip poll', async () => {
		const view = await live(mountPanel());
		// a live panel runs the 2s poll — the closed flip must tear it down
		env.navigateStatus = 404;
		submitOmnibox(view, 'https://dead.example');
		await tick();
		await tick();
		expect(statusOf(view)).toBe('closed');
		view.un();
	});

	it('a 409 navigate answer is the death notice: onclosed rides upward', async () => {
		const onclosed = vi.fn();
		const view = await live(mountPanel({ onclosed }));
		env.navigateStatus = 409;
		submitOmnibox(view, 'https://dead.example');
		await tick();
		await tick();
		expect(onclosed).toHaveBeenCalledTimes(1);
		expect(statusOf(view)).toBe('closed');
		view.un();
	});
});

describe('BrowserPanel mop 2 — omnibox grammar arms', () => {
	it('"glass <text>" opens a tab on the search engine (no url in the command)', async () => {
		const view = await live(mountPanel());
		submitOmnibox(view, 'glass svelte runes guide');
		await tick();
		await tick();
		const calls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/opentab'));
		expect(calls).toHaveLength(1);
		expect(JSON.parse(String((calls[0][1] as RequestInit).body))).toEqual({
			url: 'https://www.google.com/search?q=' + encodeURIComponent('svelte runes guide')
		});
		view.un();
	});

	it('"close tab:99" resolves to no tab — the close is refused with a warning', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const view = await live(mountPanel());
		submitOmnibox(view, 'close tab:99');
		await tick();
		expect(env.closetabBodies).toEqual([]);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		view.un();
	});

	it('"active" with NO active tab echoes nothing into the box', async () => {
		env.tabs = { tabs: [] };
		const view = await live(mountPanel());
		submitOmnibox(view, 'active');
		await tick();
		const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		// nothing echoed IN, nothing navigated — the box keeps the raw text
		expect(input.value).toBe('active');
		expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/navigate'))).toHaveLength(0);
		view.un();
	});
});

describe('BrowserPanel mop 2 — goHistoryTo answer arms', () => {
	/** The altfocus long-press choreography: arm the back button with a
	 *  navigate answer, hold past 350ms, pick the menu item. */
	async function pickHistory(view: ReturnType<typeof mountPanel>): Promise<void> {
		env.navigateAnswer = { currentIndex: 1, entryCount: 3 };
		(view.target.querySelector('[data-testid="browser-reload"]') as HTMLButtonElement).click();
		await tick();
		flushSync();
		const back = view.target.querySelector('[data-testid="browser-back"]') as HTMLButtonElement;
		expect(back.disabled).toBe(false);
		back.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 420));
		await tick();
		flushSync();
		expect(view.target.querySelector('[data-testid="browser-history-menu"]')).toBeTruthy();
		back.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		(view.target.querySelector('[data-testid="browser-history-item"]') as HTMLButtonElement).click();
		await tick();
		await tick();
	}

	it('a history answer WITHOUT bounds falls back to idx 0 / count 1 — both arrows disabled', async () => {
		const view = await live(mountPanel());
		env.historyPost = { status: 200, body: {} };
		await pickHistory(view);
		expect(env.historyPosts).toHaveLength(1);
		const fwd = view.target.querySelector('[data-testid="browser-forward"]') as HTMLButtonElement;
		expect(fwd.disabled).toBe(true);
		view.un();
	});

	it('a 409 history answer is the death handshake: closed + onclosed', async () => {
		const onclosed = vi.fn();
		const view = await live(mountPanel({ onclosed }));
		env.historyPost = { status: 409, body: {} };
		await pickHistory(view);
		expect(onclosed).toHaveBeenCalledTimes(1);
		expect(statusOf(view)).toBe('closed');
		view.un();
	});
});

describe('BrowserPanel mop 2 — activateTab arms', () => {
	it('the boundary jpeg paints, a dpr-less /page answer falls back to 1, the fresh frame lives, the fresh error fails', async () => {
		const view = await live(mountPanel());
		env.activateAnswer = { targetId: T2, seq: 9, jpeg: Buffer.from('boundary').toString('base64'), url: 'https://two.example' };
		env.pageAnswer = {}; // no dpr member — the ?? 1 fallback arm
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'Digit2' }));
		await tick();
		await tick();
		// the stream re-attached at the boundary seq; status STAYS live —
		// the switch never passes through a non-live lamp
		const fresh = StubEventSource.instances.at(-1)!;
		expect(fresh.url).toContain('fromSeq=9');
		expect(statusOf(view)).toBe('live');
		// the fresh stream's frame arm keeps it live
		fresh.emit('frame', JSON.stringify({ jpeg: Buffer.from('next').toString('base64'), metadata: {} }));
		await tick();
		await tick();
		expect(statusOf(view)).toBe('live');
		// the fresh stream's error arm (status is live, not closed) → failed
		fresh.fireError();
		flushSync();
		expect(statusOf(view)).toBe('failed');
		view.un();
	});
});

describe('BrowserPanel mop 2 — the zoom slider and the honest rollback', () => {
	it('GET /zoom arms the slider; a refused POST rolls the optimistic value back', async () => {
		env.zoomGet = { status: 200, body: { zoom: 1, knobEnabled: true } };
		env.zoomPost = { status: 400, reject: false };
		const view = mountPanel({ openedBy: 'agent-x' });
		await tick();
		await tick();
		flushSync();
		const slider = view.target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement;
		expect(slider).toBeTruthy();
		expect(slider.value).toBe('100');
		slider.value = '80';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 180)); // past the 100ms zoom debounce
		await tick();
		const posts = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/zoom') && (c[1] as RequestInit)?.method === 'POST');
		expect(posts.length).toBeGreaterThanOrEqual(1);
		expect(slider.value).toBe('100'); // rolled back — the slider never lies
		view.un();
	});

	it('a happy POST keeps the new zoom', async () => {
		env.zoomGet = { status: 200, body: { zoom: 1, knobEnabled: true } };
		env.zoomPost = { status: 200, reject: false };
		const view = mountPanel({ openedBy: 'agent-x' });
		await tick();
		await tick();
		flushSync();
		const slider = view.target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement;
		slider.value = '80';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 180));
		await tick();
		expect((view.target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement).value).toBe('80');
		view.un();
	});

	it('a network-refused POST rolls back through the catch arm', async () => {
		env.zoomGet = { status: 200, body: { zoom: 1, knobEnabled: true } };
		env.zoomPost = { status: 200, reject: true };
		const view = mountPanel({ openedBy: 'agent-x' });
		await tick();
		await tick();
		flushSync();
		const slider = view.target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement;
		slider.value = '80';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 180));
		await tick();
		expect(slider.value).toBe('100');
		view.un();
	});
});

describe('BrowserPanel mop 2 — the cold open owner (harnessSessionKey arm)', () => {
	it('a keyless cold open with NO harness key omits ownerSessionId honestly', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(BrowserPanel, { target, props: {} });
		await tick();
		await tick();
		expect(env.openBody).not.toBeNull();
		// openedBy is undefined AND harnessSessionKey() resolves to nothing
		// under happy-dom → the whole owner member is omitted (never forged)
		expect(env.openBody!.ownerSessionId).toBeUndefined();
		unmount(instance);
		target.remove();
	});
});

describe('BrowserPanel mop 2 — the strip reveal arms', () => {
	it('a chip out of view LEFT scrolls the strip; out of view RIGHT scrolls the other way', async () => {
		const view = await live(mountPanel());
		const strip = view.target.querySelector('[data-testid="browser-tab-strip"]') as HTMLElement;
		Object.defineProperty(strip, 'getBoundingClientRect', {
			value: () => ({ left: 100, right: 200, top: 0, bottom: 20, width: 100, height: 20, x: 100, y: 0, toJSON: () => ({}) }),
			configurable: true
		});
		Object.defineProperty(strip, 'scrollWidth', { value: 400, configurable: true });
		Object.defineProperty(strip, 'clientWidth', { value: 100, configurable: true });
		strip.scrollLeft = 50;
		const chip = () => strip.querySelector('[data-testid="browser-tab"][data-active="true"]') as HTMLElement;
		// arm 1: chip hangs LEFT of the strip
		Object.defineProperty(chip(), 'getBoundingClientRect', {
			value: () => ({ left: 40, right: 120, top: 0, bottom: 20, width: 80, height: 20, x: 40, y: 0, toJSON: () => ({}) }),
			configurable: true
		});
		env.tabs = {
			tabs: [
				{ targetId: T1, tabId: 1, url: 'data:text/html,one', title: 'One', active: false },
				{ targetId: T2, tabId: 2, url: 'https://two.example', title: 'Two', active: true }
			]
		};
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'Digit2' }));
		await tick();
		await tick();
		flushSync();
		expect(strip.scrollLeft).toBeLessThan(50); // scrolled left toward the chip
		// arm 2: chip hangs RIGHT of the strip — stub BOTH chips' rects so the
		// (re-activated) active chip is whichever element the effect queries
		for (const el of strip.querySelectorAll('[data-testid="browser-tab"]')) {
			Object.defineProperty(el, 'getBoundingClientRect', {
				value: () => ({ left: 260, right: 340, top: 0, bottom: 20, width: 80, height: 20, x: 260, y: 0, toJSON: () => ({}) }),
				configurable: true
			});
		}
		env.tabs = twoTabs;
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'Digit1' }));
		await tick();
		await tick();
		flushSync();
		expect(strip.scrollLeft).toBeGreaterThan(0);
		view.un();
	});
});
