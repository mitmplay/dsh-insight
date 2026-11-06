/**
 * SidebarOpenPanelTree unit tests — the header row's lineage fold pair
 * (collapse-all / expand-all over every session WITH lineage).
 *
 * Pins: the disable grammar (a seg at its extreme sits disabled but
 * ONLY while the group stands EXPANDED — a collapsed group arms both),
 * and both invocations leave through the callbacks.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarOpenPanelTree from '../../src/lib/components/sessions/SidebarOpenPanelTree.svelte';

type Props = {
	collapsed: boolean;
	allFolded: boolean;
	allUnfolded: boolean;
	oncollapseall?: () => void;
	onexpandall?: () => void;
};

let instance: Record<string, unknown> | null = null;
let host: HTMLElement | null = null;

function mountTree(props: Props): HTMLElement {
	host = document.createElement('div');
	document.body.appendChild(host);
	instance = mount(SidebarOpenPanelTree, {
		target: host,
		props: { oncollapseall: vi.fn(), onexpandall: vi.fn(), ...props }
	});
	flushSync();
	return host;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	host?.remove();
	host = null;
});

describe('SidebarOpenPanelTree — lineage fold pair', () => {
	it('renders the joined seg-group with both segments', () => {
		const h = mountTree({ collapsed: false, allFolded: false, allUnfolded: false });
		expect(h.querySelector('[data-testid="sidebar-lineage-fold-toggle"]')).not.toBeNull();
		expect(h.querySelector('[data-testid="sidebar-lineage-collapse-all"]')).not.toBeNull();
		expect(h.querySelector('[data-testid="sidebar-lineage-expand-all"]')).not.toBeNull();
	});

	it('an expanded group at BOTH extremes disables both segments', () => {
		const h = mountTree({ collapsed: false, allFolded: true, allUnfolded: true });
		const collapse = h.querySelector('[data-testid="sidebar-lineage-collapse-all"]') as HTMLButtonElement;
		const expand = h.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement;
		expect(collapse.disabled).toBe(true);
		expect(expand.disabled).toBe(true);
	});

	it('an expanded mid-state group arms both segments; clicks fire the callbacks', () => {
		const oncollapseall = vi.fn();
		const onexpandall = vi.fn();
		const h = mountTree({ collapsed: false, allFolded: false, allUnfolded: false, oncollapseall, onexpandall });
		const collapse = h.querySelector('[data-testid="sidebar-lineage-collapse-all"]') as HTMLButtonElement;
		const expand = h.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement;
		expect(collapse.disabled).toBe(false);
		expect(expand.disabled).toBe(false);
		collapse.click();
		flushSync();
		expand.click();
		flushSync();
		expect(oncollapseall).toHaveBeenCalledTimes(1);
		expect(onexpandall).toHaveBeenCalledTimes(1);
	});

	it('a COLLAPSED group arms both segments even at the extremes', () => {
		const h = mountTree({ collapsed: true, allFolded: true, allUnfolded: true });
		const collapse = h.querySelector('[data-testid="sidebar-lineage-collapse-all"]') as HTMLButtonElement;
		const expand = h.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement;
		expect(collapse.disabled).toBe(false);
		expect(expand.disabled).toBe(false);
	});

	it('a collapsed half-state group keeps the visible-truth disable for the non-extreme', () => {
		// allFolded while expanded = collapse dead; collapsed = both armed.
		const h = mountTree({ collapsed: true, allFolded: true, allUnfolded: false });
		const collapse = h.querySelector('[data-testid="sidebar-lineage-collapse-all"]') as HTMLButtonElement;
		expect(collapse.disabled).toBe(false);
		collapse.click();
		flushSync();
	});

	it('expand-all fires from the armed arm at the folded extreme (collapsed group)', () => {
		const onexpandall = vi.fn();
		const h = mountTree({ collapsed: true, allFolded: true, allUnfolded: false, onexpandall });
		const expand = h.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement;
		expand.click();
		flushSync();
		expect(onexpandall).toHaveBeenCalledTimes(1);
	});
});
