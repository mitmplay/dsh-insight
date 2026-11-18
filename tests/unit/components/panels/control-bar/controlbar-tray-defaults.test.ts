/**
 * ControlBarTray unit tests — the DSI THIN TRAY (ADR-0073 W2) mounted
 * directly (the parent ControlBar always passes panelWidth/zoom, so the
 * tray's $bindable DEFAULTS have never run under test).
 *
 * The anatomy is the BASE contract now (R10 W1, prop-gated capture row):
 *   - capture row ABSENT while captureContainer is null (pre-mount —
 *     the W2 re-pin: the base row is prop-gated, ADR-0073 D2; the old
 *     always-rendered button row is retired)
 *   - capture row PRESENT with the paraglide copy title once the floor
 *     element flows in
 *   - extras = AddPanel renders after the sliders (fixed anatomy:
 *     capture → width → zoom → extras) — behavior identical, order is
 *     ADR-0073 D2's
 *   - the omitted width/zoom land on the panel-prefs defaults and the
 *     sliders mirror the config bounds through the thin tray
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ControlBarTray from '$lib/components/panels/control-bar/ControlBarTray.svelte';
import {
	PANEL_DEFAULT_WIDTH,
	PANEL_DEFAULT_ZOOM,
	PANEL_MAX_WIDTH,
	PANEL_MAX_ZOOM,
	PANEL_MIN_WIDTH,
	PANEL_MIN_ZOOM
} from '$lib/utils/panel-prefs';

/** Mount with ONLY the required prop — both $bindable defaults must apply. */
function mountTray(captureContainer: HTMLElement | null = null) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onresizeall = vi.fn<(width: number) => void>();
	const instance = mount(ControlBarTray, { target, props: { onresizeall, captureContainer } });
	flushSync();
	return { target, instance, onresizeall };
}

const widthInput = (target: HTMLElement): HTMLInputElement =>
	target.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement;

const widthCaption = (target: HTMLElement): string =>
	target.querySelector('[data-testid="controlbar-slider-width-value"]')?.textContent ?? '';

const zoomInput = (target: HTMLElement): HTMLInputElement =>
	target.querySelector('[data-testid="controlbar-slider-zoom-input"]') as HTMLInputElement;

const zoomCaption = (target: HTMLElement): string =>
	target.querySelector('[data-testid="controlbar-slider-zoom-value"]')?.textContent ?? '';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ControlBarTray — thin-tray contract (ADR-0073 W2)', () => {
	it('mounts the tray group with the floor controls and AddPanel in extras', () => {
		const { target, instance } = mountTray();
		const tray = target.querySelector('[data-testid="controlbar-tray"]') as HTMLElement;
		expect(tray).not.toBeNull();
		expect(tray.getAttribute('role')).toBe('group');
		expect(tray.getAttribute('aria-label')).toBe('Floor controls');
		expect(target.querySelector('[data-testid="controlbar-add-input"]')).not.toBeNull();
		expect(widthInput(target)).not.toBeNull();
		expect(zoomInput(target)).not.toBeNull();
		// Fixed anatomy: width → zoom → extras(AddPanel) — the extras
		// snippet is the tray's LAST row (ADR-0073 D2).
		const addInput = target.querySelector('[data-testid="controlbar-add-input"]') as HTMLElement;
		expect(widthInput(target).compareDocumentPosition(zoomInput(target)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(zoomInput(target).compareDocumentPosition(addInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		unmount(instance);
	});

	it('capture row ABSENT while captureContainer is null (prop-gated, ADR-0073 D2)', () => {
		const { target, instance } = mountTray(null);
		expect(target.querySelector('[data-testid="controlbar-tray-buttons"]')).toBeNull();
		expect(target.querySelector('[data-testid="canvas-copy-button"]')).toBeNull();
		unmount(instance);
	});

	it('capture row PRESENT with the floor copy title once the container flows in', () => {
		const floor = document.createElement('div');
		document.body.appendChild(floor);
		const { target, instance } = mountTray(floor);
		const row = target.querySelector('[data-testid="controlbar-tray-buttons"]') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.getAttribute('aria-label')).toBe('Floor capture');
		const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLElement;
		expect(button.getAttribute('title')).toBe('Copy panel floor as image (Shift+Click to save)');
		unmount(instance);
	});

	it('the omitted width prop lands on PANEL_DEFAULT_WIDTH with the paraglide caption', () => {
		const { target, instance } = mountTray();
		expect(widthCaption(target)).toBe(`${PANEL_DEFAULT_WIDTH}px`);
		expect(widthInput(target).value).toBe(String(PANEL_DEFAULT_WIDTH));
		unmount(instance);
	});

	it('the omitted zoom prop lands on PANEL_DEFAULT_ZOOM', () => {
		const { target, instance } = mountTray();
		expect(zoomCaption(target)).toBe(`${Math.round(PANEL_DEFAULT_ZOOM * 100)}%`);
		expect(Number(zoomInput(target).value)).toBeCloseTo(PANEL_DEFAULT_ZOOM);
		unmount(instance);
	});

	it('the sliders mirror the config bounds (panel-prefs fallbacks, no config loaded)', () => {
		const { target, instance } = mountTray();
		expect(widthInput(target).min).toBe(String(PANEL_MIN_WIDTH));
		expect(widthInput(target).max).toBe(String(PANEL_MAX_WIDTH));
		expect(zoomInput(target).min).toBe(String(PANEL_MIN_ZOOM));
		expect(zoomInput(target).max).toBe(String(PANEL_MAX_ZOOM));
		unmount(instance);
	});

	it('width commits route through the tray on every thumb move (live cadence)', () => {
		const { target, onresizeall, instance } = mountTray();
		const input = widthInput(target);
		input.value = '800';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onresizeall).toHaveBeenCalledWith(800);
		unmount(instance);
	});
});
