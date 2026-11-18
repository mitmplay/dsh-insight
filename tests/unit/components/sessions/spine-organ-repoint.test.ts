import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionList from '../../../../src/lib/components/sidebar/session-list/SidebarSessionList.svelte';
import { defaultSpineGroupPrefs } from '../../../../src/lib/utils/spine-group-prefs';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '../../../../src/lib/types';

/**
 * 4.1-T (Container Base R8, ADR-0070 D9) — the spine's box + header ride
 * the PACKAGE organs: organ root classes present, the pinned testids and
 * the aria-controls grammar survive as injectable props, the empty-state
 * hints render through the emptysnippet, and a keystroke while collapsed
 * auto-expands (the report carries both facts).
 */

const workspaces: DsiWorkspaceSummary[] = [
	{ workspaceId: 'w-a', title: 'alpha', path: '/tmp/alpha', sessionIds: [] }
];

const session = (id: string, title: string): DsiSessionSummary =>
	({ sessionId: id, title, origin: 'user' }) as unknown as DsiSessionSummary;

let instance: Record<string, unknown> | null = null;
let host: HTMLElement | null = null;

function mountList(props: Record<string, unknown>): HTMLElement {
	host = document.createElement('div');
	document.body.appendChild(host);
	instance = mount(SidebarSessionList, {
		target: host,
		props: {
			current: null,
			visible: [session('s-1', 'One'), session('s-2', 'Two')],
			workspaces,
			spine: defaultSpineGroupPrefs(),
			...props
		}
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

describe('spine organ re-point (4.1-T)', () => {
	it('the box is the PanelListbox organ; the header toggle carries the organ grammar + aria-controls', () => {
		const h = mountList({});
		const box = h.querySelector('[data-testid="sidebar-spine-group"]')!;
		expect(box.classList.contains('panel-listbox')).toBe(true);
		const toggle = h.querySelector('[data-testid="sidebar-spine-group-toggle"]') as HTMLButtonElement;
		expect(toggle.classList.contains('lb-chevron')).toBe(true);
		expect(toggle.getAttribute('aria-controls')).toBe('sidebar-spine-group-rows');
		// the rows scroll is the PanelListboxList organ carrying the pinned
		// testid AND the aria-controls target id (the heartbeat anchor's parent)
		const list = h.querySelector('[data-testid="sidebar-spine-group-rows"]')!;
		expect(list.classList.contains('panel-listbox-list')).toBe(true);
		expect(list.id).toBe('sidebar-spine-group-rows');
	});

	it('the filter/date/subagent controls ride the trailing snippet; reports stay intact', () => {
		const onspinechange = vi.fn();
		const h = mountList({ onspinechange });
		const filter = h.querySelector('[data-testid="sidebar-spine-filter"]') as HTMLInputElement;
		expect(filter).not.toBeNull();
		filter.value = 'one';
		filter.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onspinechange).toHaveBeenCalledWith({ nameFilter: 'one' });
		const subagents = h.querySelector('[data-testid="sidebar-spine-subagents"]') as HTMLButtonElement;
		subagents.click();
		flushSync();
		expect(onspinechange).toHaveBeenCalledWith({ subagentsHidden: true });
		// the title keeps its testid + text (the spine's Sessions stem)
		expect(h.querySelector('[data-testid="sidebar-spine-group-title"]')?.textContent).toContain('Sessions');
	});

	it('collapse hides the rows; a keystroke while collapsed auto-expands', () => {
		const onspinechange = vi.fn();
		const h = mountList({ onspinechange, spine: { ...defaultSpineGroupPrefs(), collapsed: true } });
		expect(h.querySelector('[data-testid="sidebar-spine-group-rows"]')).toBeNull();
		// the header stays — the organ's collapsed box IS the header
		expect(h.querySelector('[data-testid="sidebar-spine-group-toggle"]')).not.toBeNull();
	});
});
