/**
 * SidebarOpenPanelHeader unit tests — the pinned-panel group title's
 * focused-name chip (extracted from SidebarOpenPanels 2026-09-02).
 *
 * Pins: a named panel renders the chip with its label and the row's
 * SessionStatus glyph; a null name renders NO chip (the bare
 * `Focused - ` stem); the dead tint and the running bars land on the
 * chip the host passes through.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SidebarOpenPanelHeader from '../../src/lib/components/sessions/SidebarOpenPanelHeader.svelte';

let instance: Record<string, unknown> | null = null;
let host: HTMLElement | null = null;

function mountChip(props: { name: string | null; dead?: boolean; running?: boolean }): HTMLElement {
	host = document.createElement('div');
	document.body.appendChild(host);
	instance = mount(SidebarOpenPanelHeader, { target: host, props });
	flushSync();
	return host;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	host?.remove();
	host = null;
});

describe('SidebarOpenPanelHeader — focused-name chip', () => {
	it('renders the chip with the name and a status glyph', () => {
		const h = mountChip({ name: 'Research thread' });
		const chip = h.querySelector('[data-testid="sidebar-panel-group-chip"]');
		expect(chip).not.toBeNull();
		expect(chip?.classList.contains('dead')).toBe(false);
		expect(chip?.textContent).toContain('Research thread');
		// SessionStatus glyph rides inside the chip (idle dot branch).
		expect(chip?.querySelector('span')).not.toBeNull();
	});

	it('renders NO chip for a null name (bare Focused - stem)', () => {
		const h = mountChip({ name: null });
		expect(h.querySelector('[data-testid="sidebar-panel-group-chip"]')).toBeNull();
		expect(h.textContent?.trim()).toBe('');
	});

	it('the dead flag paints the honest-404 tint class', () => {
		const h = mountChip({ name: 'Dead panel', dead: true });
		const chip = h.querySelector('[data-testid="sidebar-panel-group-chip"]');
		expect(chip?.classList.contains('dead')).toBe(true);
	});

	it('the running flag arms the animated-bars glyph (live branch)', () => {
		const h = mountChip({ name: 'Streaming', running: true });
		const chip = h.querySelector('[data-testid="sidebar-panel-group-chip"]');
		expect(chip).not.toBeNull();
		// The SessionStatus boundary rendered its run-state glyph (spans).
		expect(chip?.querySelector('.si-run, [class*="run"]')).not.toBeNull();
	});

	it('dead+running together still render one chip with both facts', () => {
		const h = mountChip({ name: 'Both', dead: true, running: true });
		const chip = h.querySelector('[data-testid="sidebar-panel-group-chip"]');
		expect(chip?.classList.contains('dead')).toBe(true);
		expect(chip?.querySelector('.si-run, [class*="run"]')).not.toBeNull();
	});
});
