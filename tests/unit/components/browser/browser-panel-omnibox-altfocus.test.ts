import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

/**
 * BrowserPanel — the arms the earlier suites never drove end-to-end:
 *  - the Alt+N window shortcut (onWindowKey): digit → tab, Alt+0 → last
 *    tab, empty slot / no-alt / non-digit no-ops (glass-tab-ids fix r1);
 *  - the omnibox tab grammar through the REAL header input
 *    (glass open / reuse focus / reuse+url / close / close active /
 *    active echo / invalid reference no-op);
 *  - goHistoryTo: the long-press dropdown pick performs the /history POST;
 *  - the external-activate re-attach arm of refreshTabs (registry-side
 *    active switch re-attaches the SSE at fromSeq=0, D5 amendment);
 *  - the omnibox placeholder arms (isNoUrl: about:blank# / long-URL
 *    truncation at 64).
 * Stub shapes copied from tests/unit/browser-panel-tabs.test.ts.
 */
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

const SESSION_ID = 'sess-omni12345678';
const T1 = 'omni-t1';
const T2 = 'omni-t2';

const twoTabs = {
	tabs: [
		{ targetId: T1, tabId: 1, url: 'data:text/html,one', title: 'One', active: true },
		{ targetId: T2, tabId: 2, url: 'https://two.example', title: 'Two', active: false }
	]
};

const env = {
	tabs: twoTabs as { tabs: unknown[] } | null,
	activateBodies: [] as unknown[],
	activateAnswer: { targetId: T2, seq: 7, jpeg: null as string | null, url: 'https://two.example' } as Record<string, unknown>,
	opentabBodies: [] as unknown[],
	opentabAnswer: { targetId: 'omni-new', seq: 5, jpeg: null } as Record<string, unknown>,
	closetabBodies: [] as unknown[],
	navigateBodies: [] as unknown[],
	navigateAnswer: { currentIndex: 0, entryCount: 1 } as Record<string, unknown>,
	historyGet: { currentIndex: 1, entries: [ { index: 0, url: 'https://a.example', title: 'A' }, { index: 1, url: 'https://b.example', title: 'B' }, { index: 2, url: 'https://c.example', title: 'C' } ] } as Record<string, unknown> | null,
	historyPosts: [] as unknown[]
};

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	const method = init.method ?? 'GET';
	if (url.endsWith('/api/browser') && method === 'POST') {
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.includes('/page')) return new Response(JSON.stringify({ dpr: 1 }), { status: 200 });
	if (url.endsWith('/tabs')) return new Response(JSON.stringify(env.tabs ?? { tabs: [] }), { status: 200 });
	if (url.includes('/activate')) {
		env.activateBodies.push(JSON.parse(String(init.body)) as unknown);
		return new Response(JSON.stringify(env.activateAnswer), { status: 200 });
	}
	if (url.includes('/opentab')) {
		env.opentabBodies.push(JSON.parse(String(init.body)) as unknown);
		return new Response(JSON.stringify(env.opentabAnswer), { status: 200 });
	}
	if (url.includes('/closetab')) {
		env.closetabBodies.push(JSON.parse(String(init.body)) as unknown);
		return new Response('{}', { status: 200 });
	}
	if (url.includes('/navigate')) {
		env.navigateBodies.push(JSON.parse(String(init.body)) as unknown);
		return new Response(JSON.stringify(env.navigateAnswer), { status: 200 });
	}
	if (url.includes('/history') && method === 'GET') {
		if (!env.historyGet) return new Response('gone', { status: 500 });
		return new Response(JSON.stringify(env.historyGet), { status: 200 });
	}
	if (url.includes('/history') && method === 'POST') {
		env.historyPosts.push(JSON.parse(String(init.body)) as unknown);
		return new Response(JSON.stringify({ currentIndex: 2, entryCount: 3 }), { status: 200 });
	}
	if (url.includes('/input')) return new Response('{}', { status: 200 });
	return new Response('unrouted: ' + url, { status: 404 });
});

beforeEach(() => {
	StubEventSource.instances = [];
	env.tabs = twoTabs;
	env.activateBodies = [];
	env.opentabBodies = [];
	env.closetabBodies = [];
	env.navigateBodies = [];
	env.historyPosts = [];
	env.historyGet = { currentIndex: 1, entries: [ { index: 0, url: 'https://a.example', title: 'A' }, { index: 1, url: 'https://b.example', title: 'B' }, { index: 2, url: 'https://c.example', title: 'C' } ] };
	vi.stubGlobal('Image', FrameImage as unknown as typeof Image);
	vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as never);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

function mountPanel() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserPanel, { target, props: { browserSessionId: SESSION_ID } });
	flushSync();
	return { target, un: () => unmount(instance) };
}

async function live(view: ReturnType<typeof mountPanel>) {
	StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: 'aGk=', metadata: {} }));
	await tick();
	await tick();
	flushSync();
	expect(view.target.querySelector('[data-testid="browser-tab-strip"]')).toBeTruthy();
	return view;
}

function submitOmnibox(view: ReturnType<typeof mountPanel>, text: string) {
	const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('BrowserPanel — the Alt+N window shortcut (onWindowKey)', () => {
	it('Alt+2 activates the strip tab at position 2', async () => {
		const view = await live(mountPanel());
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'Digit2' }));
		await tick();
		expect(env.activateBodies).toEqual([{ targetId: T2 }]);
		view.un();
	});

	it('Alt+0 arms the LAST tab', async () => {
		const view = await live(mountPanel());
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'Digit0' }));
		await tick();
		expect(env.activateBodies).toEqual([{ targetId: T2 }]);
		view.un();
	});

	it('an empty slot (Alt+9) and the already-active tab (Alt+1) POST nothing', async () => {
		const view = await live(mountPanel());
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'Digit9' }));
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'Digit1' }));
		await tick();
		expect(env.activateBodies).toEqual([]);
		view.un();
	});

	it('a digit WITHOUT alt and a non-digit code are ignored', async () => {
		const view = await live(mountPanel());
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: false, code: 'Digit2' }));
		window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyA' }));
		await tick();
		expect(env.activateBodies).toEqual([]);
		view.un();
	});
});

describe('BrowserPanel — the omnibox tab grammar through the header input', () => {
	it('"glass <url>" opens a NEW tab with the URL verbatim', async () => {
		const view = await live(mountPanel());
		submitOmnibox(view, 'glass https://open.example/x');
		await tick();
		await tick();
		expect(env.opentabBodies).toEqual([{ url: 'https://open.example/x' }]);
		expect(env.activateBodies).toEqual([]);
		view.un();
	});

	it('"glass <text>" opens a tab that rides the search engine', async () => {
		const view = await live(mountPanel());
		submitOmnibox(view, 'glass svelte 5 runes');
		await tick();
		await tick();
		expect(env.opentabBodies).toEqual([{ url: 'https://www.google.com/search?q=' + encodeURIComponent('svelte 5 runes') }]);
		view.un();
	});

	it('"reuse tab:2" focuses tab 2 (panel-local tabId → targetId)', async () => {
		const view = await live(mountPanel());
		submitOmnibox(view, 'reuse tab:2');
		await tick();
		await tick();
		expect(env.activateBodies).toEqual([{ targetId: T2 }]);
		expect(env.navigateBodies).toEqual([]);
		view.un();
	});

	it('"reuse tab:2 <url>" focuses THEN navigates the now-active tab', async () => {
		const view = await live(mountPanel());
		submitOmnibox(view, 'reuse tab:2 https://nav.example');
		await tick();
		await tick();
		await tick();
		expect(env.activateBodies).toEqual([{ targetId: T2 }]);
		expect(env.navigateBodies).toEqual([{ url: 'https://nav.example' }]); // dotted host rides verbatim
		view.un();
	});

	it('"reuse tab:99" resolves to nothing — no activate, no navigate', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const view = await live(mountPanel());
		submitOmnibox(view, 'reuse tab:99');
		await tick();
		expect(env.activateBodies).toEqual([]);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		view.un();
	});

	it('"close tab:2" closes the resolved tab and resyncs the strip', async () => {
		const view = await live(mountPanel());
		submitOmnibox(view, 'close tab:2');
		await tick();
		await tick();
		expect(env.closetabBodies).toEqual([{ targetId: T2 }]);
		view.un();
	});

	it('"close active" closes the ACTIVE tab', async () => {
		const view = await live(mountPanel());
		submitOmnibox(view, 'close active');
		await tick();
		await tick();
		expect(env.closetabBodies).toEqual([{ targetId: T1 }]);
		view.un();
	});

	it('"close tab:zz" is an error kind — a bad grammar never closes', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const view = await live(mountPanel());
		submitOmnibox(view, 'close tab:zz');
		await tick();
		expect(env.closetabBodies).toEqual([]);
		warn.mockRestore();
		view.un();
	});

	it('"active" echoes tab:N <url> into the box — never navigates', async () => {
		const view = await live(mountPanel());
		submitOmnibox(view, 'active');
		await tick();
		const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		expect(input.value).toBe('tab:1 data:text/html,one');
		expect(env.navigateBodies).toEqual([]);
		expect(env.activateBodies).toEqual([]);
		view.un();
	});
});

describe('BrowserPanel — the long-press history pick (goHistoryTo)', () => {
	it('a held back-button opens the menu; the picked index POSTs /history with the focused target', async () => {
		const view = await live(mountPanel());
		// bounds first: a reload answer arms canBack so the button is live
		env.navigateAnswer = { currentIndex: 1, entryCount: 3 };
		(view.target.querySelector('[data-testid="browser-reload"]') as HTMLButtonElement).click();
		await tick();
		flushSync();
		const back = view.target.querySelector('[data-testid="browser-back"]') as HTMLButtonElement;
		expect(back.disabled).toBe(false);
		back.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 420)); // past the 350ms hold
		await tick();
		flushSync();
		const menu = view.target.querySelector('[data-testid="browser-history-menu"]');
		expect(menu).toBeTruthy();
		// release WITHOUT firing a click (the suppression path) and pick entry 0
		back.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
		const item = view.target.querySelector('[data-testid="browser-history-item"]') as HTMLButtonElement;
		item.click();
		await tick();
		await tick();
		expect(env.historyPosts).toEqual([{ targetId: T1, index: 0 }]); // nearest back entry
		view.un();
	});
});

describe('BrowserPanel — refreshTabs external-activate re-attach (D5 amendment)', () => {
	it('a registry-side active switch arms a fromSeq=0 re-attach on the next poll', async () => {
		vi.useFakeTimers();
		const view = mountPanel();
		await vi.advanceTimersByTimeAsync(20);
		StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: 'aGk=', metadata: {} }));
		await vi.advanceTimersByTimeAsync(20);
		flushSync();
		const before = StubEventSource.instances.length;
		// the BRAIN activated tab 2 registry-side — the panel's own switching
		// guard is not involved; the poll must notice and re-attach
		env.tabs = {
			tabs: [
				{ targetId: T1, tabId: 1, url: 'data:text/html,one', title: 'One', active: false },
				{ targetId: T2, tabId: 2, url: 'https://two.example', title: 'Two', active: true }
			]
		};
		await vi.advanceTimersByTimeAsync(2200); // one poll tick
		flushSync();
		const fresh = StubEventSource.instances.slice(before);
		expect(fresh.length).toBeGreaterThanOrEqual(1);
		expect(fresh.at(-1)!.url).toContain('fromSeq=0');
		vi.useRealTimers();
		view.un();
	});
});

describe('BrowserPanel — the omnibox placeholder arms (isNoUrl)', () => {
	it('an about:blank#blocked active tab keeps the localized fallback placeholder', async () => {
		env.tabs = { tabs: [{ targetId: T1, tabId: 1, url: 'about:blank#blocked', title: 'Blank', active: true }] };
		const view = await live(mountPanel());
		const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		expect(input.placeholder).not.toContain('about:blank');
		expect(input.placeholder.length).toBeGreaterThan(0);
		view.un();
	});

	it('a long active URL truncates the placeholder at 64 chars', async () => {
		const long = 'https://spa.example/' + 'a'.repeat(120);
		env.tabs = { tabs: [{ targetId: T1, tabId: 1, url: long, title: 'SPA', active: true }] };
		const view = await live(mountPanel());
		const input = view.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		expect(input.placeholder).toBe(long.slice(0, 64));
		view.un();
	});
});
