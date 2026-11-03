import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserHeader from '$lib/components/browser/BrowserHeader.svelte';

/**
 * Behavior battery for BrowserHeader (mount + assertions, the
 * browser-fresh-open pattern): proxy controls (back/forward/reload), the
 * long-press history dropdown branches, the copy-URL icon (clipboard +
 * legacy fallback + 1.5s check flip), and the omnibox (Enter/Escape/IME,
 * clearInput/setOmniboxValue). The header only READS history (GET) and
 * REPORTS intents upward — the stubs and spies here pin exactly that.
 */

type HistPayload = {
	ok?: boolean;
	json?: unknown;
};

let historyReply: HistPayload | Error = { ok: true, json: { currentIndex: 2, entries: [
	{ index: 0, url: 'https://a.example/', title: 'First' },
	{ index: 1, url: 'about:blank', title: '' },
	{ index: 2, url: 'https://b.example/x', title: 'Second' },
	{ index: 3, url: 'https://c.example/y', title: 'Third' }
] } };
const historyCalls: string[] = [];

beforeEach(() => {
	historyReply = { ok: true, json: { currentIndex: 2, entries: [
		{ index: 0, url: 'https://a.example/', title: 'First' },
		{ index: 1, url: 'about:blank', title: '' },
		{ index: 2, url: 'https://b.example/x', title: 'Second' },
		{ index: 3, url: 'https://c.example/y', title: 'Third' }
	] } };
	historyCalls.length = 0;
	vi.stubGlobal('fetch', vi.fn((url: RequestInfo | URL) => {
		const u = String(url);
		historyCalls.push(u);
		if (!u.includes('/history')) return Promise.reject(new Error('unexpected fetch: ' + u));
		if (historyReply instanceof Error) return Promise.reject(historyReply);
		return Promise.resolve(new Response(
			historyReply.ok === false ? 'refused' : JSON.stringify(historyReply.json),
			{ status: historyReply.ok === false ? 500 : 200 }
		));
	}));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	document.body.innerHTML = '';
});

interface Mounted {
	instance: ReturnType<typeof mount>;
	target: HTMLElement;
}

function mountHeader(props: Record<string, unknown> = {}): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(BrowserHeader, { target, props: props as never });
	return { instance, target };
}

const q = (sel: string) => document.querySelector<HTMLButtonElement>(sel);
function fire(el: Element, type: string, init: EventInit & Partial<KeyboardEventInit> = {}): void {
	el.dispatchEvent(type.startsWith('key') ? new KeyboardEvent(type, { bubbles: true, ...init }) : new MouseEvent(type, { bubbles: true, ...init }));
}
/** Svelte 5 flushes effects in a microtask — two hops settle a re-render. */
async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
/** bind:value needs the input event, not a bare value write. */
function setVal(input: HTMLInputElement | HTMLButtonElement, v: string): void {
	input.value = v;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('status strip (dot + chip + data seams)', () => {
	it('renders data-status / data-rebound and the dot color per status', () => {
		const live = mountHeader({ status: 'live', reBound: true, sessionId: 'abcdefgh1234' });
		const strip = q('[data-testid="browser-status"]')!;
		expect(strip.getAttribute('data-status')).toBe('live');
		expect(strip.getAttribute('data-rebound')).toBe('true');
		expect(strip.querySelector('.bg-emerald-500')).toBeTruthy();
		expect(q('[data-testid="browser-session-tab"]')!.textContent).toBe('abcdefgh');
		unmount(live.instance);

		const failed = mountHeader({ status: 'failed' });
		expect(q('[data-testid="browser-status"] .bg-red-500')).toBeTruthy();
		expect(q('[data-testid="browser-session-tab"]')).toBeNull();
		unmount(failed.instance);

		const opening = mountHeader({ status: 'opening' });
		expect(q('[data-testid="browser-status"] .bg-amber-400')).toBeTruthy();
		unmount(opening.instance);
	});

	it('closed and connecting both land on a dot color branch', () => {
		const closed = mountHeader({ status: 'closed' });
		expect(q('[data-testid="browser-status"] .bg-red-500')).toBeTruthy();
		unmount(closed.instance);
		const connecting = mountHeader({ status: 'connecting' });
		expect(q('[data-testid="browser-status"] .bg-amber-400')).toBeTruthy();
		unmount(connecting.instance);
	});
});

describe('reload (ReloadButton extraction)', () => {
	it('fires onreload only when live and not busy', async () => {
		const onreload = vi.fn();
		const a = mountHeader({ status: 'live', onreload });
		fire(q('[data-testid="browser-reload"]')!, 'click');
		expect(onreload).toHaveBeenCalledTimes(1);
		unmount(a.instance);

		const b = mountHeader({ status: 'connecting', onreload });
		// jsdom dispatch ignores disabled — the disabled gate itself is the pin
		expect(q('[data-testid="browser-reload"]')!.disabled).toBe(true);
		unmount(b.instance);

		const c = mountHeader({ status: 'live', busy: true, onreload });
		expect(q('[data-testid="browser-reload"]')!.disabled).toBe(true);
		unmount(c.instance);
	});
});

describe('proxy controls: quick click vs long-press dropdown', () => {
	it('a quick click reports the plain single-step verb', () => {
		const onhistory = vi.fn();
		const { instance } = mountHeader({ status: 'live', canBack: true, canForward: true, sessionId: 's1', onhistory });
		fire(q('[data-testid="browser-back"]')!, 'mousedown');
		fire(q('[data-testid="browser-back"]')!, 'mouseup');
		fire(q('[data-testid="browser-back"]')!, 'click');
		fire(q('[data-testid="browser-forward"]')!, 'mousedown');
		fire(q('[data-testid="browser-forward"]')!, 'mouseup');
		fire(q('[data-testid="browser-forward"]')!, 'click');
		expect(onhistory).toHaveBeenCalledWith('back');
		expect(onhistory).toHaveBeenCalledWith('forward');
		expect(q('[data-testid="browser-history-menu"]')).toBeNull();
		unmount(instance);
	});

	it('nav buttons disable on busy and missing bounds', () => {
		const { instance } = mountHeader({ status: 'live', canBack: false, canForward: true, busy: true });
		expect(q('[data-testid="browser-back"]')!.disabled).toBe(true);
		expect(q('[data-testid="browser-forward"]')!.disabled).toBe(true);
		unmount(instance);
		const { instance: i2 } = mountHeader({ status: 'live', canBack: true, canForward: true });
		expect(q('[data-testid="browser-back"]')!.disabled).toBe(false);
		unmount(i2);
	});

	it('a ≥350ms hold opens the direction menu and SUPPRESSES the trailing click', async () => {
		vi.useFakeTimers();
		const onhistory = vi.fn();
		const onhistoryto = vi.fn();
		const { instance } = mountHeader({
			status: 'live', canBack: true, sessionId: 'sess-9', focusTargetId: 'tid-1',
			onhistory, onhistoryto
		});
		fire(q('[data-testid="browser-back"]')!, 'mousedown');
		await vi.advanceTimersByTimeAsync(400);
		expect(historyCalls).toEqual(['/api/browser/sess-9/history?targetId=tid-1']);
		const menu = q('[data-testid="browser-history-menu"]')!;
		expect(menu).toBeTruthy();
		// back = nearest-first, newest just under the button
		const items = menu.querySelectorAll('[data-testid="browser-history-item"]');
		expect(items).toHaveLength(2); // index 1, 0 (index 2 = current, excluded)
		expect(items[0].textContent).toContain('about:blank');
		// favicon branch: http(s) rows carry the s2 img; about: does not
		expect(menu.querySelector('[data-testid="browser-history-favicon"]')).toBeTruthy();
		// the trailing click after an opened menu must NOT double-fire travel
		fire(q('[data-testid="browser-back"]')!, 'mouseup');
		fire(q('[data-testid="browser-back"]')!, 'click');
		expect(onhistory).not.toHaveBeenCalled();
		// picking an entry reports the index upward and closes the menu
		fire(items[0], 'click');
		expect(onhistoryto).toHaveBeenCalledWith(1);
		await flush();
		expect(q('[data-testid="browser-history-menu"]')).toBeNull();
		unmount(instance);
	});

	it('forward hold slices chronologically after the current index', async () => {
		vi.useFakeTimers();
		const { instance } = mountHeader({ status: 'live', canForward: true, sessionId: 's2' });
		fire(q('[data-testid="browser-forward"]')!, 'mousedown');
		await vi.advanceTimersByTimeAsync(400);
		const items = q('[data-testid="browser-history-menu"]')!.querySelectorAll('[data-testid="browser-history-item"]');
		expect(items).toHaveLength(1); // only index 3
		expect(items[0].textContent).toContain('Third');
		// title || url fallback branch: the blank entry shows its url
		unmount(instance);
	});

	it('releases before the threshold keep the plain verb (mouseleave path too)', () => {
		const onhistory = vi.fn();
		const { instance } = mountHeader({ status: 'live', canBack: true, onhistory });
		const back = q('[data-testid="browser-back"]')!;
		fire(back, 'mousedown');
		fire(back, 'mouseleave'); // release off-button: plain click still fires
		fire(back, 'click');
		expect(onhistory).toHaveBeenCalledWith('back');
		unmount(instance);
	});

	it('a refused history answer means NO dropdown and the plain click still travels', async () => {
		vi.useFakeTimers();
		historyReply = { ok: false };
		const onhistory = vi.fn();
		const { instance } = mountHeader({ status: 'live', canBack: true, sessionId: 's3', onhistory });
		fire(q('[data-testid="browser-back"]')!, 'mousedown');
		await vi.advanceTimersByTimeAsync(400);
		expect(q('[data-testid="browser-history-menu"]')).toBeNull();
		fire(q('[data-testid="browser-back"]')!, 'mouseup');
		fire(q('[data-testid="browser-back"]')!, 'click');
		expect(onhistory).toHaveBeenCalledWith('back');
		unmount(instance);
	});

	it('an empty direction means no dropdown, plain click semantics stay', async () => {
		vi.useFakeTimers();
		historyReply = { ok: true, json: { currentIndex: 0, entries: [{ index: 0, url: 'https://a.example/', title: 'A' }] } };
		const onhistory = vi.fn();
		const { instance } = mountHeader({ status: 'live', canBack: true, sessionId: 's4', onhistory });
		fire(q('[data-testid="browser-back"]')!, 'mousedown');
		await vi.advanceTimersByTimeAsync(400);
		expect(q('[data-testid="browser-history-menu"]')).toBeNull();
		fire(q('[data-testid="browser-back"]')!, 'mouseup');
		fire(q('[data-testid="browser-back"]')!, 'click');
		expect(onhistory).toHaveBeenCalledWith('back');
		unmount(instance);
	});

	it('a rejected fetch is transient: no dropdown, plain verb available', async () => {
		vi.useFakeTimers();
		historyReply = new Error('offline');
		const onhistory = vi.fn();
		const { instance } = mountHeader({ status: 'live', canBack: true, sessionId: 's5', onhistory });
		fire(q('[data-testid="browser-back"]')!, 'mousedown');
		await vi.advanceTimersByTimeAsync(400);
		expect(q('[data-testid="browser-history-menu"]')).toBeNull();
		fire(q('[data-testid="browser-back"]')!, 'mouseup');
		fire(q('[data-testid="browser-back"]')!, 'click');
		expect(onhistory).toHaveBeenCalledWith('back');
		unmount(instance);
	});

	it('no sessionId: the hold never opens a menu and the plain click fires', async () => {
		vi.useFakeTimers();
		const onhistory = vi.fn();
		const { instance } = mountHeader({ status: 'live', canBack: true, onhistory });
		fire(q('[data-testid="browser-back"]')!, 'mousedown');
		await vi.advanceTimersByTimeAsync(400);
		expect(historyCalls).toEqual([]);
		expect(q('[data-testid="browser-history-menu"]')).toBeNull();
		fire(q('[data-testid="browser-back"]')!, 'mouseup');
		fire(q('[data-testid="browser-back"]')!, 'click');
		expect(onhistory).toHaveBeenCalledWith('back');
		unmount(instance);
	});

	it('closes on Escape and on an outside press', async () => {
		vi.useFakeTimers();
		const { instance } = mountHeader({ status: 'live', canBack: true, sessionId: 's6' });
		fire(q('[data-testid="browser-back"]')!, 'mousedown');
		await vi.advanceTimersByTimeAsync(400);
		expect(q('[data-testid="browser-history-menu"]')).toBeTruthy();
		fire(document.body, 'keydown', { key: 'Escape' });
		await flush();
		expect(q('[data-testid="browser-history-menu"]')).toBeNull();

		fire(q('[data-testid="browser-back"]')!, 'mousedown');
		await vi.advanceTimersByTimeAsync(400);
		expect(q('[data-testid="browser-history-menu"]')).toBeTruthy();
		// a press INSIDE the menu must not close it
		fire(q('[data-testid="browser-history-menu"]')!, 'mousedown');
		await flush();
		expect(q('[data-testid="browser-history-menu"]')).toBeTruthy();
		fire(document.body, 'mousedown');
		await flush();
		expect(q('[data-testid="browser-history-menu"]')).toBeNull();
		unmount(instance);
	});
});

describe('copy-URL icon', () => {
	afterEach(() => {
		const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
		// leave the global clipboard as found
		if (desc) Object.defineProperty(navigator, 'clipboard', desc);
	});

	it('is disabled without a focused real URL; copies and flips to a check for 1.5s', async () => {
		const { instance } = mountHeader({ status: 'live', copyUrl: null });
		expect(q('[data-testid="browser-copy-url"]')!.disabled).toBe(true);
		unmount(instance);

		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		vi.useFakeTimers();
		const b = mountHeader({ status: 'live', copyUrl: 'https://x.example/p' });
		const btn = q('[data-testid="browser-copy-url"]')!;
		expect(btn.disabled).toBe(false);
		fire(btn, 'click');
		await flush();
		expect(writeText).toHaveBeenCalledWith('https://x.example/p');
		expect(btn.getAttribute('aria-label')).toBe('Copied');
		vi.advanceTimersByTime(1500);
		await flush();
		expect(btn.getAttribute('aria-label')).toBe('Copy focused tab URL');
		unmount(b.instance);
	});

	it('falls back to legacy execCommand copy when the clipboard refuses', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: vi.fn(() => Promise.reject(new Error('denied'))) },
			configurable: true
		});
		const execCopy = vi.fn();
		(document as unknown as { execCommand: unknown }).execCommand = execCopy;
		const { instance } = mountHeader({ status: 'live', copyUrl: 'https://y.example/' });
		fire(q('[data-testid="browser-copy-url"]')!, 'click');
		await flush();
		await flush();
		expect(execCopy).toHaveBeenCalledWith('copy');
		await flush();
		expect(q('[data-testid="browser-copy-url"]')!.getAttribute('aria-label')).toBe('Copied');
		unmount(instance);
	});
});

describe('omnibox', () => {
	it('Enter reports the TRIMMED text upward; empty Enter is a no-op', async () => {
		const onnavigate = vi.fn();
		const { instance } = mountHeader({ status: 'live', onnavigate });
		const input = q('[data-testid="browser-url-input"]')!;
		setVal(input, '   https://trim.example/  ');
		fire(input, 'keydown', { key: 'Enter' });
		expect(onnavigate).toHaveBeenCalledWith('https://trim.example/');
		setVal(input, '   ');
		fire(input, 'keydown', { key: 'Enter' });
		expect(onnavigate).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('Enter during IME composition never submits; Escape clears the box', async () => {
		const onnavigate = vi.fn();
		const { instance } = mountHeader({ status: 'live', onnavigate });
		const input = q('[data-testid="browser-url-input"]')!;
		setVal(input, 'candidate');
		fire(input, 'keydown', { key: 'Enter', isComposing: true });
		expect(onnavigate).not.toHaveBeenCalled();
		fire(input, 'keydown', { key: 'Escape' });
		await flush();
		expect(input.value).toBe('');
		fire(input, 'keydown', { key: 'Enter' });
		expect(onnavigate).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('input and reload go quiet while busy or not live', () => {
		const { instance } = mountHeader({ status: 'failed' });
		expect(q('[data-testid="browser-url-input"]')!.disabled).toBe(true);
		unmount(instance);
		const { instance: i2 } = mountHeader({ status: 'live', busy: true });
		expect(q('[data-testid="browser-url-input"]')!.disabled).toBe(true);
		unmount(i2);
	});

	it('placeholder prop wins; clearInput/setOmniboxValue own the box imperatively', async () => {
		const { instance, target } = mountHeader({ status: 'live', placeholder: 'Active tab address' });
		const input = target.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement;
		expect(input.placeholder).toBe('Active tab address');
		(instance as unknown as { setOmniboxValue(v: string): void }).setOmniboxValue('tab:1 https://a.example/');
		await flush();
		expect(input.value).toBe('tab:1 https://a.example/');
		(instance as unknown as { clearInput(): void }).clearInput();
		await flush();
		expect(input.value).toBe('');
		unmount(instance);

		const { instance: i2, target: t2 } = mountHeader({ status: 'live' });
		expect((t2.querySelector('[data-testid="browser-url-input"]') as HTMLInputElement).placeholder.length).toBeGreaterThan(0);
		unmount(i2);
	});
});

describe('close verb', () => {
	it('reports the kill intent upward; the closing guard disables it', () => {
		const onclose = vi.fn();
		const a = mountHeader({ status: 'live', onclose });
		fire(q('[data-testid="browse-close"]')!, 'click');
		expect(onclose).toHaveBeenCalledTimes(1);
		unmount(a.instance);

		const b = mountHeader({ status: 'live', closing: true, onclose });
		expect(q('[data-testid="browse-close"]')!.disabled).toBe(true);
		unmount(b.instance);
	});
});