/**
 * BrowserPanel — the live zoom slider (2026-10-28, operator-approved):
 * renders right-aligned in the provenance row when the config knob is
 * enabled, hides when it is not, and every input POSTs (debounced) the
 * new zoom. Same stub shapes as browser-panel-tabs.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

const SESSION_ID = 'sess-zoom12345678';

class StubEventSource {
	url: string;
	constructor(url: string) {
		this.url = url;
	}
	addEventListener(): void {}
	close(): void {}
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

const env = {
	zoomGet: { zoom: 0.8, knobEnabled: true } as Record<string, unknown> | null,
	zoomPostStatus: 200,
	zoomPosts: [] as unknown[]
};

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
	const url = String(args[0]);
	const init = (args[1] ?? {}) as RequestInit;
	if (url.endsWith('/api/browser') && init.method === 'POST') {
		return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
	}
	if (url.endsWith('/zoom') && init.method === 'POST') {
		env.zoomPosts.push(JSON.parse(String(init.body)) as unknown);
		return new Response(JSON.stringify({ error: 'BAD_REQUEST' }), { status: env.zoomPostStatus });
	}
	if (url.endsWith('/zoom')) {
		if (!env.zoomGet) return new Response('{}', { status: 404 });
		return new Response(JSON.stringify(env.zoomGet), { status: 200 });
	}
	if (url.includes('/page')) return new Response(JSON.stringify({ dpr: 1 }), { status: 200 });
	if (url.endsWith('/tabs')) return new Response(JSON.stringify({ tabs: [] }), { status: 200 });
	if (url.includes('/activate')) return new Response(JSON.stringify({ targetId: 't', seq: 0, jpeg: null, url: '', title: '' }), { status: 200 });
	if (url.includes('/input')) return new Response('{}', { status: 200 });
	return new Response('unrouted: ' + url, { status: 404 });
});

beforeEach(() => {
	env.zoomGet = { zoom: 0.8, knobEnabled: true };
	env.zoomPostStatus = 200;
	env.zoomPosts = [];
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

function mountPanel(): { target: HTMLElement; un: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserPanel, { target, props: { browserSessionId: SESSION_ID, openedBy: 'agent-x' } });
	flushSync();
	return { target, un: () => unmount(instance) };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('BrowserPanel zoom slider (provenance row)', () => {
	it('renders right-aligned in the provenance row with the session zoom', async () => {
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		const prov = target.querySelector('[data-testid="browser-provenance"]');
		expect(prov).toBeTruthy();
		const slider = target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement | null;
		expect(slider).toBeTruthy();
		expect(prov!.contains(slider!)).toBe(true);
		// bounds 50..125 step 5; the initial value is the session's current zoom
		expect(slider!.min).toBe('50');
		expect(slider!.max).toBe('125');
		expect(slider!.step).toBe('5');
		expect(slider!.value).toBe('80');
		const pct = target.querySelector('[data-testid="browser-zoom-slider"]')?.parentElement?.textContent ?? '';
		expect(pct).toContain('80%');
		un();
	});

	it('an input POSTs the new zoom (debounced, one POST, last wins)', async () => {
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		const slider = target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement;
		slider.value = '95';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		slider.value = '105';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 150)); // past the ~100ms debounce
		flushSync();
		expect(env.zoomPosts).toEqual([{ zoom: 1.05 }]);
		expect((target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement).value).toBe('105');
		un();
	});

	it('hides entirely when the config knob is disabled (contentZoom 1)', async () => {
		env.zoomGet = { zoom: 1, knobEnabled: false };
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		expect(target.querySelector('[data-testid="browser-zoom-slider"]')).toBeNull();
		un();
	});

	it('unmount clears the debounce timer — no POST fires after teardown (fix round 1)', async () => {
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		const slider = target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement;
		slider.value = '95';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		un(); // teardown BEFORE the ~100ms debounce elapses
		await new Promise((r) => setTimeout(r, 150));
		expect(env.zoomPosts).toEqual([]);
	});

	it('a 400 POST rolls the optimistic local zoom back (fix round 1: slider never lies)', async () => {
		env.zoomPostStatus = 400;
		const { target, un } = mountPanel();
		await tick();
		await tick();
		flushSync();
		const slider = target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement;
		slider.value = '95';
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 200)); // past the debounce + POST
		flushSync();
		expect(env.zoomPosts).toEqual([{ zoom: 0.95 }]); // the wire SAW the attempt…
		expect((target.querySelector('[data-testid="browser-zoom-slider"]') as HTMLInputElement).value).toBe('80'); // …and rolled back
		un();
	});
});
