/**
 * SliderZoom unit tests — the zoom control mounted DIRECTLY. The tray
 * suite (controlbar-tray-defaults.test.ts) only ever reaches SliderZoom
 * through ControlBarTray, which always passes zoom, so the component's
 * own $bindable default (PANEL_DEFAULT_ZOOM), the config-bounds mirror
 * (appConfig().panel), and the Math.round caption rendering have no
 * direct pins. This file mounts the component itself.
 */

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SliderZoom from '$lib/components/panels/control-bar/SliderZoom.svelte';
import {
	PANEL_DEFAULT_ZOOM,
	PANEL_MAX_ZOOM,
	PANEL_MIN_ZOOM
} from '$lib/utils/panel-prefs';

function mountZoom(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// mount's returned props proxy carries $bindable writes back, so a
	// thumb move is observable on the props object.
	const instance = mount(SliderZoom, { target, props });
	flushSync();
	return { target, instance, props };
}

const zoomInput = (target: HTMLElement): HTMLInputElement =>
	target.querySelector('[data-testid="controlbar-slider-zoom-input"]') as HTMLInputElement;

const zoomCaption = (target: HTMLElement): string =>
	target.querySelector('[data-testid="controlbar-slider-zoom-value"]')?.textContent ?? '';

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SliderZoom — defaults', () => {
	it('the omitted zoom prop lands on PANEL_DEFAULT_ZOOM (caption + thumb)', () => {
		const { target, instance } = mountZoom();
		expect(zoomCaption(target)).toBe(Math.round(PANEL_DEFAULT_ZOOM * 100) + '%');
		expect(zoomInput(target).value).toBe(String(PANEL_DEFAULT_ZOOM));
		unmount(instance);
	});

	it('the slider mirrors the config bounds (min/maxZoom) and fine step', () => {
		const { target, instance } = mountZoom();
		expect(Number(zoomInput(target).min)).toBe(PANEL_MIN_ZOOM);
		expect(Number(zoomInput(target).max)).toBe(PANEL_MAX_ZOOM);
		expect(zoomInput(target).type).toBe('range');
		expect(Number(zoomInput(target).step)).toBe(0.001);
		expect(zoomInput(target).getAttribute('aria-label')).toBe('Floor zoom');
		unmount(instance);
	});
});

describe('SliderZoom — bound zoom prop', () => {
	it('a supplied zoom renders its caption and thumb value', () => {
		const { target, instance } = mountZoom({ zoom: 0.5 });
		expect(zoomCaption(target)).toBe('50%');
		expect(zoomInput(target).value).toBe('0.5');
		unmount(instance);
	});

	it('caption uses Math.round — a fractional zoom never shows a stray decimal', () => {
		const { target, instance } = mountZoom({ zoom: 0.3333 });
		expect(zoomCaption(target)).toBe('33%');
		unmount(instance);
	});

	it('a thumb move flows live into the bound zoom (route-owned $bindable contract)', () => {
		const { target, instance, props } = mountZoom({ zoom: 0.25 });
		const input = zoomInput(target);
		input.value = '1.2';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		// The $bindable write is observable through the component: the
		// caption (rendered from `zoom`) follows the thumb live — the exact
		// contract the route's PanelsZoom persistence relies on.
		expect(zoomCaption(target)).toBe('120%');
		expect(input.value).toBe('1.2');
		unmount(instance);
	});
});
