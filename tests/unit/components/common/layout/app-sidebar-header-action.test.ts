/**
 * AppSidebarHeaderAction unit tests — the expanded rail's header action
 * cluster (add-workspace is AppSidebar's; here: canvas copy, collapse,
 * and the ControlBar mount site).
 *
 * Branch-coverage driven (the file's worst branches):
 *  - onToggleCollapse provided vs omitted (the optional-call else arm)
 *  - onresizeall provided (threaded through ControlBar's tray width
 *    slider) vs omitted (the ?? fallback — tray opens, no crash)
 *  - captureContainer default null (CanvasCopyButton's documented
 *    no-op — no html-to-image call) vs provided (the exact container
 *    is the capture target; html-to-image mocked, app-sidebar.test.ts
 *    pattern)
 *  - trayContainer threads to ControlBar → tray's canvas-copy button
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppSidebarHeaderAction from '$lib/components/common/layout/AppSidebarHeaderAction.svelte';
import { toBlob } from 'html-to-image';

vi.mock('html-to-image', () => ({ toBlob: vi.fn(), toCanvas: vi.fn() }));

const mockedToBlob = vi.mocked(toBlob);

/** Multi-await settle for click → async copy chains. */
async function settle(rounds = 8): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function mountHeader(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(AppSidebarHeaderAction, { target, props });
	return { target, instance };
}

/** Open the ControlBar tray: click the gear trigger, the tray portals
 *  to document.body (ControlBar's use:portal). */
function openTray(target: HTMLElement): HTMLElement {
	const trigger = target.querySelector('[data-testid="controlbar-trigger"]') as HTMLButtonElement;
	expect(trigger).not.toBeNull();
	trigger.click();
	flushSync();
	const tray = document.body.querySelector('[data-testid="controlbar-tray"]') as HTMLElement;
	expect(tray).not.toBeNull();
	return tray;
}

function stubClipboard(): { writes: unknown[] } {
	const writes: unknown[] = [];
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { write: vi.fn(async (items: unknown[]) => void writes.push(...items)) }
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
	return { writes };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

// restoreAllMocks does not clear plain vi.fn() call history — the mocked
// html-to-image calls must not leak between tests.
beforeEach(() => {
	mockedToBlob.mockClear();
});

// The Subagent Anchor mount Wave-5 block is RETIRED (2026-10-26): the
// anchor moved to the conversation page's FloatingAnchor stack (ADR D1
// placement revision). Its coverage lives in subagent-anchor.test.ts.

describe('AppSidebarHeaderAction — collapse button', () => {
	it('onToggleCollapse provided: clicking fires it exactly once', () => {
		const onToggleCollapse = vi.fn();
		const { target, instance } = mountHeader({ onToggleCollapse });
		const collapse = target.querySelector(
			'button[aria-label="Collapse sidebar"]'
		) as HTMLButtonElement;
		expect(collapse).not.toBeNull();
		collapse.click();
		flushSync();
		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('onToggleCollapse omitted: clicking is a safe no-op (no throw)', () => {
		const { target, instance } = mountHeader();
		const collapse = target.querySelector(
			'button[aria-label="Collapse sidebar"]'
		) as HTMLButtonElement;
		expect(() => {
			collapse.click();
			flushSync();
		}).not.toThrow();
		unmount(instance);
	});
});

describe('AppSidebarHeaderAction — ControlBar onresizeall', () => {
	it('onresizeall provided: the tray width slider reports through it', () => {
		const onresizeall = vi.fn();
		const { target, instance } = mountHeader({ onresizeall });
		const tray = openTray(target);
		const input = tray.querySelector(
			'[data-testid="controlbar-slider-width-input"]'
		) as HTMLInputElement;
		expect(input).not.toBeNull();
		input.value = '600';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onresizeall).toHaveBeenCalledWith(600);
		unmount(instance);
	});

	it('onresizeall omitted: the ?? fallback mounts, the tray opens and slides without crashing', () => {
		const { target, instance } = mountHeader();
		const tray = openTray(target);
		const input = tray.querySelector(
			'[data-testid="controlbar-slider-width-input"]'
		) as HTMLInputElement;
		expect(() => {
			input.value = '520';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
		}).not.toThrow();
		unmount(instance);
	});
});

describe('AppSidebarHeaderAction — header CanvasCopyButton captureContainer', () => {
	it('default null: click is the documented no-op — html-to-image is never called', async () => {
		const { writes } = stubClipboard();
		const { target, instance } = mountHeader();
		const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		expect(button).not.toBeNull();
		button.click();
		await settle();
		expect(mockedToBlob).not.toHaveBeenCalled();
		expect(writes).toHaveLength(0);
		unmount(instance);
	});

	it('captureContainer provided: click copies THAT exact container', async () => {
		const { writes } = stubClipboard();
		mockedToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
		const capture = document.createElement('div');
		const { target, instance } = mountHeader({ captureContainer: capture });
		const button = target.querySelector('[data-testid="canvas-copy-button"]') as HTMLButtonElement;
		button.click();
		await settle();
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		expect(mockedToBlob.mock.calls[0][0]).toBe(capture);
		expect(writes).toHaveLength(1);
		unmount(instance);
	});
});

describe('AppSidebarHeaderAction — trayContainer threading', () => {
	it('trayContainer flows to ControlBar → the tray canvas-copy captures that exact element', async () => {
		const { writes } = stubClipboard();
		mockedToBlob.mockResolvedValue(new Blob(['floor-png'], { type: 'image/png' }));
		const floor = document.createElement('div');
		const { target, instance } = mountHeader({ trayContainer: floor });
		const tray = openTray(target);
		// The tray's own capture button (TrayButtons row), portaled to body.
		const trayCopy = document.body.querySelector(
			'.tray-float [data-testid="canvas-copy-button"]'
		) as HTMLButtonElement;
		expect(trayCopy).not.toBeNull();
		trayCopy.click();
		await settle();
		expect(mockedToBlob).toHaveBeenCalledTimes(1);
		expect(mockedToBlob.mock.calls[0][0]).toBe(floor);
		expect(writes).toHaveLength(1);
		unmount(instance);
	});
});
