/**
 * ControlBarTray branch coverage — companion to
 * controlbar-tray-defaults.test.ts. The defaults suite mounts with
 * ONLY the required prop; this file drives the EXPLICIT-prop arms:
 * a caller-supplied panelWidth/zoom (skipping the $bindable
 * defaults), the captions' value interpolation, and the
 * captureContainer-provided arm's title through the thin tray.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ControlBarTray from '$lib/components/panels/control-bar/ControlBarTray.svelte';

function mountTray(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ControlBarTray, { target, props: { onresizeall: vi.fn(), ...props } as never });
	flushSync();
	return { target, instance };
}

const widthCaption = (target: HTMLElement): string =>
	target.querySelector('[data-testid="controlbar-slider-width-value"]')?.textContent ?? '';

const zoomCaption = (target: HTMLElement): string =>
	target.querySelector('[data-testid="controlbar-slider-zoom-value"]')?.textContent ?? '';

const widthInput = (target: HTMLElement): HTMLInputElement =>
	target.querySelector('[data-testid="controlbar-slider-width-input"]') as HTMLInputElement;

const zoomInput = (target: HTMLElement): HTMLInputElement =>
	target.querySelector('[data-testid="controlbar-slider-zoom-input"]') as HTMLInputElement;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ControlBarTray — explicit-prop branches', () => {
	it('honors a caller-supplied panelWidth (default arm skipped, within config bounds)', () => {
		const { target, instance } = mountTray({ panelWidth: 700 });
		expect(widthInput(target).value).toBe('700');
		expect(widthCaption(target)).toBe('700px');
		unmount(instance);
	});

	it('honors a caller-supplied zoom and rounds it in the caption', () => {
		const { target, instance } = mountTray({ zoom: 1.25 });
		expect(Number(zoomInput(target).value)).toBeCloseTo(1.25);
		expect(zoomCaption(target)).toBe('125%');
		unmount(instance);
	});

	it('non-round zoom rounds through Math.round in the caption snippet', () => {
		const { target, instance } = mountTray({ zoom: 0.857 });
		expect(zoomCaption(target)).toBe('86%');
		unmount(instance);
	});

	it('a thumb move fires onresizeall with the parsed width (live cadence arm)', () => {
		const onresizeall = vi.fn<(width: number) => void>();
		const { target, instance } = mountTray({ panelWidth: 600, onresizeall });
		const input = widthInput(target);
		input.value = '720';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onresizeall).toHaveBeenCalledWith(720);
		unmount(instance);
	});

	it('captureContainer provided → capture row present with the paraglide title', () => {
		const floor = document.createElement('div');
		document.body.appendChild(floor);
		const { target, instance } = mountTray({ captureContainer: floor });
		const row = target.querySelector('[data-testid="controlbar-tray-buttons"]');
		expect(row).not.toBeNull();
		expect(row!.getAttribute('aria-label')).toBe('Floor capture');
		expect(target.querySelector('[data-testid="canvas-copy-button"]')).not.toBeNull();
		unmount(instance);
	});

	it('captureContainer null (default arm) → capture row absent', () => {
		const { target, instance } = mountTray({});
		expect(target.querySelector('[data-testid="controlbar-tray-buttons"]')).toBeNull();
		unmount(instance);
	});
});
