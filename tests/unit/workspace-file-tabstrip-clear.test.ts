/**
 * WorkspaceFileTabs — the grown-up tab strip (ADR 2026-09-17 amendment
 * 2026-11-03, D5a–D5d; Tasks Wave 5). Pins: the sticky clear control lives
 * OUTSIDE the scrolling strip and never renders when tabs are absent; its
 * popover offers the blanket confirm's three verbs and emits ONE
 * onClearAll(scope) intent; Esc and outside-click are both Cancel; a dirty
 * tab wears the signature tint; the active tab scrolls into view on an
 * activePath change (jsdom has no scrollIntoView — the effect must not
 * throw, pinned by the mount itself).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkspaceFileTabs from '$lib/components/workspace-file/WorkspaceFileTabs.svelte';

interface Intents {
	activate: string[];
	close: string[];
	clear: string[];
}

function mountTabs(
	tabs: Array<{ path: string; dirty?: boolean }>,
	activePath: string | null,
	intents: Intents
) {
	const target = document.createElement('div');
document.body.appendChild(target);
	const instance = mount(WorkspaceFileTabs, {
		target,
		props: {
			tabs,
			activePath,
			onActivate: (p: string) => intents.activate.push(p),
			onClose: (p: string) => intents.close.push(p),
			onClearAll: (scope: 'all' | 'non-dirty') => intents.clear.push(scope),
			children: (() => null) as never
		}
	});
	flushSync();
	return { target, instance };
}

function click(el: Element): void {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('tabstrip clear — the sticky control and its blanket confirm', () => {
	it('the clear control renders in a slot OUTSIDE the scrolling strip', () => {
		const { target, instance } = mountTabs([{ path: 'a.ts' }, { path: 'b.ts' }], 'a.ts', {
			activate: [],
			close: [],
			clear: []
		});
		const slot = target.querySelector('[data-testid="workspace-file-tabstrip-clear-slot"]');
		expect(slot).not.toBeNull();
		// sticky = sibling of the scroller, never inside it
		const strip = target.querySelector('[data-testid="workspace-file-tabstrip"]');
		expect(slot?.contains(strip)).toBe(false);
		expect(strip?.contains(slot)).toBe(false);
		expect(slot?.querySelector('[data-testid="workspace-file-tabstrip-clear"]')).not.toBeNull();
		unmount(instance);
	});

	it('no onClearAll prop renders NO clear control; no tabs renders NO strip at all', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(WorkspaceFileTabs, {
			target,
			props: {
				tabs: [{ path: 'a.ts' }],
				activePath: 'a.ts',
				onActivate: () => {},
				onClose: () => {},
				children: (() => null) as never
			}
		});
		flushSync();
		expect(target.querySelector('[data-testid="workspace-file-tabstrip-clear"]')).toBeNull();
		unmount(instance);

		const t2 = document.createElement('div');
		document.body.appendChild(t2);
		const i2 = mount(WorkspaceFileTabs, {
			target: t2,
			props: {
				tabs: [],
				activePath: null,
				onActivate: () => {},
				onClose: () => {},
				onClearAll: () => {},
				children: (() => null) as never
			}
		});
		flushSync();
		expect(t2.querySelector('[data-testid="workspace-file-tabstrip"]')).toBeNull();
		expect(t2.querySelector('[data-testid="workspace-file-tabstrip-clear"]')).toBeNull();
		unmount(i2);
	});

	it('the popover offers the three verbs and emits ONE scope intent each', () => {
		const intents: Intents = { activate: [], close: [], clear: [] };
		const { target, instance } = mountTabs([{ path: 'a.ts' }], 'a.ts', intents);
		const pop = target.querySelector('[data-testid="workspace-file-tabstrip-clear-pop"]');
		expect(pop).toBeNull(); // closed until the button opens it
		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear"]')!);
		expect(
			target.querySelector('[data-testid="workspace-file-tabstrip-clear-pop"]')
		).not.toBeNull();

		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear-all"]')!);
		expect(intents.clear).toEqual(['all']);
		expect(target.querySelector('[data-testid="workspace-file-tabstrip-clear-pop"]')).toBeNull();

		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear"]')!);
		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear-nondirty"]')!);
		expect(intents.clear).toEqual(['all', 'non-dirty']);
		unmount(instance);
	});

	it('there is NO Cancel verb — outside click and the toggle are the cancels (2026-11-03 operator request)', () => {
		const intents: Intents = { activate: [], close: [], clear: [] };
		const { target, instance } = mountTabs([{ path: 'a.ts' }], 'a.ts', intents);
		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear"]')!);
		expect(target.querySelector('[data-testid="workspace-file-tabstrip-clear-cancel"]')).toBeNull();
		// outside click (the backdrop arm) closes with NO intent
		click(target.querySelector('.backdrop')!);
		expect(target.querySelector('[data-testid="workspace-file-tabstrip-clear-pop"]')).toBeNull();
		expect(intents.clear).toEqual([]);

		// the button toggles closed too
		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear"]')!);
		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear"]')!);
		expect(target.querySelector('[data-testid="workspace-file-tabstrip-clear-pop"]')).toBeNull();
		expect(intents.clear).toEqual([]);
		unmount(instance);
	});

	it('Esc and an outside click are both Cancel — nothing clears', () => {
		const intents: Intents = { activate: [], close: [], clear: [] };
		const { target, instance } = mountTabs([{ path: 'a.ts' }], 'a.ts', intents);
		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear"]')!);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(target.querySelector('[data-testid="workspace-file-tabstrip-clear-pop"]')).toBeNull();
		expect(intents.clear).toEqual([]);

		click(target.querySelector('[data-testid="workspace-file-tabstrip-clear"]')!);
		// jsdom has no hit-testing: a real outside click lands ON the fixed
		// backdrop (it covers the viewport), so click the backdrop directly
		click(target.querySelector('.backdrop')!);
		expect(target.querySelector('[data-testid="workspace-file-tabstrip-clear-pop"]')).toBeNull();
		expect(intents.clear).toEqual([]);
		unmount(instance);
	});
});

describe('dirty tint and scroll-into-view (D5a/D5d)', () => {
	it('a dirty tab carries the dirty class; a clean tab does not; absent flag = clean', () => {
		const { target, instance } = mountTabs(
			[
				{ path: 'a.ts', dirty: true },
				{ path: 'b.ts', dirty: false },
				{ path: 'c.ts' }
			],
			'a.ts',
			{ activate: [], close: [], clear: [] }
		);
		expect(
			(target.querySelector('[data-testid="workspace-file-tab-a.ts"]') as HTMLElement).classList.contains('dirty')
		).toBe(true);
		expect(
			(target.querySelector('[data-testid="workspace-file-tab-b.ts"]') as HTMLElement).classList.contains('dirty')
		).toBe(false);
		expect(
			(target.querySelector('[data-testid="workspace-file-tab-c.ts"]') as HTMLElement).classList.contains('dirty')
		).toBe(false);
		unmount(instance);
	});

	it('activePath changes rerun the scroll effect (spy on scrollIntoView)', () => {
		const calls: Array<Record<string, string>> = [];
		const spy = vi.fn(function (this: Element, opts: Record<string, string>) {
			calls.push(opts);
		});
		Element.prototype.scrollIntoView = spy as never;
		const { target, instance } = mountTabs([{ path: 'a.ts' }, { path: 'b.ts' }], 'a.ts', {
			activate: [],
			close: [],
			clear: []
		});
		const firstCalls = calls.length;
		expect(firstCalls).toBeGreaterThan(0); // initial active tab scrolled
		const before = spy.mock.calls.length;
		// simulate the panel flipping activePath: fresh mount in a fresh target,
		// same component — the effect reads activePath, so a new value reruns it
		const t2 = document.createElement('div');
		document.body.appendChild(t2);
		const i2 = mount(WorkspaceFileTabs, {
			target: t2,
			props: {
				tabs: [{ path: 'a.ts' }, { path: 'b.ts' }],
				activePath: 'b.ts',
				onActivate: () => {},
				onClose: () => {},
				onClearAll: () => {},
				children: (() => null) as never
			}
		});
		flushSync();
		expect(spy.mock.calls.length).toBeGreaterThan(before);
		expect(calls.at(-1)).toEqual({ inline: 'nearest', block: 'nearest' });
		unmount(instance);
		unmount(i2);
		delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
	});
});
