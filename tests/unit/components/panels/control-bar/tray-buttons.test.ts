/**
 * TrayButtons unit tests — the ControlBarTray's button row and its one
 * member: the floor canvas-capture CanvasCopyButton (capture render
 * logic itself is canvas-copy-button.test.ts; html-to-image is mocked).
 *
 * Pins:
 *  - the row mounts the capture button with the floor copy title
 *  - null container (pre-mount): click is the documented no-op
 *  - a click renders THE CONTAINER ELEMENT the page passed (the floor
 *    capture-target contract) and pays it into the clipboard
 *  - the container flows through ControlBar → ControlBarTray →
 *    TrayButtons → CanvasCopyButton (the full pass-through chain)
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlBar from '$lib/components/panels/control-bar/ControlBar.svelte';
import TrayButtons from '$lib/components/panels/control-bar/TrayButtons.svelte';
import { toBlob } from 'html-to-image';

vi.mock('html-to-image', () => ({
	toBlob: vi.fn(),
	toCanvas: vi.fn()
}));

const mockedToBlob = vi.mocked(toBlob);

function renderTrayButtons(container: HTMLElement | null): { target: HTMLElement; button: HTMLElement; unmount: () => void } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(TrayButtons, { target, props: { captureContainer: container } });
	const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLElement;
	return { target, button, unmount: () => unmount(comp) };
}

/** Advance the async capture chain (multiple awaits + 0ms toBlob timers). */
async function settle(rounds = 15): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await Promise.resolve();
	}
	flushSync();
}

const stateIcon = (target: HTMLElement): string => {
	if (target.querySelector('svg.text-status-pass')) return 'done';
	if (target.querySelector('svg.animate-spin')) return 'busy';
	return 'idle';
};

describe('TrayButtons — the tray button row', () => {
	let clipboardWrites: unknown[];

	beforeEach(() => {
		vi.clearAllMocks();
		mockedToBlob.mockResolvedValue(new Blob(['floor-png'], { type: 'image/png' }));
		clipboardWrites = [];
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { write: vi.fn(async (items: unknown[]) => void clipboardWrites.push(...items)) }
		});
		vi.stubGlobal(
			'ClipboardItem',
			class {
				payload: Record<string, Blob>;
				constructor(p: Record<string, Blob>) {
					this.payload = p;
				}
			}
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	it('mounts the group with the capture button carrying the floor copy title', () => {
		const { target, button, unmount: off } = renderTrayButtons(null);
		const row = target.querySelector('[data-testid="controlbar-tray-buttons"]') as HTMLElement;
		expect(row).not.toBeNull();
		expect(row.getAttribute('role')).toBe('group');
		expect(button.getAttribute('title')).toBe('Copy panel floor as image (Shift+Click to save)');
		expect(stateIcon(target)).toBe('idle');
		off();
	});

	it('null container: click is the documented no-op — no render, no clipboard write', async () => {
		const { target, button, unmount: off } = renderTrayButtons(null);
		button.click();
		await settle();
		expect(mockedToBlob).not.toHaveBeenCalled();
		expect(clipboardWrites).toHaveLength(0);
		expect(stateIcon(target)).toBe('idle');
		off();
	});

	it('a click renders THE PASSED CONTAINER (the floor element) and copies it', async () => {
		// The page-owned floor element (the route binds it with bind:this).
		const floor = document.createElement('div');
		const { target, button, unmount: off } = renderTrayButtons(floor);
		button.click();
		await settle();
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		expect(mockedToBlob.mock.calls[0][0]).toBe(floor);
		expect(clipboardWrites).toHaveLength(1);
		const item = clipboardWrites[0] as { payload: Record<string, Blob> };
		expect(item.payload['image/png'].type).toBe('image/png');
		expect(stateIcon(target)).toBe('done');
		off();
	});
});

describe('TrayButtons — captureContainer pass-through through ControlBar', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedToBlob.mockResolvedValue(new Blob(['floor-png'], { type: 'image/png' }));
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { write: vi.fn(async () => {}) }
		});
		vi.stubGlobal(
			'ClipboardItem',
			class {
				payload: Record<string, Blob>;
				constructor(p: Record<string, Blob>) {
					this.payload = p;
				}
			}
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	it('the container flows ControlBar → tray → button: a tray click renders the route-passed element', async () => {
		const floor = document.createElement('div');
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ControlBar, {
			target,
			props: { onresizeall: () => {}, captureContainer: floor }
		});
		// Reveal the tray (the hover trigger — ControlBar's own lifecycle).
		const bar = target.querySelector('[data-testid="controlbar"]') as HTMLElement;
		bar.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
		flushSync();
		// The tray portals to document.body (2026-10-22) — it is NOT a
		// DOM descendant of the mount target anymore.
		const button = document.body.querySelector('[data-testid="canvas-copy-button"]') as HTMLElement;
		expect(button).not.toBeNull();
		button.click();
		await settle();
		expect(mockedToBlob.mock.calls[0][0]).toBe(floor);
		unmount(comp);
	});
});
