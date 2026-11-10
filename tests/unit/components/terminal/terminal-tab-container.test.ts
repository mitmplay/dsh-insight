/**
 * TerminalTabContainer — branch mop (Terminal Desk ADR D1): the visible
 * lane (flex, rendered, children alive) and the hidden lane (hidden
 * attribute + class, children STILL rendered — streams keep running so
 * scrollback accumulates; only visibility flips).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import TerminalTabContainerHost from './TerminalTabContainerHost.svelte';

let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function mountContainer(visible: boolean, index = 1) {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(TerminalTabContainerHost, { target: target!, props: { visible, index } });
	flushSync();
	return target!.querySelector('[data-testid="terminal-tab-container-' + index + '"]') as HTMLElement;
}

afterEach(() => {
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
});

describe('TerminalTabContainer', () => {
	it('visible lane: flex layout, data-visible true, not hidden, children rendered', () => {
		const box = mountContainer(true);
		expect(box.getAttribute('data-visible')).toBe('true');
		expect(box.getAttribute('hidden')).toBeNull();
		expect(box.className).toContain('flex');
		expect(box.classList.contains('hidden')).toBe(false);
		expect(box.querySelector('[data-testid="tab-body-marker"]')).toBeTruthy();
	});

	it('hidden lane: stays in the DOM (children alive) but visibility flips off', () => {
		const box = mountContainer(false, 3);
		expect(box).toBeTruthy(); // kept ALIVE in the DOM
		expect(box.querySelector('[data-testid="tab-body-marker"]')).toBeTruthy();
		expect(box.getAttribute('data-visible')).toBe('false');
		expect(box.getAttribute('hidden')).not.toBeNull();
		expect(box.className).toContain('hidden');
		expect(box.classList.contains('flex')).toBe(false);
	});
});
