/**
 * RowButtonClose / RowButtonFold unit tests — the panel row's two action
 * buttons (extracted from SidebarOpenPanels):
 *
 *   Close   — renders the aria-labelled X; a click fires `onclose` exactly
 *             once and never bubbles into the row's select click; the
 *             `label ?? ''` aria-label fallback covers an omitted label.
 *   Fold    — clusterCount 0 renders nothing; a positive count renders the
 *             chevron whose label/title/aria-expanded track `folded` in
 *             BOTH directions; a click fires `ontoggle` once, no bubble.
 */

import { flushSync } from 'svelte';
import { mount, unmount, type ComponentProps } from 'svelte';
import { describe, expect, it } from 'vitest';
import RowButtonClose from '$lib/components/sidebar/session-open/RowButtonClose.svelte';
import RowButtonFold from '$lib/components/sidebar/session-open/RowButtonFold.svelte';

function mountClose(props: ComponentProps<typeof RowButtonClose>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(RowButtonClose, { target, props });
	flushSync();
	return { target, comp };
}

function mountFold(props: ComponentProps<typeof RowButtonFold>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(RowButtonFold, { target, props });
	flushSync();
	return { target, comp };
}

describe('RowButtonClose — the panel row close X', () => {
	it('renders the row-btn close button with the row-label grammar in its aria-label', () => {
		const { target, comp } = mountClose({ label: 'My Session', onclose: () => {} });
		const btn = target.querySelector('[data-testid="sidebar-panel-close"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('type')).toBe('button');
		expect(btn.className).toContain('row-btn close');
		expect(btn.getAttribute('title')).toBe('Close panel');
		expect(btn.getAttribute('aria-label')).toBe('Close panel My Session');
		expect(btn.querySelector('svg')).not.toBeNull();
		unmount(comp);
	});

	it('an omitted label degrades the aria-label subject to empty (label ?? \'\')', () => {
		const { target, comp } = mountClose({
			label: undefined as unknown as string,
			onclose: () => {}
		});
		const btn = target.querySelector('[data-testid="sidebar-panel-close"]') as HTMLButtonElement;
		expect(btn.getAttribute('aria-label')).toBe('Close panel ');
		unmount(comp);
	});

	it('a click fires onclose exactly once and stops before the row select click', () => {
		let closed = 0;
		const { target, comp } = mountClose({ label: 's-1', onclose: () => (closed += 1) });
		// Svelte's delegated walk runs inside the mount-target listener, so
		// the stopPropagation only shields ANCESTORS — observe on the body.
		const rowClicks: Event[] = [];
		document.body.addEventListener('click', (e) => rowClicks.push(e));
		const btn = target.querySelector('[data-testid="sidebar-panel-close"]') as HTMLButtonElement;
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		flushSync();
		expect(closed).toBe(1);
		expect(rowClicks).toHaveLength(0);
		unmount(comp);
	});
});

describe('RowButtonFold — the panel row fold chevron', () => {
	it('clusterCount 0 renders nothing (no children, no chevron)', () => {
		const { target, comp } = mountFold({ clusterCount: 0, folded: true, ontoggle: () => {} });
		expect(target.querySelector('[data-testid="sidebar-panel-fold"]')).toBeNull();
		expect(target.firstElementChild).toBeNull();
		unmount(comp);
	});

	it('folded: aria-expanded false, honest Show count in label and title, right chevron', () => {
		const { target, comp } = mountFold({ clusterCount: 3, folded: true, ontoggle: () => {} });
		const btn = target.querySelector('[data-testid="sidebar-panel-fold"]') as HTMLButtonElement;
		expect(btn.getAttribute('aria-expanded')).toBe('false');
		expect(btn.getAttribute('aria-label')).toBe('Show 3 spawned sessions');
		expect(btn.getAttribute('title')).toBe('Show 3 spawned sessions');
		expect(btn.className).toContain('row-btn fold');
		expect(btn.querySelector('svg')).not.toBeNull();
		unmount(comp);
	});

	it('unfolded: aria-expanded true, honest Hide count in label and title', () => {
		const { target, comp } = mountFold({ clusterCount: 2, folded: false, ontoggle: () => {} });
		const btn = target.querySelector('[data-testid="sidebar-panel-fold"]') as HTMLButtonElement;
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		expect(btn.getAttribute('aria-label')).toBe('Hide 2 spawned sessions');
		expect(btn.getAttribute('title')).toBe('Hide 2 spawned sessions');
		unmount(comp);
	});

	it('a click fires ontoggle exactly once and stops before the row select click', () => {
		let toggles = 0;
		const { target, comp } = mountFold({
			clusterCount: 1,
			folded: true,
			ontoggle: () => (toggles += 1)
		});
		// observe on the body — the delegated handler shields only ancestors
		const rowClicks: Event[] = [];
		document.body.addEventListener('click', (e) => rowClicks.push(e));
		const btn = target.querySelector('[data-testid="sidebar-panel-fold"]') as HTMLButtonElement;
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		flushSync();
		expect(toggles).toBe(1);
		expect(rowClicks).toHaveLength(0);
		unmount(comp);
	});
});
