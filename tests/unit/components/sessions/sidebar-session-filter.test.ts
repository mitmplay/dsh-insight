/**
 * SidebarSessionFilter (2026-09-05): the row-level pick contract — the
 * dimension pills toggle their selection OFF on a second pick (the
 * pick* guards' both arms), and the fold hides the pills while the
 * header stays.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionFilter from '$lib/components/sidebar/session-filter/SidebarSessionFilter.svelte';
import type { FilterOption, SessionFilterState } from '$lib/utils/session-filters';

const WS: FilterOption[] = [
	{ key: '/tmp/alpha', label: 'alpha', count: 2 },
	{ key: '/tmp/beta', label: 'beta', count: 3 }
];
const PRESETS: FilterOption[] = [
	{ key: 'app-dev', label: 'app-dev', count: 5 },
	{ key: 'research', label: 'research', count: 1 }
];
const REST: SessionFilterState = { workspace: null, preset: null, blankMode: 'any' };

function mountRow(filter: SessionFilterState = REST) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onchange = vi.fn((next: SessionFilterState) => {
		handled.push(next);
	});
	const handled: SessionFilterState[] = [];
	const comp = mount(SidebarSessionFilter, {
		target,
		props: { workspaces: WS, presets: PRESETS, filter, onchange, oncreated: vi.fn(), registry: [] }
	});
	flushSync();
	const expand = () => {
		(target.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement).click();
		flushSync();
	};
	return { target, onchange, handled, expand, cleanup: () => { unmount(comp); target.remove(); } };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SidebarSessionFilter — picks and the fold', () => {
	it('picking a workspace selects it; picking it again clears it', () => {
		const h = mountRow();
		const pills = h.target.querySelectorAll('[role="group"][aria-label="Filter sessions"] button');
		const alpha = Array.from(pills).find((b) => b.textContent?.includes('alpha')) as HTMLButtonElement;
		alpha.click();
		flushSync();
		expect(h.onchange).toHaveBeenLastCalledWith({ ...REST, workspace: '/tmp/alpha' });
		// Second pick of the SAME key toggles it off (parent applies state)
		const h2 = mountRow({ ...REST, workspace: '/tmp/alpha' });
		const pills2 = h2.target.querySelectorAll('[role="group"][aria-label="Filter sessions"] button');
		const alpha2 = Array.from(pills2).find((b) => b.textContent?.includes('alpha')) as HTMLButtonElement;
		alpha2.click();
		flushSync();
		expect(h2.onchange).toHaveBeenLastCalledWith({ ...REST, workspace: null });
		h.cleanup();
		h2.cleanup();
	});

	it('picking a preset selects it; picking it again clears it', () => {
		const h = mountRow();
		const pills = h.target.querySelectorAll('[role="group"][aria-label="Filter sessions"] button');
		const research = Array.from(pills).find((b) => b.textContent?.includes('research')) as HTMLButtonElement;
		research.click();
		flushSync();
		expect(h.onchange).toHaveBeenLastCalledWith({ ...REST, preset: 'research' });
		const h2 = mountRow({ ...REST, preset: 'research' });
		const pills2 = h2.target.querySelectorAll('[role="group"][aria-label="Filter sessions"] button');
		const research2 = Array.from(pills2).find((b) => b.textContent?.includes('research')) as HTMLButtonElement;
		research2.click();
		flushSync();
		expect(h2.onchange).toHaveBeenLastCalledWith({ ...REST, preset: null });
		h.cleanup();
		h2.cleanup();
	});

	it('the fold starts expanded (pills visible) and folds on the toggle', () => {
		const h = mountRow();
		expect(h.target.querySelector('#filter-pills')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="filter-toggle"]')).not.toBeNull();
		h.expand();
		expect(h.target.querySelector('#filter-pills')).toBeNull();
		h.cleanup();
	});
});
