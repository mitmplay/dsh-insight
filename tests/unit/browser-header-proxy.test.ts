/**
 * The Glass Proxies — header proxy controls through the panel (ADR-0031
 * D1/D2, W2 task 2.2-T). Mounts BrowserPanel (the header rides inside),
 * stubs fetch/EventSource like browser-panel.test.ts, and pins: search
 * coercion, input clears on the ANSWER (not on Enter), disabled-at-ends
 * flags from currentIndex/entryCount, the in-flight guard, and the
 * dead-session refusal surface.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

class StubEventSource {
	static instances: StubEventSource[] = [];
	closed = false;
	constructor(public url: string) {
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (e: { data?: string }) => void): void {
		(this.handlers[type] ??= new Set()).add(cb);
	}
	handlers: Record<string, Set<(e: { data?: string }) => void>> = {};
	onerror: (() => void) | null = null;
	close(): void {
		this.closed = true;
	}
	emit(type: string, data?: string): void {
		for (const cb of this.handlers[type] ?? []) cb({ data });
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

const SESSION_ID = 'sess-proxy0001';
const navigateCalls: { url: string; body: unknown }[] = [];
let navigateStatus = 200;
let navigateBody = { url: 'data:text/html,x', currentIndex: 1, entryCount: 3 };

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	if (url.endsWith('/api/browser') && init.method === 'POST') {
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.endsWith('/page')) return new Response(JSON.stringify({ dpr: 2 }), { status: 200 });
	if (url.includes('/input')) return new Response('{}', { status: 200 });
	if (url.includes('/navigate')) {
		navigateCalls.push({ url, body: JSON.parse(String(init.body)) });
		return new Response(JSON.stringify(navigateBody), { status: navigateStatus });
	}
	return new Response('unrouted: ' + url, { status: 404 });
});

beforeEach(() => {
	StubEventSource.instances = [];
	navigateCalls.length = 0;
	navigateStatus = 200;
	navigateBody = { url: 'data:text/html,x', currentIndex: 1, entryCount: 3 };
	vi.stubGlobal('Image', FrameImage as unknown as typeof Image);
	vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	fetchMock.mockClear();
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as never);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

async function settle(times = 4): Promise<void> {
	for (let i = 0; i < times; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
	}
	flushSync();
}

function mountPanel() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserPanel, { target, props: {} });
	return {
		target,
		un: () => {
			unmount(instance);
			target.remove();
		}
	};
}

async function goLive(target: HTMLElement): Promise<void> {
	const b64 = Buffer.from('fakejpeg').toString('base64');
	StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: b64, metadata: {} }));
	await settle();
	expect(target.querySelector('[data-testid="browser-status"]')?.getAttribute('data-status')).toBe('live');
}

function q(target: HTMLElement, testid: string): HTMLInputElement & HTMLButtonElement {
	return target.querySelector('[data-testid="' + testid + '"]') as HTMLInputElement & HTMLButtonElement;
}
/** Type like a real user: set the value AND fire the input event so
 *  Svelte's bind:value sees it (programmatic .value= alone does not). */
function type(target: HTMLElement, testid: string, text: string): void {
	const el = q(target, testid);
	el.value = text;
	el.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('header proxy controls through the panel (2.2-T)', () => {
	it('coerces a plain phrase to a search URL and passes URLs verbatim', async () => {
		const view = mountPanel();
		await settle();
		await goLive(view.target);
		const input = q(view.target, 'browser-url-input');
		type(view.target, 'browser-url-input', 'svelte 5 runes');
		input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(navigateCalls[0]?.body).toEqual({ url: 'https://www.google.com/search?q=' + encodeURIComponent('svelte 5 runes') });
		type(view.target, 'browser-url-input', 'https://example.test/page');
		input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(navigateCalls[1]?.body).toEqual({ url: 'https://example.test/page' });
		view.un();
	});

	it('clears the input on the ANSWER, never on Enter; empty Enter is a no-op', async () => {
		const view = mountPanel();
		await settle();
		await goLive(view.target);
		const input = q(view.target, 'browser-url-input');
		type(view.target, 'browser-url-input', 'data:text/html,<title>x</title>');
		input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(input.value).not.toBe(''); // Enter alone clears nothing
		await settle();
		expect(input.value).toBe(''); // the answer cleared it
		const before = navigateCalls.length;
		type(view.target, 'browser-url-input', '   ');
		input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settle();
		expect(navigateCalls.length).toBe(before); // empty/blank Enter no-op
		view.un();
	});

	it('disabled flags ride currentIndex/entryCount from the answer', async () => {
		navigateBody = { url: 'x', currentIndex: 0, entryCount: 1 };
		const view = mountPanel();
		await settle();
		await goLive(view.target);
		expect(q(view.target, 'browser-back').disabled).toBe(true);
		expect(q(view.target, 'browser-forward').disabled).toBe(true);
		navigateBody = { url: 'x', currentIndex: 1, entryCount: 3 };
		q(view.target, 'browser-reload').click();
		await settle();
		expect(q(view.target, 'browser-back').disabled).toBe(false);
		expect(q(view.target, 'browser-forward').disabled).toBe(false);
		navigateBody = { url: 'x', currentIndex: 2, entryCount: 3 };
		q(view.target, 'browser-forward').click();
		await settle();
		expect(q(view.target, 'browser-forward').disabled).toBe(true);
		// the reload/forward POSTs carried the union action shapes
		expect(navigateCalls.map((c) => c.body)).toContainEqual({ action: 'reload' });
		expect(navigateCalls.map((c) => c.body)).toContainEqual({ action: 'forward' });
		view.un();
	});

	it('dead session refusal surfaces as closed status without crashing', async () => {
		navigateStatus = 404;
		const view = mountPanel();
		await settle();
		await goLive(view.target);
		q(view.target, 'browser-reload').click();
		await settle();
		expect(view.target.querySelector('[data-testid="browser-status"]')?.getAttribute('data-status')).toBe('closed');
		expect(StubEventSource.instances[0].closed).toBe(true);
		view.un();
	});
});
