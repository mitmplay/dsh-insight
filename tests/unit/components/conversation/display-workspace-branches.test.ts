/**
 * DisplayWorkspace branch tests (Wave D coverage mop).
 *
 * explorer-wiring.test.ts pins the click chain (onOpenExplorer present,
 * unregistered/ghost default). This file covers the branches it leaves
 * open: the no-workspace render, the REGISTERED chip (title-first label,
 * non-ghost, inert style arm), the blank-title fallback arm inside
 * workspaceDisplayLabel, and the header geometry custom properties.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DisplayWorkspace from '$lib/components/conversation/header/DisplayWorkspace.svelte';
import type { DsiWorkspaceSummary } from '$lib/types';

const registered: DsiWorkspaceSummary[] = [
	{ workspaceId: 'w1', title: 'Harness', path: '/ws/harness', sessionIds: ['s1'] }
];

function mountDisplay(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DisplayWorkspace, {
		target,
		props: { workspace: '/ws/harness', workspaces: registered, ...props }
	});
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

function chipOf(target: HTMLElement): HTMLElement {
	return target.querySelector<HTMLElement>('[data-testid="session-workspace"]')!;
}

describe('DisplayWorkspace — render branches (Wave D)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('no workspace → renders nothing (the {#if workspace} false arm)', () => {
		const view = mountDisplay({ workspace: null });
		expect(view.target.querySelector('[data-testid="session-workspace"]')).toBeNull();
		expect(view.target.textContent?.trim()).toBe('');
		view.cleanup();
	});

	it('registered workspace → title-first label, NOT ghost, inert style arm', () => {
		const view = mountDisplay();
		const chip = chipOf(view.target);
		expect(chip.querySelector<HTMLElement>('.chip-label')?.textContent).toBe('Harness');
		expect(chip.classList.contains('ghost')).toBe(false);
		// No onOpenExplorer → the cursor-pointer arm of the style literal
		// stays off, and no click handler is forwarded (header chip inert).
		expect(chip.getAttribute('style')).not.toContain('cursor');
		expect(chip.onclick).toBeNull();
		// Header geometry: the host owns roomier padding / no width cap.
		expect(chip.getAttribute('style')).toContain('--wsc-max-width: none');
		// Tooltip is the full path.
		expect(chip.getAttribute('title')).toBe('/ws/harness');
		view.cleanup();
	});

	it('unregistered workspace → basename fallback label + ghost class', () => {
		const view = mountDisplay({ workspace: '/ws/gone', workspaces: [] });
		const chip = chipOf(view.target);
		expect(chip.querySelector<HTMLElement>('.chip-label')?.textContent).toBe('gone');
		expect(chip.classList.contains('ghost')).toBe(true);
		view.cleanup();
	});

	it('blank registry title → falls back to the basename while still registered', () => {
		const view = mountDisplay({ workspaces: [{ ...registered[0], title: '   ' }] });
		const chip = chipOf(view.target);
		// workspaceDisplayLabel's trim-empty arm → basename label…
		expect(chip.querySelector<HTMLElement>('.chip-label')?.textContent).toBe('harness');
		// …but isRegisteredWorkspace matches on PATH, so no ghost cue.
		expect(chip.classList.contains('ghost')).toBe(false);
		view.cleanup();
	});

	it('onOpenExplorer present → pointer cursor arm + the click forwards', () => {
		const onOpenExplorer = vi.fn();
		const view = mountDisplay({ onOpenExplorer });
		const chip = chipOf(view.target);
		expect(chip.getAttribute('style')).toContain('cursor: pointer');
		chip.click();
		flushSync();
		expect(onOpenExplorer).toHaveBeenCalledTimes(1);
		view.cleanup();
	});
});
