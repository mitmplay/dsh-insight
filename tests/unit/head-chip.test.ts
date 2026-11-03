/**
 * HeadChip unit tests — the workspace-explorer hide/show toggle
 * (2026-10-31): icon-only bordered chip whose glyph, aria-label and
 * title flip with the lane's hidden state, and whose click carries the
 * toggle intent.
 *
 * Covered arms: hidden=false (PanelLeftClose + hide label),
 * hidden=true (PanelLeftOpen + show label), and the ontoggle click
 * intent.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import HeadChip from '../../src/lib/components/workspace-file/toolbar/HeadChip.svelte';

function mountChip(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(HeadChip, { target, props: props as never });
	flushSync();
	return { target, instance };
}

describe('HeadChip — the explorer hide/show toggle', () => {
	it('renders the close glyph and hide label when the lane is visible', () => {
		const { target, instance } = mountChip();
		const btn = target.querySelector('[data-testid="explorer-toggle"]') as HTMLButtonElement;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('type')).toBe('button');
		expect(btn.querySelector('svg')).not.toBeNull();
		expect(btn.getAttribute('aria-label')).toBe('Hide explorer');
		expect(btn.getAttribute('title')).toBe('Hide explorer');
		unmount(instance);
	});

	it('renders the open glyph and show label when the lane is hidden', () => {
		const { target, instance } = mountChip({ hidden: true });
		const btn = target.querySelector('[data-testid="explorer-toggle"]') as HTMLButtonElement;
		expect(btn.querySelector('svg')).not.toBeNull();
		expect(btn.getAttribute('aria-label')).toBe('Show explorer');
		expect(btn.getAttribute('title')).toBe('Show explorer');
		unmount(instance);
	});

	it('emits the toggle intent on click', () => {
		const ontoggle = vi.fn();
		const { target, instance } = mountChip({ hidden: false, ontoggle });
		const btn = target.querySelector('[data-testid="explorer-toggle"]') as HTMLButtonElement;
		btn.click();
		flushSync();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		btn.click();
		flushSync();
		expect(ontoggle).toHaveBeenCalledTimes(2);
		unmount(instance);
	});
});
