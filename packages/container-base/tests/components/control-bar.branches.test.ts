import { createRawSnippet, flushSync, mount, unmount, type Snippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlBar, ControlBarTray } from '../../src/index';
import { WIDTH_BOUNDS, ZOOM_BOUNDS } from '../../src/index';

// COV-CONTROLBAR — branch completion for the hover-tray pair: paths
// control-bar.test.ts leaves open (tray-snippet override, trigger click,
// non-Escape keydown, Escape-with-pending-timer, focusout to an outside
// Node, and ControlBarTray's aria fallbacks + zoomCaption + direct extras).

const targets: { root: HTMLElement; instance: ReturnType<typeof mount> | null }[] = [];
function host(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	targets.push({ root: el, instance: null });
	return el;
}
function mountBar(props: Record<string, unknown> = {}): HTMLElement {
	const root = host();
	targets[targets.length - 1].instance = mount(ControlBar, { target: root, props });
	return root;
}
afterEach(() => {
	for (const t of targets) {
		if (t.instance) unmount(t.instance);
		t.root.remove();
	}
	for (const el of [...document.body.children]) {
		if (el.classList.contains('tray-float')) el.remove();
	}
	vi.useRealTimers();
	targets.length = 0;
});

const bar = (root: HTMLElement): HTMLElement =>
	root.querySelector('[data-testid="controlbar"]') as HTMLElement;
const trigger = (root: HTMLElement): HTMLElement =>
	root.querySelector('[data-testid="controlbar-trigger"]') as HTMLElement;
const tray = (): HTMLElement | null =>
	document.querySelector('[data-testid="controlbar-tray"]');

describe('ControlBar — uncovered branches', () => {
	it('trigger click reveals (onclick path, not just hover)', () => {
		const root = mountBar();
		trigger(root).click();
		flushSync();
		expect(tray()).not.toBeNull();
		expect(trigger(root).getAttribute('aria-expanded')).toBe('true');
	});

	it('tray snippet override renders INSTEAD of the default ControlBarTray', () => {
		const override = createRawSnippet(() => ({
			render: () => '<div data-testid="custom-tray-body">thin-shell</div>'
		}));
		const root = mountBar({ tray: override });
		bar(root).dispatchEvent(new Event('mouseenter'));
		flushSync();
		expect(document.querySelector('[data-testid="custom-tray-body"]')).not.toBeNull();
		// the default tray body is not mounted in override mode
		expect(tray()).toBeNull();
	});

	it('non-Escape keydown does NOT close the tray', () => {
		const root = mountBar();
		bar(root).dispatchEvent(new Event('mouseenter'));
		flushSync();
		tray()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		flushSync();
		expect(tray()).not.toBeNull();
	});

	it('Escape with a pending hide timer closes NOW and cancels the timer', () => {
		vi.useFakeTimers();
		const root = mountBar();
		const b = bar(root);
		b.dispatchEvent(new Event('mouseenter'));
		flushSync();
		b.dispatchEvent(new Event('mouseleave')); // schedules the 250ms hide
		flushSync();
		tray()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(tray()).toBeNull();
		// the pending timer was cleared: advancing must not change state
		vi.advanceTimersByTime(400);
		flushSync();
		expect(tray()).toBeNull();
	});

	it('focusout to an outside Node (contained=false branch) schedules the hide', () => {
		vi.useFakeTimers();
		const root = mountBar();
		const b = bar(root);
		b.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		const outsider = document.createElement('button');
		document.body.appendChild(outsider);
		// focus moves to a real Node OUTSIDE the bar: departure, not navigation
		b.dispatchEvent(new FocusEvent('focusout', { relatedTarget: outsider, bubbles: true }));
		flushSync();
		expect(tray()).not.toBeNull(); // grace window
		vi.advanceTimersByTime(250);
		flushSync();
		expect(tray()).toBeNull();
		outsider.remove();
	});

	it('re-enter cancel covers reveal() with a live timer from the TRAY host', () => {
		vi.useFakeTimers();
		const root = mountBar();
		const b = bar(root);
		b.dispatchEvent(new Event('mouseenter'));
		flushSync();
		const float = document.querySelector('.tray-float') as HTMLElement;
		b.dispatchEvent(new Event('mouseleave'));
		flushSync();
		// hovering the portaled TRAY itself cancels the pending hide
		float.dispatchEvent(new Event('mouseenter'));
		flushSync();
		vi.advanceTimersByTime(400);
		flushSync();
		expect(tray()).not.toBeNull();
	});
});

describe('ControlBarTray — uncovered branches', () => {
	it('omitted aria labels fall back to empty string (fallback branches)', () => {
		const root = host();
		targets[targets.length - 1].instance = mount(ControlBarTray, { target: root, props: {} });
		const w = document.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement;
		const z = document.querySelector('[data-testid="controlbar-slider-zoom-input"]') as HTMLInputElement;
		expect(w.getAttribute('aria-label')).toBe('');
		expect(z.getAttribute('aria-label')).toBe('');
	});

	it('zoomCaption snippet renders with the live zoom value', () => {
		const root = host();
		const zoomCaption: Snippet<[number]> = createRawSnippet((getValue) => {
			const v = getValue() as number;
			return { render: () => '<span data-testid="zcap">z=' + v + '</span>' };
		});
		targets[targets.length - 1].instance = mount(ControlBarTray, { target: root, props: { zoomCaption, zoom: 1.5 } });
		expect(tray()!.textContent).toContain('z=1.5');
	});

	it('extras snippet renders directly on the tray (true branch on Tray itself)', () => {
		const root = host();
		const extras = createRawSnippet(() => ({
			render: () => '<span data-testid="tray-extras">extra</span>'
		}));
		targets[targets.length - 1].instance = mount(ControlBarTray, { target: root, props: { extras } });
		expect(tray()!.querySelector('[data-testid="tray-extras"]')).not.toBeNull();
	});

	it('capture row aria/testid overrides land; captureMode passes through', () => {
		const root = host();
		const capture = document.createElement('div');
		document.body.appendChild(capture);
		targets[targets.length - 1].instance = mount(ControlBarTray, {
			target: root,
			props: {
				captureContainer: capture,
				captureTitle: 'Copy floor',
				captureMode: 'full',
				captureRowLabel: 'Snapshot',
				captureRowTestId: 'my-capture-row'
			}
		});
		const row = document.querySelector('[data-testid="my-capture-row"]') as HTMLElement;
		expect(row.getAttribute('aria-label')).toBe('Snapshot');
		const btn = row.querySelector('.cb-capture-btn') as HTMLElement;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('title')).toBe('Copy floor');
		capture.remove();
	});

	it('width bounds overrides reach the inputs (non-default branch)', () => {
		const root = host();
		targets[targets.length - 1].instance = mount(ControlBarTray, {
			target: root,
			props: { widthMin: 100, widthMax: 500, widthStep: 10, zoomMin: 0.2, zoomMax: 3, zoomStep: 0.1 }
		});
		const w = document.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement;
		const z = document.querySelector('[data-testid="controlbar-slider-zoom-input"]') as HTMLInputElement;
		expect([w.min, w.max, w.step]).toEqual(['100', '500', '10']);
		expect([z.min, z.max, z.step]).toEqual(['0.2', '3', '0.1']);
		// and the WIDTH/ZOOM_BOUNDS constants the defaults derive from
		expect(WIDTH_BOUNDS.min).toBeLessThan(WIDTH_BOUNDS.max);
		expect(ZOOM_BOUNDS.min).toBeLessThan(ZOOM_BOUNDS.max);
	});

	it('scheduleHide re-entry while a hide is pending clears the previous timer', () => {
		vi.useFakeTimers();
		const root = mountBar();
		const b = bar(root);
		b.dispatchEvent(new Event('mouseenter'));
		flushSync();
		b.dispatchEvent(new Event('mouseleave')); // first schedule — timer pending
		flushSync();
		b.dispatchEvent(new Event('mouseleave')); // re-entry: the hideTimer !== null TRUE arm
		flushSync();
		vi.advanceTimersByTime(250);
		flushSync();
		expect(tray()).toBeNull();
	});

	it('host focusout staying INSIDE the bar does not schedule a hide', () => {
		vi.useFakeTimers();
		const root = mountBar();
		const b = bar(root);
		b.dispatchEvent(new Event('mouseenter'));
		flushSync();
		// relatedTarget is a Node that IS contained → the if's false arm
		b.dispatchEvent(new FocusEvent('focusout', { relatedTarget: trigger(root), bubbles: true }));
		flushSync();
		vi.advanceTimersByTime(400);
		flushSync();
		expect(tray()).not.toBeNull();
	});

	it('tray-float focusout arms: null target hides, outside Node hides, inside stays', () => {
		vi.useFakeTimers();
		const root = mountBar();
		const b = bar(root);
		b.dispatchEvent(new Event('mouseenter'));
		flushSync();
		// arm 1: relatedTarget null → !(null instanceof Node) true → hide
		(document.querySelector('.tray-float') as HTMLElement)
			.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null, bubbles: true }));
		flushSync();
		vi.advanceTimersByTime(250);
		flushSync();
		expect(tray()).toBeNull();
		// arm 2: relatedTarget is a Node but NOT contained → hide
		b.dispatchEvent(new Event('mouseenter'));
		flushSync();
		(document.querySelector('.tray-float') as HTMLElement)
			.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body, bubbles: true }));
		flushSync();
		vi.advanceTimersByTime(250);
		flushSync();
		expect(tray()).toBeNull();
		// arm 3: relatedTarget is a contained Node → the if's false arm → stays open
		b.dispatchEvent(new Event('mouseenter'));
		flushSync();
		// arm 3: relatedTarget is a Node CONTAINED by the float (tabbing from
		// the float into the tray body is navigation, not departure)
		(document.querySelector('.tray-float') as HTMLElement)
			.dispatchEvent(new FocusEvent('focusout', { relatedTarget: tray(), bubbles: true }));
		flushSync();
		vi.advanceTimersByTime(400);
		flushSync();
		expect(tray()).not.toBeNull();
	});
});

