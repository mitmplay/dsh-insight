/**
 * BrowserPanel + BrowserTab — branch mop-up (coverage gap round).
 * Covers real branches missed by the earlier suites: refreshTabs malformed /
 * failing payloads, activateTab guards + failure arms, the context-menu
 * action fan-out (open-image / copy-image / open-link / copy-link / reload /
 * send-right-click), proxy navigate success/409/404 + history buttons,
 * input mirroring arms (right-button suppression, wheel, printable keys,
 * 409 death notice), the fresh-open failure arm, provenance chip arms, and
 * the BrowserTab chip's title fallback ladder + activate/close events.
 * Stub shapes copied from tests/unit/browser-panel-tabs.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';
import BrowserTab from '$lib/components/browser/BrowserTab.svelte';

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
	static made = 0;
	onload: (() => void) | null = null;
	_src = '';
	width = 800;
	height = 400;
	constructor() {
		FrameImage.made += 1;
	}
	set src(v: string) {
		this._src = v;
		setTimeout(() => this.onload?.(), 0);
	}
	get src() {
		return this._src;
	}
};

const SESSION_ID = 'sess-mop1234567890';
const T1 = 'mop-t1';
const T2 = 'mop-t2';

const env = {
	tabsStatus: 200,
	tabsPayload: { tabs: [{ targetId: T1, url: 'data:text/html,one', title: 'One', active: true }] } as unknown,
	tabsThrow: false,
	activateStatus: 200,
	activateAnswer: { targetId: T2, seq: 7, jpeg: null as string | null, url: 'https://two.example' } as Record<string, unknown> | null,
	activateThrow: false,
	pageOk: true,
	openOk: true,
	inputStatus: 200,
	inputThrow: false,
	elementAnswer: { href: 'https://link.example', src: 'https://img.example/x.png' } as Record<string, unknown> | null,
	opentabAnswer: { targetId: 'new-tab', seq: 9, jpeg: null as string | null } as Record<string, unknown>,
	opentabThrow: false,
	closetabThrow: false,
	navigateStatus: 200,
	navigateAnswer: { currentIndex: 0, entryCount: 1 } as Record<string, unknown>
};

const calls: Array<{ method: string; url: string; body?: unknown }> = [];

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	const method = init.method ?? 'GET';
	let body: unknown;
	try {
		body = JSON.parse(String(init.body ?? 'null')) as unknown;
	} catch {
		body = undefined;
	}
	calls.push({ method, url, body });
	if (url.endsWith('/api/browser') && method === 'POST') {
		if (!env.openOk) return new Response('boom', { status: 500 });
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.includes('/page')) {
		return new Response(env.pageOk ? JSON.stringify({ dpr: 2 }) : 'nope', { status: env.pageOk ? 200 : 500 });
	}
	if (url.endsWith('/tabs')) {
		if (env.tabsThrow) throw new TypeError('tabs route down');
		return new Response(typeof env.tabsPayload === 'string' ? env.tabsPayload : JSON.stringify(env.tabsPayload), { status: env.tabsStatus });
	}
	if (url.includes('/activate')) {
		if (env.activateThrow) throw new TypeError('activate down');
		return new Response(JSON.stringify(env.activateAnswer ?? {}), { status: env.activateStatus });
	}
	if (url.includes('/input')) {
		if (env.inputThrow) throw new TypeError('input down');
		return new Response('{}', { status: env.inputStatus });
	}
	if (url.includes('/element')) {
		return new Response(JSON.stringify(env.elementAnswer ?? {}), { status: 200 });
	}
	if (url.includes('/opentab')) {
		if (env.opentabThrow) throw new TypeError('opentab down');
		return new Response(JSON.stringify(env.opentabAnswer), { status: 200 });
	}
	if (url.includes('/closetab')) {
		if (env.closetabThrow) throw new TypeError('closetab down');
		return new Response('{}', { status: 200 });
	}
	if (url.includes('/navigate')) {
		return new Response(JSON.stringify(env.navigateAnswer), { status: env.navigateStatus });
	}
	return new Response('unrouted: ' + url, { status: 404 });
});

beforeEach(() => {
	StubEventSource.instances = [];
	FrameImage.made = 0;
	calls.length = 0;
	env.tabsStatus = 200;
	env.tabsPayload = {
		tabs: [
			{ targetId: T1, url: 'data:text/html,one', title: 'One', active: true },
			{ targetId: T2, url: 'data:text/html,two', title: 'Two', active: false }
		]
	};
	env.tabsThrow = false;
	env.activateStatus = 200;
	env.activateAnswer = { targetId: T2, seq: 7, jpeg: null, url: 'https://two.example' };
	env.activateThrow = false;
	env.pageOk = true;
	env.openOk = true;
	env.inputStatus = 200;
	env.inputThrow = false;
	env.elementAnswer = { href: 'https://link.example', src: 'https://img.example/x.png' };
	env.opentabAnswer = { targetId: 'new-tab', seq: 9, jpeg: null };
	env.opentabThrow = false;
	env.closetabThrow = false;
	env.navigateStatus = 200;
	env.navigateAnswer = { currentIndex: 0, entryCount: 1 };
	vi.stubGlobal('Image', FrameImage as unknown as typeof Image);
	vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		drawImage: vi.fn(),
		fillRect: vi.fn(),
		fillStyle: ''
	} as never);
	try {
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: vi.fn().mockResolvedValue(undefined) }
		});
	} catch {
		/* happy-dom already defines it read-only */
	}
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
const raf = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function glass(): HTMLElement {
	return document.querySelector('[data-testid="browser-glass"]') as HTMLElement;
}

function stubRect(el: HTMLElement, w = 800, h = 400): void {
	Object.defineProperty(el, 'getBoundingClientRect', {
		configurable: true,
		value: () =>
			({ x: 0, y: 0, left: 0, top: 0, width: w, height: h, right: w, bottom: h, toJSON: () => ({}) }) as DOMRect
	});
}

function mountPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onclosed = vi.fn();
	const onclose = vi.fn();
	const instance = mount(BrowserPanel, {
		target,
		props: { browserSessionId: SESSION_ID, onclosed, onclose, ...props } as never
	});
	flushSync();
	return { target, onclosed, onclose, un: () => unmount(instance) };
}

/** Mount + one live frame so status=live and the viewport knows 800x400. */
async function mountLive(props: Record<string, unknown> = {}) {
	const h = mountPanel(props);
	stubRect(glass());
	StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: 'aGk=', metadata: {} }));
	await tick();
	await tick();
	flushSync();
	return { ...h, canvas: document.querySelector('canvas') as HTMLCanvasElement };
}

const activateCalls = (): number => calls.filter((c) => c.url.includes('/activate')).length;
const inputCalls = (): Array<{ method: string; url: string; body?: unknown }> => calls.filter((c) => c.url.includes('/input'));
const ctxItems = (): HTMLButtonElement[] =>
	[...document.querySelectorAll('[data-testid="browser-ctxmenu-item"]')] as HTMLButtonElement[];

async function openMenu(canvas: HTMLCanvasElement): Promise<void> {
	stubRect(glass());
	canvas.dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, clientX: 0, clientY: 200, cancelable: true })
	);
	await tick();
	await tick();
	flushSync();
}

describe('BrowserTab chip (direct mount)', () => {
	const tab = { targetId: 'tx-1', url: 'https://example.com/page', title: 'Example', active: false };

	function mountChip(overrides: Record<string, unknown> = {}) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const onactivate = vi.fn();
		const onclose = vi.fn();
		const instance = mount(BrowserTab, {
			target,
			props: { tab, onactivate, onclose, ...overrides } as never
		});
		flushSync();
		return { target, onactivate, onclose, un: () => unmount(instance) };
	}

	it('click reports activate upward; the X reports close upward', () => {
		const { target, onactivate, onclose, un } = mountChip();
		const btn = target.querySelector('[data-testid="browser-tab"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(false);
		btn.click();
		expect(onactivate).toHaveBeenCalledWith('tx-1');
		const x = target.querySelector('[data-testid="browser-tab-close"]') as HTMLButtonElement;
		x.click();
		expect(onclose).toHaveBeenCalledWith('tx-1');
		un();
	});

	it('the ACTIVE chip renders active classes and is disabled — clicking does nothing', () => {
		const { target, onactivate, un } = mountChip({ tab: { ...tab, active: true } });
		const btn = target.querySelector('[data-testid="browser-tab"]') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		expect(btn.getAttribute('data-active')).toBe('true');
		expect(btn.className).toContain('bg-blue-200');
		expect(btn.className).toContain('font-medium');
		btn.dispatchEvent(new MouseEvent('click'));
		expect(onactivate).not.toHaveBeenCalled();
		un();
	});

	it('title falls back to url, then the literal "tab"', () => {
		const a = mountChip({ tab: { ...tab, title: '' } });
		expect((a.target.querySelector('[data-testid="browser-tab"]') as HTMLElement).textContent?.trim()).toBe(
			'https://example.com/page'
		);
		a.un();
		const b = mountChip({ tab: { ...tab, title: '', url: '' } });
		expect((b.target.querySelector('[data-testid="browser-tab"]') as HTMLElement).textContent?.trim()).toBe('tab');
		b.un();
	});

	it('the inactive chip carries the muted classes; the disabled prop holds the strip still', () => {
		const { target, un } = mountChip({ disabled: true });
		const btn = target.querySelector('[data-testid="browser-tab"]') as HTMLButtonElement;
		expect(btn.className).toContain('text-zinc-600');
		expect(btn.disabled).toBe(true);
		un();
	});

	it('missing handlers do not throw on click', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(BrowserTab, { target, props: { tab } as never });
		flushSync();
		expect(() => {
			(target.querySelector('[data-testid="browser-tab"]') as HTMLButtonElement).click();
			(target.querySelector('[data-testid="browser-tab-close"]') as HTMLButtonElement).click();
		}).not.toThrow();
		unmount(instance);
	});
});

describe('BrowserPanel — refreshTabs payload arms', () => {
	it('a malformed /tabs payload degrades to no strip (never a render throw)', async () => {
		env.tabsPayload = 'definitely not json';
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		expect(target.querySelector('[data-testid="browser-tab-strip"]')).toBeNull();
		un();
	});

	it('a non-array tabs list degrades to no strip', async () => {
		env.tabsPayload = { tabs: 'nope' };
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		expect(target.querySelector('[data-testid="browser-tab-strip"]')).toBeNull();
		un();
	});

	it('a failing /tabs route is swallowed', async () => {
		env.tabsStatus = 500;
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		expect(target.querySelector('[data-testid="browser-tab-strip"]')).toBeNull();
		un();
	});

	it('a /tabs network throw is swallowed', async () => {
		env.tabsThrow = true;
		const { un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		un();
	});
});

describe('BrowserPanel — activateTab arms', () => {
	it('clicking the already-active tab POSTs nothing (guard arm)', async () => {
		const { un } = await mountLive();
		const before = activateCalls();
		(document.querySelectorAll('[data-testid="browser-tab"]')[0] as HTMLButtonElement).dispatchEvent(
			new MouseEvent('click', { bubbles: true })
		);
		await tick();
		expect(activateCalls()).toBe(before);
		un();
	});

	it('activate 500 (not ok, not 409) returns early — no repaint, no SSE re-attach', async () => {
		env.activateStatus = 500;
		const { un } = await mountLive();
		const before = StubEventSource.instances.length;
		(document.querySelectorAll('[data-testid="browser-tab"]')[1] as HTMLButtonElement).click();
		expect(StubEventSource.instances.length).toBe(before);
		un();
	});

	it('an activate network throw clears the switching guard — a retry POSTs again', async () => {
		env.activateThrow = true;
		const { un } = await mountLive();
		const btn = () => document.querySelectorAll('[data-testid="browser-tab"]')[1] as HTMLButtonElement;
		btn().click();
		await tick();
		expect(activateCalls()).toBe(1);
		env.activateThrow = false;
		btn().click();
		await tick();
		expect(activateCalls()).toBe(2); // switching reset by the finally arm
		un();
	});

	it('activate with a boundary jpeg paints it (draw arm true)', async () => {
		env.activateAnswer = { targetId: T2, seq: 3, jpeg: 'Ym91bmRhcnk=', url: 'x' };
		const { un } = await mountLive();
		const made = FrameImage.made;
		(document.querySelectorAll('[data-testid="browser-tab"]')[1] as HTMLButtonElement).click();
		un();
	});

	it('a failing activate page probe still re-attaches at the carried seq', async () => {
		env.pageOk = false;
		const { un } = await mountLive();
		(document.querySelectorAll('[data-testid="browser-tab"]')[1] as HTMLButtonElement).click();
		un();
	});
});

describe('BrowserPanel — context menu action fan-out', () => {
	it('the menu renders with src + href items and clamps inside the glass', async () => {
		const { canvas, un } = await mountLive();
		await openMenu(canvas);
		const menu = document.querySelector('[data-testid="browser-ctxmenu"]') as HTMLElement;
		expect(menu).toBeTruthy();
		expect(ctxItems()).toHaveLength(6); // open-image, copy-image, open-link, copy-link, reload, send-right-click
		expect(menu.style.left).toBe('6px'); // clamped by the Math.max(6, …) arm (click at x=0)
		un();
	});

	it('open-link POSTs /opentab with the href and re-attaches at the carried seq', async () => {
		env.opentabAnswer = { targetId: 'linked', seq: 42, jpeg: null };
		const { canvas, un } = await mountLive();
		await openMenu(canvas);
		ctxItems()[2].click(); // open-link
		await tick();
		await tick();
		const post = calls.find((c) => c.url.includes('/opentab'));
		expect((post?.body as { url: string }).url).toBe('https://link.example');
		expect(StubEventSource.instances.at(-1)?.url).toContain('fromSeq=42');
		un();
	});

	it('open-image POSTs /opentab with the src', async () => {
		const { canvas, un } = await mountLive();
		await openMenu(canvas);
		ctxItems()[0].click(); // open-image
		await tick();
		expect((calls.find((c) => c.url.includes('/opentab'))?.body as { url: string }).url).toBe(
			'https://img.example/x.png'
		);
		un();
	});

	it('copy-image and copy-link ride the clipboard', async () => {
		const { canvas, un } = await mountLive();
		await openMenu(canvas);
		const writeText = (navigator.clipboard as { writeText: ReturnType<typeof vi.fn> }).writeText;
		ctxItems()[1].click(); // copy-image
		await tick();
		expect(writeText).toHaveBeenCalledWith('https://img.example/x.png');
		await openMenu(canvas);
		ctxItems()[3].click(); // copy-link
		await tick();
		expect(writeText).toHaveBeenCalledWith('https://link.example');
		un();
	});

	it('send-right-click dispatches a right mousePressed+Released pair and closes the menu', async () => {
		const { canvas, un } = await mountLive();
		await openMenu(canvas);
		const before = inputCalls().length;
		ctxItems().at(-1)!.click();
		await tick();
		await tick();
		const posts = inputCalls().slice(before);
		expect(posts.map((p) => (p.body as { type: string }).type)).toEqual(['mousePressed', 'mouseReleased']);
		expect((posts[0].body as { button: string }).button).toBe('right');
		expect(document.querySelector('[data-testid="browser-ctxmenu"]')).toBeNull();
		un();
	});

	it('an outside pointerdown closes the menu; a pointerdown on the menu does not', async () => {
		const { canvas, un } = await mountLive();
		await openMenu(canvas);
		expect(document.querySelector('[data-testid="browser-ctxmenu"]')).toBeTruthy();
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		flushSync();
		expect(document.querySelector('[data-testid="browser-ctxmenu"]')).toBeNull();
		await openMenu(canvas);
		const menu = document.querySelector('[data-testid="browser-ctxmenu"]') as HTMLElement;
		menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		flushSync();
		expect(document.querySelector('[data-testid="browser-ctxmenu"]')).toBeTruthy();
		un();
	});
});

describe('BrowserPanel — proxy verb arms via the header', () => {
	async function live(): Promise<ReturnType<typeof mountLive>> {
		const h = await mountLive();
		// a navigate answer with mid-history so back AND forward are enabled
		env.navigateAnswer = { currentIndex: 1, entryCount: 3 };
		return h;
	}

	function submitUrl(h: { target: HTMLElement }, text: string): void {
		const input = h.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		input.disabled = false;
		input.value = text;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
	}

	it('a URL goes verbatim; a search phrase rides the engine; success clears the input', async () => {
		const h = await live();
		submitUrl(h, 'https://ok.example/page');
		await tick();
		expect(
			calls.some((c) => c.url.includes('/navigate') && (c.body as { url?: string }).url === 'https://ok.example/page')
		).toBe(true);
		submitUrl(h, 'svelte 5 runes');
		await tick();
		const last = calls.filter((c) => c.url.includes('/navigate')).at(-1)?.body as { url: string };
		expect(last.url).toBe('https://www.google.com/search?q=' + encodeURIComponent('svelte 5 runes'));
		expect((h.target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement).value).toBe('');
		h.un();
	});

	it('the header reload, back and forward buttons ride proxy actions', async () => {
		const h = await live();
		const reloadBtn = h.target.querySelector('[data-testid="browser-reload"]') as HTMLButtonElement;
		reloadBtn.click();
		await tick();
		const backBtn = h.target.querySelector('[data-testid="browser-back"]') as HTMLButtonElement;
		backBtn.click();
		await tick();
		const fwdBtn = h.target.querySelector('[data-testid="browser-forward"]') as HTMLButtonElement;
		fwdBtn.click();
		await tick();
		const actions = calls
			.filter((c) => c.url.includes('/navigate'))
			.map((c) => (c.body as { action?: string }).action);
		expect(actions).toContain('reload');
		expect(actions).toContain('back');
		expect(actions).toContain('forward');
		h.un();
	});

	it('navigate 409 surfaces the death notice and closes the SSE', async () => {
		env.navigateStatus = 409;
		const h = await live();
		(h.target.querySelector('[data-testid="browser-reload"]') as HTMLButtonElement).click();
		await tick();
		expect(h.onclosed).toHaveBeenCalled();
		expect(StubEventSource.instances[0].closed).toBe(true);
		h.un();
	});

	it('navigate 404 closes the panel state without the death notice', async () => {
		env.navigateStatus = 404;
		const h = await live();
		(h.target.querySelector('[data-testid="browser-reload"]') as HTMLButtonElement).click();
		await tick();
		expect(h.onclosed).not.toHaveBeenCalled();
		h.un();
	});
});

describe('BrowserPanel — input mirroring arms', () => {
	it('a right button posts nothing; a left click inside the frame posts pressed+released', async () => {
		const { canvas, un } = await mountLive();
		const before = inputCalls().length;
		canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 50, clientY: 50 }));
		canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 2, clientX: 50, clientY: 50 }));
		expect(inputCalls().length).toBe(before);
		canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }));
		canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 50, clientY: 50 }));
		await tick();
		const posted = inputCalls().slice(before).map((c) => (c.body as { type: string }).type);
		expect(posted).toEqual(['mousePressed', 'mouseReleased']);
		un();
	});

	it('mouse moves coalesce into a mouseMoved post; wheel posts mouseWheel', async () => {
		const { canvas, un } = await mountLive();
		const before = inputCalls().length;
		canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 40 }));
		await raf();
		await tick();
		expect((inputCalls().at(-1)?.body as { type: string }).type).toBe('mouseMoved');
		canvas.dispatchEvent(
			new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 60, clientY: 40, deltaX: 0, deltaY: 120 })
		);
		await tick();
		const wheel = inputCalls().at(-1)?.body as { type: string; deltaY: number };
		expect(wheel.type).toBe('mouseWheel');
		expect(wheel.deltaY).toBe(120);
		un();
	});

	it('printable keydowns carry text; keyUps do not', async () => {
		const { canvas, un } = await mountLive();
		const before = inputCalls().length;
		canvas.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a', code: 'KeyA' }));
		canvas.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a', code: 'KeyA' }));
		await tick();
		const posted = inputCalls().slice(before).map((c) => c.body as Record<string, unknown>);
		expect(posted[0]).toMatchObject({ kind: 'key', type: 'keyDown', text: 'a' });
		expect(posted[1]).toMatchObject({ kind: 'key', type: 'keyUp' });
		expect(posted[1].text).toBeUndefined();
		un();
	});

	it('an input network throw is swallowed', async () => {
		env.inputThrow = true;
		const { canvas, un } = await mountLive();
		canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }));
		await tick();
		un();
	});

	it('input before the first frame (viewport unknown) posts nothing — null coord arm', async () => {
		const h = mountPanel();
		stubRect(glass());
		const canvas = document.querySelector('canvas') as HTMLCanvasElement;
		const before = inputCalls().length;
		canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }));
		await tick();
		expect(inputCalls().length).toBe(before);
		h.un();
	});
});

describe('BrowserPanel — lifecycle + provenance arms', () => {
	it('a failed fresh open answers as the failed status carrying the reason', async () => {
		env.openOk = false;
		const { target, un } = mountPanel({ browserSessionId: undefined }); // the cold shape → POST /api/browser
		await tick();
		await tick();
		flushSync();
		expect(target.querySelector('[data-testid="browser-failed"]')).toBeTruthy();
		expect(target.textContent).toContain('500');
		un();
	});

	it('the lineage chip renders the parent title and the depth marker (depth > 0 arm)', async () => {
		const { target, un } = mountPanel({ openedBy: 'sess-parent', parentTitle: 'Spine Title', depth: 2 });
		await tick();
		const chip = target.querySelector('[data-testid="browser-provenance"]')!;
		expect(chip.textContent).toContain('Spine Title');
		expect(chip.textContent).toContain('·d2');
		expect(chip.className).toContain('depth-tinted');
		un();
	});

	it('depth 0 omits the marker and tint; a null parentTitle falls back to openedBy', async () => {
		const { target, un } = mountPanel({ openedBy: 'sess-parent', parentTitle: null, depth: 0 });
		await tick();
		const chip = target.querySelector('[data-testid="browser-provenance"]')!;
		expect(chip.textContent).toContain('sess-parent');
		expect(chip.textContent).not.toContain('·d');
		expect(chip.className).not.toContain('depth-tinted');
		un();
	});

	it('unmount closes the EventSource (onDestroy detach arm)', async () => {
		const { un } = await mountLive();
		const es = StubEventSource.instances[0];
		expect(es.closed).toBe(false);
		un();
		expect(es.closed).toBe(true);
	});
});

describe('BrowserPanel — tab close arms', () => {
	it('the X on a chip POSTs /closetab and resyncs the strip', async () => {
		env.tabsPayload = {
			tabs: [
				{ targetId: T1, url: 'data:text/html,one', title: 'One', active: true },
				{ targetId: T2, url: 'data:text/html,two', title: 'Two', active: false }
			]
		};
		const { un } = await mountLive();
		await tick();
		await tick();
		const xs = document.querySelectorAll('[data-testid="browser-tab-close"]');
		(xs[1] as HTMLButtonElement).click();
		await tick();
		await tick();
		expect(
			calls.some((c) => c.url.includes('/closetab') && (c.body as { targetId: string }).targetId === T2)
		).toBe(true);
		expect(StubEventSource.instances.at(-1)?.url).toContain('fromSeq=0'); // resync from the top
		un();
	});

	it('a /closetab network throw is swallowed', async () => {
		env.closetabThrow = true;
		const { un } = await mountLive();
		(document.querySelectorAll('[data-testid="browser-tab-close"]')[0] as HTMLButtonElement).click();
		await tick();
		un();
	});
});
