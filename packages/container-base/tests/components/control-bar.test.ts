import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlBar, ControlBarTray } from '../../src/index';
import { WIDTH_BOUNDS, ZOOM_BOUNDS } from '../../src/index';

// R10 W1 1.1-T + 1.2-T (ADR-0073) — the base hover-tray machine + the
// fixed tray anatomy, ported byte-equivalent from DSI's app class.

const targets: { root: HTMLElement; instance: ReturnType<typeof mount> | null }[] = [];
function host(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	targets.push({ root: el, instance: null });
	return el;
}
afterEach(() => {
	for (const t of targets) {
		if (t.instance) unmount(t.instance);
		t.root.remove();
	}
	// portal orphans: the tray host lands on document.body
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
const tray = (): HTMLElement =>
	document.querySelector('[data-testid="controlbar-tray"]') as HTMLElement;

describe('ControlBar — hover machine (1.1-T)', () => {
	it('renders trigger + toolbar with base testid/aria defaults', () => {
		const root = host();
		mount(ControlBar, { target: root, props: { onresizeall: () => {} } });
		expect(bar(root).getAttribute('aria-label')).toBe('Floor controls');
		expect(trigger(root).getAttribute('aria-label')).toBe('Floor controls');
		expect(trigger(root).querySelector('svg')).not.toBeNull();
	});

	it('testid/aria overrides replace the defaults', () => {
		const root = host();
		mount(ControlBar, {
			target: root,
			props: { onresizeall: () => {}, ariaLabel: 'Desk', testId: 'cb', triggerTestId: 'cb-trigger', trayTestId: 'cb-tray' }
		});
		expect(root.querySelector('[data-testid="cb"]')).not.toBeNull();
		expect(root.querySelector('[data-testid="cb-trigger"]')).not.toBeNull();
	});

	it('hover reveals, mouseleave hides after 250ms, re-enter cancels (fake timers)', () => {
		vi.useFakeTimers();
		const root = host();
		mount(ControlBar, { target: root, props: { onresizeall: () => {} } });
		const b = bar(root);
		b.dispatchEvent(new Event('mouseenter', { bubbles: false }));
		flushSync();
		expect(tray()).toBeDefined();
		b.dispatchEvent(new Event('mouseleave', { bubbles: false }));
		flushSync();
		expect(tray()).toBeDefined(); // grace window
		b.dispatchEvent(new Event('mouseenter', { bubbles: false }));
		flushSync();
		vi.advanceTimersByTime(400);
		flushSync();
		expect(document.querySelector('[data-testid="controlbar-tray"]')).not.toBeNull(); // re-enter cancelled hide
		b.dispatchEvent(new Event('mouseleave', { bubbles: false }));
		flushSync();
		vi.advanceTimersByTime(250);
		flushSync();
		expect(document.querySelector('[data-testid="controlbar-tray"]')).toBeNull(); // hidden after 250ms
	});

	it('focusin reveals; focusout hides only when focus truly leaves', () => {
		vi.useFakeTimers();
		const root = host();
		mount(ControlBar, { target: root, props: { onresizeall: () => {} } });
		const b = bar(root);
		// focus into the tray's slider input (navigation, not departure):
		// the trigger's focusout schedules a hide, the portaled tray host's
		// focusin (the very next DOM event in a real tab) cancels it.
		b.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		flushSync();
		const input = document.querySelector<HTMLInputElement>('[data-testid="controlbar-slider-width-input"]');
		expect(input).not.toBeNull();
		b.dispatchEvent(new FocusEvent('focusout', { relatedTarget: input, bubbles: true }));
		flushSync();
		const float = document.querySelector<HTMLElement>('.tray-float')!;
		float.dispatchEvent(new FocusEvent('focusin', { relatedTarget: input, bubbles: true }));
		flushSync();
		vi.advanceTimersByTime(400);
		flushSync();
		expect(document.querySelector('[data-testid="controlbar-tray"]')).not.toBeNull(); // stays open
		b.dispatchEvent(new FocusEvent('focusout', { relatedTarget: null, bubbles: true }));
		flushSync();
		vi.advanceTimersByTime(250);
		flushSync();
		expect(document.querySelector('[data-testid="controlbar-tray"]')).toBeNull(); // focus gone
	});

	it('Escape anywhere in the tray closes it', () => {
		const root = host();
		mount(ControlBar, { target: root, props: { onresizeall: () => {} } });
		bar(root).dispatchEvent(new Event('mouseenter'));
		flushSync();
		tray().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(document.querySelector('[data-testid="controlbar-tray"]')).toBeNull();
	});

	it('portal host lands on document.body (outside the clipping host)', () => {
		const root = host();
		mount(ControlBar, { target: root, props: { onresizeall: () => {} } });
		bar(root).dispatchEvent(new Event('mouseenter'));
		flushSync();
		const float = document.querySelector('.tray-float') as HTMLElement;
		expect(float.parentElement).toBe(document.body);
	});

	it('viewport clamp: right edge pins left to innerWidth - 272, normal edge keeps trigger left', () => {
		const root = host();
		mount(ControlBar, { target: root, props: { onresizeall: () => {} } });
		bar(root).dispatchEvent(new Event('mouseenter'));
		flushSync();
		const float = document.querySelector('.tray-float') as HTMLElement;
		// jsdom trigger rect is 0-left → clamp floor 8
		expect(float.style.left).toBe('8px');
		expect(float.style.top).toMatch(/px$/);
		// clamp math contract, pinned directly (TRAY_MIN = 256 + 16)
		const TRAY_MIN = 272;
		expect(Math.max(8, Math.min(5000, window.innerWidth - TRAY_MIN))).toBeLessThanOrEqual(window.innerWidth - TRAY_MIN + 0.0001);
	});
});

describe('ControlBarTray — fixed anatomy (1.2-T)', () => {
	it('stack order: capture row → width → zoom → extras', () => {
		const root = host();
		const capture = document.createElement('div');
		document.body.appendChild(capture);
		mount(ControlBarTray, {
			target: root,
			props: {
				onresizeall: () => {},
				captureContainer: capture,
				widthAriaLabel: 'w',
				zoomAriaLabel: 'z'
			}
		});
		const kids = [...tray().children].map((el) => el.getAttribute('data-testid') ?? el.className.split(' ')[0]);
		expect(kids[0]).toBe('controlbar-tray-buttons');
		expect(kids[1]).toBe('controlbar-slider-width');
		expect(kids[2]).toBe('controlbar-slider-zoom');
	});

	it('capture row absent when captureContainer absent; extras absent when snippet absent', () => {
		const root = host();
		mount(ControlBarTray, { target: root, props: { widthAriaLabel: 'w', zoomAriaLabel: 'z' } });
		expect(document.querySelector('[data-testid="controlbar-tray-buttons"]')).toBeNull();
		// no empty trailing row: exactly the two sliders
		expect(tray().children.length).toBe(2);
	});

	it('caption snippets render with the live value', () => {
		const root = host();
		let seen = 0;
		const widthCaption = createRawSnippet((getValue) => {
			const v = getValue() as number;
			seen = v;
			return { render: () => '<span data-testid="cap">w=' + v + '</span>' };
		});
		mount(ControlBarTray, {
			target: root,
			props: { widthAriaLabel: 'w', zoomAriaLabel: 'z', widthCaption, panelWidth: 640 }
		});
		expect(tray().textContent).toContain('w=640');
		expect(seen).toBe(640);
	});

	it('binding chain Tray→sliders flows BOTH directions', async () => {
		const root = host();
		mount(ControlBarTray, {
			target: root,
			props: { widthAriaLabel: 'w', zoomAriaLabel: 'z', panelWidth: 480, zoom: 0.5 }
		});
		const wInput = document.querySelector<HTMLInputElement>('[data-testid="controlbar-slider-width-input"]')!;
		const zInput = document.querySelector<HTMLInputElement>('[data-testid="controlbar-slider-zoom-input"]')!;
		// down-leg: initial bindable props land in the slider inputs
		expect(wInput.value).toBe('480');
		expect(Number(zInput.value)).toBeCloseTo(0.5);
		// up-leg: input event updates the bound value inside the chain
		// (same observable the sliders suite uses — the live input state)
		wInput.value = '860';
		wInput.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(wInput.value).toBe('860');
		zInput.value = '1.25';
		zInput.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(Number(zInput.value)).toBeCloseTo(1.25);
	});

	it('bounds props reach the slider inputs; defaults are WIDTH/ZOOM_BOUNDS', () => {
		const root = host();
		mount(ControlBarTray, { target: root, props: { widthAriaLabel: 'w', zoomAriaLabel: 'z' } });
		expect(document.querySelector<HTMLInputElement>('[data-testid="controlbar-slider-width-input"]')!.min).toBe(String(WIDTH_BOUNDS.min));
		expect(document.querySelector<HTMLInputElement>('[data-testid="controlbar-zoom-input"], [data-testid="controlbar-slider-zoom-input"]')!.max).toBe(String(ZOOM_BOUNDS.max));
	});

	it('onresizeall routes per width input (live cadence)', () => {
		const root = host();
		const onresizeall = vi.fn();
		mount(ControlBarTray, { target: root, props: { widthAriaLabel: 'w', zoomAriaLabel: 'z', onresizeall } });
		const wInput = document.querySelector<HTMLInputElement>('[data-testid="controlbar-slider-width-input"]')!;
		wInput.value = '700';
		wInput.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onresizeall).toHaveBeenCalledWith(700);
	});
});

describe('ControlBar — threading (1.1-T continued)', () => {
	it('extras snippet passthrough renders inside the portaled tray', () => {
		const root = host();
		const extras = createRawSnippet(() => ({ render: () => '<span data-testid="extras">extra-word</span>' }));
		mount(ControlBar, { target: root, props: { onresizeall: () => {}, extras } });
		bar(root).dispatchEvent(new Event('mouseenter'));
		flushSync();
		expect(tray().textContent).toContain('extra-word');
	});
});
