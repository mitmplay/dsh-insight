/**
 * BrowserPanel — the Ghost Glass death-arm (RCA 2026-10-31, Bug 2).
 * A 404/409 from the tabs poll is the DEATH handshake: the panel flips to
 * its closed lamp, empties the strip, and shows one honest line — while a
 * genuine transient fetch failure keeps the last strip rows (the old
 * 'transient' arm stays for real transients only).
 * Same stub shapes as browser-panel-tabs.test.ts.
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

const SESSION_ID = 'sess-death12345678';
const T1 = 'tid-1';
const T2 = 'tid-2';

const twoTabs = {
	tabs: [
		{ targetId: T1, url: 'data:text/html,one', title: 'Tab One', active: true },
		{ targetId: T2, url: 'https://two.example', title: 'Tab Two', active: false }
	]
};

const env = {
	tabs: twoTabs as { tabs: unknown[] } | null,
	tabsStatus: 200,
	failTabs: false
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
		if (env.failTabs) throw new TypeError('Failed to fetch');
		return new Response(JSON.stringify(env.tabs ?? { tabs: [] }), { status: env.tabsStatus });
	}
	if (url.includes('/input')) return new Response('{}', { status: 200 });
	return new Response('unrouted: ' + url, { status: 404 });
});

beforeEach(() => {
	StubEventSource.instances = [];
	env.tabs = twoTabs;
	env.tabsStatus = 200;
	env.failTabs = false;
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
/** wait out the 2s strip poll so a SECOND refreshTabs actually fires */
const nextPoll = (): Promise<void> => new Promise((r) => setTimeout(r, 2300));

/** Fire a frame so the panel flips to 'live' — the poll only runs live. */
async function goLive(): Promise<void> {
	const source = StubEventSource.instances[0];
	const b64 = Buffer.from('fakejpeg').toString('base64');
	source.emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
	await tick();
	await tick();
	flushSync();
}

describe('BrowserPanel tabs death-arm (Ghost Glass Fix 1)', () => {
	it('404 from the tabs poll flips the panel to the closed lamp and empties the strip', async () => {
		const { target, onclosed, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		await goLive();
		// healthy baseline: the strip shows both tabs
		expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(2);
		// the session is reaped — every later /tabs answers 404
		env.tabsStatus = 404;
		await nextPoll();
		flushSync();
		// the strip is EMPTIED — no ghost badges
		expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(0);
		// the honest line: the closed lamp, not the waiting-for-frames lie
		const lamp = target.querySelector('[data-testid="browser-closed"]');
		expect(lamp, 'closed lamp must render').toBeTruthy();
		expect(target.querySelector('[data-testid="browser-failed"]')).toBeNull();
		// the SSE is detached (nothing left to stream)
		expect(StubEventSource.instances.every((s) => s.closed)).toBe(true);
		// the panel stays MOUNTED with its lamp — it does not remove itself
		expect(onclosed).not.toHaveBeenCalled();
		un();
	});

	it('409 from the tabs poll answers the same death handshake', async () => {
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		await goLive();
		env.tabsStatus = 409;
		await nextPoll();
		flushSync();
		expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(0);
		expect(target.querySelector('[data-testid="browser-closed"]')).toBeTruthy();
		un();
	});

	it('a genuine transient fetch failure keeps the last strip rows', async () => {
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		await goLive();
		expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(2);
		env.failTabs = true;
		await nextPoll();
		flushSync();
		// the transient arm: the strip keeps its rows, no death lamp
		expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(2);
		expect(target.querySelector('[data-testid="browser-closed"]')).toBeNull();
		un();
	});
});

describe('BrowserPanel SSE death event (Ghost Glass Fix 2)', () => {
	it("a 'died' SSE event flips the panel to the closed lamp and empties the strip instantly", async () => {
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		await goLive();
		expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(2);
		StubEventSource.instances[0].emit('died', JSON.stringify({ reason: 'reaped' }));
		await tick();
		flushSync();
		expect(target.querySelectorAll('[data-testid="browser-tab"]')).toHaveLength(0);
		expect(target.querySelector('[data-testid="browser-closed"]')).toBeTruthy();
		un();
	});
});
