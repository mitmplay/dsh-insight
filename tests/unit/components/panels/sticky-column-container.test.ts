/**
 * StickyColumnContainer unit tests — the leading rail column mounted
 * directly (sidebar-placement.test.ts only reaches it through the whole
 * workspace page, whose host always supplies onResizeStart).
 *
 * Pins the OCI StickyColumnContainer contract:
 *  - the width is TRIPLE-LOCKED (width/min/max all the same inline px)
 *  - the children snippet renders inside the column
 *  - the trailing gutter is the column's flex SIBLING with separator
 *    semantics, gated by showGutter (default on, off when no panels follow)
 *  - a gutter drag reports the mousedown through onResizeStart — and a
 *    missing handler is a no-op-safe drag start, never a crash
 */

import { flushSync, createRawSnippet } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StickyColumnContainer from '../../../../packages/container-base/src/components/RailColumn.svelte';

function railSnippet() {
	return createRawSnippet(() => ({ render: () => '<div data-testid="rail">rail body</div>' }));
}

function mountRail(props: { width: number; showGutter?: boolean; onResizeStart?: (e: MouseEvent) => void }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(StickyColumnContainer, {
		target,
		props: {
			width: props.width,
			label: 'Resize sidebar',
			...(props.showGutter !== undefined ? { showGutter: props.showGutter } : {}),
			...(props.onResizeStart !== undefined ? { onResizeStart: props.onResizeStart } : {}),
			children: railSnippet()
		}
	});
	flushSync();
	return { target, instance };
}

const column = (target: HTMLElement): HTMLElement =>
	target.querySelector('[data-testid="sidebar-column"]') as HTMLElement;

const gutter = (target: HTMLElement): HTMLElement | null =>
	target.querySelector('[data-testid="sidebar-gutter"]');

afterEach(() => {
	document.body.innerHTML = '';
});

describe('StickyColumnContainer — triple-locked column geometry', () => {
	it('locks width, min-width, and max-width to the same inline px', () => {
		const { target, instance } = mountRail({ width: 340 });
		const el = column(target);
		expect(el.style.width).toBe('340px');
		expect(el.style.minWidth).toBe('340px');
		expect(el.style.maxWidth).toBe('340px');
		unmount(instance);
	});

	it('renders the children snippet INSIDE the column', () => {
		const { target, instance } = mountRail({ width: 280 });
		const rail = target.querySelector('[data-testid="rail"]') as HTMLElement;
		expect(rail).not.toBeNull();
		expect(column(target).contains(rail)).toBe(true);
		unmount(instance);
	});
});

describe('StickyColumnContainer — trailing gutter gating', () => {
	it('the gutter defaults ON as the flex sibling with separator semantics', () => {
		const { target, instance } = mountRail({ width: 280 });
		const el = gutter(target);
		expect(el).not.toBeNull();
		expect(el?.previousElementSibling).toBe(column(target));
		expect(el?.getAttribute('role')).toBe('separator');
		expect(el?.getAttribute('aria-orientation')).toBe('vertical');
		expect(el?.getAttribute('aria-label')).toBe('Resize sidebar');
		unmount(instance);
	});

	it('showGutter false drops the gutter but keeps the column', () => {
		const { target, instance } = mountRail({ width: 280, showGutter: false });
		expect(gutter(target)).toBeNull();
		expect(column(target)).not.toBeNull();
		unmount(instance);
	});
});

describe('StickyColumnContainer — gutter drag reporting', () => {
	it('mousedown reports the event through onResizeStart', () => {
		const seen: MouseEvent[] = [];
		const { target, instance } = mountRail({ width: 280, onResizeStart: (e) => seen.push(e) });
		const event = new MouseEvent('mousedown', { bubbles: true });
		gutter(target)?.dispatchEvent(event);
		flushSync();
		expect(seen).toEqual([event]);
		unmount(instance);
	});

	it('a missing onResizeStart is a no-op-safe drag start', () => {
		const { target, instance } = mountRail({ width: 280 });
		expect(() => {
			gutter(target)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
			flushSync();
		}).not.toThrow();
		expect(gutter(target)).not.toBeNull();
		unmount(instance);
	});
});

describe('StickyColumnContainer — nullish width degrades to no inline lock', () => {
	it('a null width renders the column and children without a px style lock', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		// The nullish case crosses the number contract on purpose — the
		// compiled `width ?? ''` guard in the triple-lock style is the
		// behavior under test.
		const instance = mount(StickyColumnContainer, {
			target,
			props: {
				width: null as unknown as number,
				label: 'Resize sidebar',
				showGutter: false,
				children: railSnippet()
			}
		});
		flushSync();
		const el = target.querySelector('[data-testid="sidebar-column"]') as HTMLElement;
		expect(el).not.toBeNull();
		expect(el.style.width).toBe('');
		const rail = target.querySelector('[data-testid="rail"]') as HTMLElement;
		expect(el.contains(rail)).toBe(true);
		unmount(instance);
	});
});