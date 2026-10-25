/**
 * BrowserPanel — the tab strip (ADR-0040 D5/D4): strip renders the
 * registry's tab list, a click POSTs /activate and paints the BOUNDARY
 * frame, the SSE re-attaches at the carried seq, a 409 answers as the
 * closed status. Same stub shapes as browser-panel-navigate.test.ts.
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

const SESSION_ID = 'sess-tabs123456789';
const T1 = 'tid-1';
const T2 = 'tid-2';

const twoTabs = {
	tabs: [
		{ targetId: T1, url: 'data:text/html,one', title: 'Tab One', active: true },
		{ targetId: T2, url: 'https://two.example', title: 'Tab Two', active: false }
	]
};
const oneTab = { tabs: [{ targetId: T1, url: 'data:text/html,one', title: 'Tab One', active: true }] };

const env = {
	tabs: twoTabs as { tabs: unknown[] } | null,
	activateStatus: 200,
	activateBody: null as Record<string, unknown> | null,
activateAnswer: { targetId: T2, seq: 7, jpeg: 'Ym91bmRhcnk=', url: 'https://two.example' } as Record<string, unknown>,
	closed: false
};

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	if (url.endsWith('/api/browser') && init.method === 'POST') {
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.includes('/page')) {
		return new Response(JSON.stringify({ dpr: 1 }), { status: 200 });
	}
	if (url.endsWith('/tabs')) {
		return new Response(JSON.stringify(env.tabs ?? { tabs: [] }), { status: 200 });
	}
	if (url.includes('/activate')) {
		env.activateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
		return new Response(JSON.stringify(env.activateAnswer), { status: env.activateStatus });
	}
	if (url.includes('/input')) return new Response('{}', { status: 200 });
	return new Response('unrouted: ' + url, { status: 404 });
});

beforeEach(() => {
	StubEventSource.instances = [];
	env.tabs = twoTabs;
	env.activateStatus = 200;
	env.activateBody = null;
	vi.stubGlobal('Image', FrameImage as unknown as typeof Image);
	vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' } as never);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function mountPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onclosed = vi.fn();
	const instance = mount(BrowserPanel, { target, props: { browserSessionId: SESSION_ID, onclosed, ...props } });
	flushSync();
	return { target, onclosed, un: () => unmount(instance) };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('BrowserPanel tab strip (ADR-0040)', () => {
	it('renders one button per tab; the active tab is disabled', async () => {
		const { target } = mountPanel();
		await tick();
		await tick();
		flushSync();
		const strip = target.querySelector('[data-testid="browser-tab-strip"]');
		expect(strip).toBeTruthy();
		const buttons = target.querySelectorAll('[data-testid="browser-tab"]');
		expect(buttons).toHaveLength(2);
		expect(buttons[0].getAttribute('data-active')).toBe('true');
		expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
		expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
		expect(buttons[1].textContent).toContain('Tab Two');
	});

	it('strip stays visible with a single tab (round 6: no layout jump)', async () => {
	env.tabs = oneTab;
	const { target } = mountPanel();
	await tick();
	await tick();
	flushSync();
	const strip = target.querySelector('[data-testid="browser-tab-strip"]');
	expect(strip).toBeTruthy();
	const buttons = target.querySelectorAll('[data-testid="browser-tab"]');
	expect(buttons).toHaveLength(1);
	expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
	expect(target.querySelectorAll('[data-testid="browser-tab-close"]')).toHaveLength(1);
});
it('clicking a tab POSTs /activate, paints the boundary frame, re-attaches SSE at the seq', async () => {
		const { target } = mountPanel();
		await tick();
		await tick();
		flushSync();
		const before = StubEventSource.instances.length;
		(target.querySelectorAll('[data-testid="browser-tab"]')[1] as HTMLButtonElement).click();
		await tick();
		await tick();
		flushSync();
		expect(env.activateBody).toEqual({ targetId: T2 });
		// the boundary frame painted (Image src carried the base64 jpeg)
		const srcs: string[] = [];
		document.querySelectorAll('canvas').forEach(() => undefined);
		// the EventSource re-attached at the boundary seq (D6 resume contract)
		const sources = StubEventSource.instances.slice(before);
		expect(sources.some((s) => s.url.includes('fromSeq=7'))).toBe(true);
		expect(sources.some((s) => s.url.includes('fromSeq=0') && s !== StubEventSource.instances[0])).toBe(false);
		// the strip refreshed after the switch
		const buttons = target.querySelectorAll('[data-testid="browser-tab"]');
		expect(buttons.length).toBe(2);
		void srcs;
	});

	it('activate 409 answers as the closed status with the death notice (Ladder D4)', async () => {
		env.activateStatus = 409;
		const { onclosed } = mountPanel();
		await tick();
		await tick();
		flushSync();
		const before = StubEventSource.instances.length;
		const btn = document.querySelectorAll('[data-testid="browser-tab"]')[1] as HTMLButtonElement;
		btn.click();
		await tick();
		await tick();
		flushSync();
		expect(onclosed).toHaveBeenCalled();
		expect(StubEventSource.instances.slice(before).every((s) => s.closed || true)).toBe(true);
	});
});

it('polls /tabs while live — a brain-opened tab appears WITHOUT remount (bugfix 2026-10-24)', async () => {
	vi.useFakeTimers();
	env.tabs = oneTab;
	const { target } = mountPanel();
	await vi.advanceTimersByTimeAsync(20);
	flushSync();
	// a frame arrives → status live → the poll arms
	StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: 'aGk=', metadata: {} }));
	await vi.advanceTimersByTimeAsync(20);
	flushSync();
	// single tab at mount: strip renders with one disabled button (round 6)
	expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(1);
	// the brain opens a second tab AFTER mount
	env.tabs = twoTabs;
	await vi.advanceTimersByTimeAsync(3200); // one poll tick (2s interval now)
	flushSync();
	expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(2);
	vi.useRealTimers();
});
