import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlaygroundPage from '../../playground/src/routes/+page.svelte';

// R10 W3 3.1-T (ADR-0073) — the named-second-consumer proof: the
// playground mounts the BASE hover-tray machine with its own words,
// its own bounds, its own floor capture target, and NO extras.

const targets: { root: HTMLElement; instance: ReturnType<typeof mount> | null }[] = [];

function mountPage(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	const instance = mount(PlaygroundPage, { target: el });
	targets.push({ root: el, instance });
	return el;
}

afterEach(() => {
	for (const t of targets) {
		if (t.instance) unmount(t.instance);
		t.root.remove();
	}
	for (const el of [...document.body.children]) {
		if (el.classList.contains('tray-float')) el.remove();
	}
	targets.length = 0;
	localStorage.clear();
});

const bar = (root: HTMLElement): HTMLElement =>
	root.querySelector('[data-testid="pg-controlbar"]') as HTMLElement;
const tray = (): HTMLElement | null => document.querySelector('[data-testid="pg-controlbar-tray"]');

function open(root: HTMLElement): HTMLElement {
	bar(root).dispatchEvent(new Event('mouseenter'));
	flushSync();
	return document.querySelector('.tray-float') as HTMLElement;
}

const widthInputSel = '[data-testid="pg-controlbar-slider-width-input"]';

describe('playground ControlBar mount (3.1-T, ADR-0073 W3)', () => {
	it('hover opens the tray; the tray carries the sliders; leave + grace closes', () => {
		vi.useFakeTimers();
		const root = mountPage();
		const float = open(root);
		expect(tray()).not.toBeNull();
		expect(float.querySelector(widthInputSel)).not.toBeNull();
		expect(float.querySelector('[data-testid="pg-controlbar-slider-zoom-input"]')).not.toBeNull();
		const b = bar(root);
		b.dispatchEvent(new Event('mouseleave'));
		vi.advanceTimersByTime(250);
		flushSync();
		expect(tray()).toBeNull();
	});

	it('playground bounds reach the width slider (280..1400, the demo band)', () => {
		const root = mountPage();
		open(root);
		const input = document.querySelector<HTMLInputElement>(widthInputSel) as HTMLInputElement;
		expect(input.min).toBe('280');
		expect(input.max).toBe('1400');
	});

	it('width thumb move syncs ALL pane widths (the onresizeall preset)', () => {
		const root = mountPage();
		open(root);
		const input = document.querySelector<HTMLInputElement>(widthInputSel) as HTMLInputElement;
		input.value = '900';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as { panelWidth?: number };
		expect(blob.panelWidth).toBe(900);
	});

	it('NO AddPanel and NO empty extras row in the playground tray', () => {
		const root = mountPage();
		open(root);
		expect(document.querySelector('[data-testid="controlbar-add-input"]')).toBeNull();
		expect(document.querySelector('[data-testid="pg-controlbar-add-input"]')).toBeNull();
		const trayEl = tray() as HTMLElement;
		const kids = [...trayEl.children].map((c) => c.getAttribute('data-testid'));
		expect(kids).toEqual([
			'pg-controlbar-tray-buttons',
			'pg-controlbar-slider-width',
			'pg-controlbar-slider-zoom'
		]);
	});

	it('the capture row targets the PLAYGROUND floor element', () => {
		const root = mountPage();
		open(root);
		expect(document.querySelector('[data-testid="pg-controlbar-tray-buttons"]')).not.toBeNull();
		expect(root.querySelector('.floor')).not.toBeNull();
	});

	// R10 fix (operator 2026-11-19): the FLOOR renders the upstairs set only —
	// the R8 slot iterated demoPanes, so resting panes never left the floor
	// while the tray correctly showed one row (the operator's divergence).
	it('fresh desk: the floor shows ONLY the upstairs pane (resting excluded)', () => {
		const root = mountPage();
		expect(root.querySelectorAll('.pane-body').length).toBe(1);
		const upstairsRows = root.querySelectorAll('[data-testid="pg-tray-upstairs-list"] [data-testid^="pg-tray-upstairs-"]').length;
		expect(upstairsRows).toBe(1);
	});

	it('promoting a resting pane grows the floor to two and the tray follows', () => {
		const root = mountPage();
		open(root); // tray content needs the portaled host
		const row = document.querySelector('[data-testid="pg-tray-resting-scheduler"]') as HTMLElement;
		row.click();
		flushSync();
		expect(root.querySelectorAll('.pane-body').length).toBe(2);
		expect(root.querySelectorAll('[data-testid="pg-tray-upstairs-list"] [data-testid^="pg-tray-upstairs-"]').length).toBe(2);
	});

	// R10 SC#1 fix 4 (operator 2026-11-19): a pure SELECTION change persists —
	// refresh keeps the clicked row, not the last width-commit's selection.
	it('clicking an upstairs row persists the new selection (refresh-proof)', () => {
		const root = mountPage();
		open(root);
		// fresh desk: Notes selected + Scheduler/Sessions resting; promote
		// Scheduler first so BOTH are upstairs, then click Notes
		(document.querySelector('[data-testid="pg-tray-resting-scheduler"]') as HTMLElement).click();
		flushSync();
		(document.querySelector('[data-testid="pg-tray-upstairs-notes"]') as HTMLElement).click();
		flushSync();
		const blob = JSON.parse(localStorage.getItem('pg-panels') ?? '{}') as { selectedPanelId?: string };
		expect(blob.selectedPanelId).toBe('notes');
	});
});
