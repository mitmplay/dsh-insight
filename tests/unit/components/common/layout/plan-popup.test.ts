/**
 * PlanPopup unit tests — pins the Current Plan readout and its close
 * contract (the popup itself; plan-button.test.ts owns the button):
 *  - tri-state rows: ● completed (struck through, emerald) / ◐
 *    in_progress (purple) / ○ pending (slate), plus the done/total header;
 *  - closed renders nothing (bindable open = false);
 *  - Escape closes while open, is inert while closed, other keys keep it;
 *  - a TRUSTED click outside closes; untrusted (synthetic) clicks,
 *    clicks inside the popup, clicks on the opening toggle, and clicks
 *    while closed never close it; a missing trigger element still closes;
 *  - on the panel floor the width cap resolves against the enclosing
 *    panel column (inline style), the viewport cap being wrong there.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PlanPopup from '$lib/components/anchor/plan-anchor/PlanPopup.svelte';
import PlanPopupHost from '../../../../fixtures/PlanPopupHost.svelte';
import type { TodoItem } from '$lib/utils/todo-lists';

const PLAN: TodoItem[] = [
	{ content: 'count the folders', status: 'completed' },
	{ content: 'report the count', status: 'in_progress' },
	{ content: 'say done', status: 'pending' }
];

/** The toggle button's wrapper — the popup's close-contract exclusion. */
function trigger(): HTMLElement {
	const el = document.createElement('div');
	el.innerHTML = '<button type="button">Plan</button>';
	document.body.appendChild(el);
	return el;
}

// Tracked per test so afterEach unmounts even after a failed assertion —
// a leaked instance keeps its window-level click/keydown handlers alive.
let current: { target: HTMLElement; instance: Record<string, unknown> } | null = null;

function mountPopup(opts: { open?: boolean; items?: TodoItem[]; triggerEl?: HTMLElement } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PlanPopup, {
		target,
		props: {
			items: opts.items ?? PLAN,
			triggerEl: opts.triggerEl,
			open: opts.open ?? true
		}
	});
	flushSync();
	current = { target, instance };
	return { target, instance };
}

function popupEl(target: HTMLElement): HTMLElement | null {
	return target.querySelector('[data-testid="plan-popup"]');
}

/** happy-dom marks dispatched events untrusted; the popup closes only on
 *  TRUSTED outside clicks, so outside-click tests stamp isTrusted on. */
function trustedClick(el: Element): void {
	const e = new MouseEvent('click', { bubbles: true });
	Object.defineProperty(e, 'isTrusted', { value: true });
	el.dispatchEvent(e);
	flushSync();
}

afterEach(() => {
	if (current) {
		unmount(current.instance);
		current.target.remove();
		current = null;
	}
	document.body.innerHTML = '';
});

describe('PlanPopup — render', () => {
	it('renders the done/total header and tri-state glyph rows in plan order', () => {
		const { target } = mountPopup();
		expect(target.querySelector('[data-testid="plan-popup-header"]')?.textContent).toContain(
			'Current Plan (1/3 done)'
		);
		const rows = [...target.querySelectorAll('[data-testid="plan-popup-row"]')];
		expect(rows.map((r) => r.getAttribute('data-status'))).toEqual([
			'completed',
			'in_progress',
			'pending'
		]);
		const glyphs = rows.map((r) => r.querySelector('span')?.textContent);
		expect(glyphs).toEqual(['●', '◐', '○']);
		expect(rows.some((r) => r.textContent?.includes('say done'))).toBe(true);
	});

	it('styles each status: struck-through done text, purple active, slate pending', () => {
		const { target } = mountPopup();
		const rows = [...target.querySelectorAll('[data-testid="plan-popup-row"]')];
		const [done, active, pending] = rows.map(
			(r) => r.querySelector('span:not([aria-hidden="true"])') as HTMLElement
		);
		expect(done?.classList.contains('line-through')).toBe(true);
		expect(active?.classList.contains('line-through')).toBe(false);
		expect(pending?.classList.contains('line-through')).toBe(false);
		const markers = rows.map((r) => r.querySelector('span[aria-hidden="true"]') as HTMLElement);
		expect(markers[0]?.className).toContain('text-status-pass');
		expect(markers[1]?.className).toContain('text-accent-purple');
		expect(markers[2]?.className).toContain('text-text-muted');
	});

	it('renders nothing while closed', () => {
		const { target } = mountPopup({ open: false });
		expect(popupEl(target)).toBeNull();
	});

	it('the popup element carries the container signature — hosting moved to FloatingAnchorContainerPopup (Popup Shell W2)', () => {
		const { target } = mountPopup();
		const el = popupEl(target) as HTMLElement;
		expect(el.className).toContain('pointer-events-auto');
		expect(el.className).toContain('absolute');
		expect(el.className).toContain('right-full');
		expect(el.className).toContain('mr-2');
		expect(el.className).toContain('top-1/2');
		expect(el.className).toContain('overflow-y-auto');
	});

	it('caps its width against the enclosing panel column on the floor', () => {
		const column = document.createElement('div');
		column.setAttribute('data-testid', 'panel-column');
		Object.defineProperty(column, 'clientWidth', { configurable: true, value: 500 });
		document.body.appendChild(column);
		const { target, instance } = mountPopup();
		column.appendChild(target); // reparent under the column, then remount
		unmount(instance);
		const instance2 = mount(PlanPopup, {
			target,
			props: { items: PLAN, triggerEl: undefined, open: true }
		});
		flushSync();
		current = { target, instance: instance2 };
		const el = target.querySelector('[data-testid="plan-popup"]') as HTMLElement;
		expect(el.style.maxWidth).toBe('400px'); // floor(500 × 0.8)
	});
});

describe('PlanPopup — Escape', () => {
	it('closes on Escape while open', () => {
		const { target } = mountPopup();
		expect(popupEl(target)).not.toBeNull();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(popupEl(target)).toBeNull();
	});

	it('keeps open on any other key', () => {
		const { target } = mountPopup();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		flushSync();
		expect(popupEl(target)).not.toBeNull();
	});

	it('Escape while closed is inert', () => {
		const { target } = mountPopup({ open: false });
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		flushSync();
		expect(popupEl(target)).toBeNull();
	});
});

describe('PlanPopup — outside click contract', () => {
	it('a trusted click outside closes', () => {
		const { target } = mountPopup({ triggerEl: trigger() });
		trustedClick(document.body);
		expect(popupEl(target)).toBeNull();
	});

	it('an untrusted (synthetic) outside click never closes', () => {
		const { target } = mountPopup();
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(popupEl(target)).not.toBeNull();
	});

	it('a trusted click inside the popup keeps it open', () => {
		const { target } = mountPopup({ triggerEl: trigger() });
		trustedClick(target.querySelector('[data-testid="plan-popup-header"]') as HTMLElement);
		expect(popupEl(target)).not.toBeNull();
	});

	it('a trusted click on the opening toggle never closes it (the opening click bubbles here)', () => {
		const tg = trigger();
		const { target } = mountPopup({ triggerEl: tg });
		trustedClick(tg.querySelector('button') as HTMLElement);
		expect(popupEl(target)).not.toBeNull();
	});

	it('a trusted click while closed is inert', () => {
		const { target } = mountPopup({ open: false });
		trustedClick(document.body);
		expect(popupEl(target)).toBeNull();
	});

	it('closes on a trusted outside click even without a trigger element', () => {
		const { target } = mountPopup({ triggerEl: undefined });
		trustedClick(document.body);
		expect(popupEl(target)).toBeNull();
	});
});

describe('PlanPopup — plan changes after mount', () => {
	it('re-renders header totals and row glyphs/classes when the plan updates', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PlanPopupHost, {
			target,
			props: { initialItems: PLAN, triggerEl: undefined, open: true }
		});
		flushSync();
		const host = instance as unknown as { set: (next: Record<string, unknown>) => void };
		current = { target, instance };

		// the plan rewrites itself: different statuses, different total
		host.set({
			items: [
				{ content: 'rewritten step', status: 'in_progress' },
				{ content: 'finished step', status: 'completed' }
			]
		});
		flushSync();
		expect(target.querySelector('[data-testid="plan-popup-header"]')?.textContent).toContain(
			'Current Plan (1/2 done)'
		);
		let rows = [...target.querySelectorAll('[data-testid="plan-popup-row"]')];
		expect(rows.map((r) => r.getAttribute('data-status'))).toEqual(['in_progress', 'completed']);
		expect(rows.map((r) => r.querySelector('span')?.textContent)).toEqual(['◐', '●']);
		const markers = rows.map((r) => r.querySelector('span[aria-hidden="true"]') as HTMLElement);
		expect(markers[0]?.className).toContain('text-accent-purple');
		expect(markers[1]?.className).toContain('text-status-pass');

		// emptied plan: header drops to 0/0, no rows remain
		host.set({ items: [] });
		flushSync();
		expect(target.querySelector('[data-testid="plan-popup-header"]')?.textContent).toContain(
			'Current Plan (0/0 done)'
		);
		expect(target.querySelectorAll('[data-testid="plan-popup-row"]').length).toBe(0);

		// plan repopulates: rows render again
		host.set({ items: PLAN });
		flushSync();
		rows = [...target.querySelectorAll('[data-testid="plan-popup-row"]')];
		expect(rows).toHaveLength(3);
		expect(rows.some((r) => r.textContent?.includes('say done'))).toBe(true);
	});

	it('closes through the bindable open from the host side', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(PlanPopupHost, {
			target,
			props: { initialItems: PLAN, triggerEl: undefined, open: true }
		});
		flushSync();
		const host = instance as unknown as { set: (next: Record<string, unknown>) => void };
		current = { target, instance };
		expect(popupEl(target)).not.toBeNull();
		host.set({ open: false });
		flushSync();
		expect(popupEl(target)).toBeNull();
	});
});
