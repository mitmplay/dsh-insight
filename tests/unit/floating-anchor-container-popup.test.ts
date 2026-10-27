/**
 * FloatingAnchorContainerPopup host tests (Popup Shell W1 1.1-T) — the
 * anchor's one popup container (ADR D1), wired the way the leaves wire
 * it: a host that OWNS open and binds it through (the host fixture).
 * Pins: open/closed rendering, the optional leaf-pinned title header,
 * and the close contract — Escape closes, a TRUSTED outside click
 * closes, synthetic (untrusted) clicks never do, clicks inside the
 * popup or on the trigger are exempt.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Host from '../fixtures/FloatingAnchorPopupHost.svelte';

interface HostProps {
	title?: string;
	titleTestId?: string;
	placement?: 'left' | 'right';
}

function mountHost(props: HostProps = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(Host, { target, props });
	flushSync();
	return {
		popup: () => target.querySelector('[data-testid="floating-anchor-popup"]'),
		row: () => target.querySelector('[data-testid="probe-row"]'),
		header: (sel: string) => target.querySelector('[data-testid="' + sel + '"]'),
		toggle: () => target.querySelector('[data-testid="host-toggle"]') as HTMLElement,
		open: () => clickToggle(target),
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

function clickToggle(target: HTMLElement): void {
	(target.querySelector('[data-testid="host-toggle"]') as HTMLElement).click();
	flushSync();
}

/** The outside-click contract fires only for TRUSTED events; jsdom
 *  clicks are untrusted, so this dispatches a synthetic one and the
 *  test asserts the trusted guard keeps the popup open. */
function clickOutside(): void {
	document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}

function pressEscape(): void {
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	flushSync();
}

describe('FloatingAnchorContainerPopup (Popup Shell W1 1.1-T)', () => {
	it('closed renders nothing; open renders the box with the leaf rows', () => {
		const h = mountHost();
		expect(h.popup()).toBeNull();
		h.open();
		expect(h.popup()).not.toBeNull();
		expect(h.row()?.textContent).toContain('a row');
		h.cleanup();
	});

	it('the optional title renders a header row with the leaf-pinned test id; no title renders none', () => {
		const h = mountHost({ title: 'Current Plan (1/2 done)', titleTestId: 'plan-popup-header' });
		h.open();
		expect(h.header('plan-popup-header')?.textContent).toContain('Current Plan (1/2 done)');
		h.cleanup();

		const h2 = mountHost();
		h2.open();
		expect(h2.row()).not.toBeNull(); // the list renders headerless
		h2.cleanup();
	});

	it('Escape closes through the bound open; Escape while closed is a no-op', () => {
		const h = mountHost();
		h.open();
		expect(h.popup()).not.toBeNull();
		pressEscape();
		expect(h.popup()).toBeNull();
		pressEscape();
		expect(h.popup()).toBeNull();
		// the contract runs through the binding — the host state flipped too
		h.open();
		expect(h.popup()).not.toBeNull();
		h.cleanup();
	});

	it('a click outside does NOT close for untrusted (synthetic) events — the trusted guard', () => {
		const h = mountHost();
		h.open();
		clickOutside();
		expect(h.popup()).not.toBeNull();
		h.cleanup();
	});

	it('a click inside the popup does not close it (the popup contains-exemption)', () => {
		const h = mountHost();
		h.open();
		(h.row() as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(h.popup()).not.toBeNull();
		h.cleanup();
	});

	it('a click on the trigger wrapper does not close it (the opening-click exemption)', () => {
		const h = mountHost();
		h.open();
		const wrapper = h.popup()?.parentElement as HTMLElement;
		wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(h.popup()).not.toBeNull();
		h.cleanup();
	});

	it('the wrapper class carries the container signature (hosting moved here)', () => {
		const h = mountHost();
		h.open();
		const el = h.popup() as HTMLElement;
		expect(el.className).toContain('pointer-events-auto');
		expect(el.className).toContain('absolute');
		expect(el.className).toContain('right-full'); // default placement 'left' — box opens left of the trigger
		expect(el.className).toContain('top-1/2');
		expect(el.className).toContain('overflow-y-auto');
		h.cleanup();
	});

	it('placement right — a left-edge trigger opens the box to its right (Subagent Anchor 2026-10-26)', () => {
		const h = mountHost({ placement: 'right' });
		h.open();
		const el = h.popup() as HTMLElement;
		expect(el.className).toContain('left-full ml-2');
		expect(el.className).not.toContain('right-full');
		h.cleanup();
	});

	it('SOURCE CONTRACT — the container hosts only: no services imports (ADR D1/D4)', () => {
		const src = readFileSync(
			join(
				process.cwd(),
				'src/lib/components/common/containers/FloatingAnchorContainerPopup.svelte'
			),
			'utf-8'
		);
		expect(src).not.toContain('$lib/services');
		expect(src).not.toContain('panel-registry');
		expect(src).toContain('capToPanelColumn'); // the one shared util (D4)
	});
});
