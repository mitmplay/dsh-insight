/**
 * SidebarSessionFilterHeader unit tests — pins the contract of
 * SidebarSessionFilterHeader.svelte (the row's always-visible line, extracted
 * 2026-09-04):
 *  - the collapse button (filter-toggle): aria-expanded tracks the
 *    fold, aria-controls points at the row's pills group, a click
 *    reports ontoggle;
 *  - the meta controls ride the header line — filter-all is present
 *    folded or not;
 *  - the summary string contract: `Filter by - ` + a chip per selected
 *    dimension or the `Workspace + Agent` placeholder;
 *  - the head tooltip discloses the FULL state (the count toggle never
 *    enters the summary);
 *  - ghost chip: an unregistered selected workspace renders grey
 *    (ghost class) with the ghost-suffix chip tooltip.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionFilterHeader from '$lib/components/sidebar/session-filter/SidebarSessionFilterHeader.svelte';
import type { FilterOption, SessionFilterState } from '$lib/utils/session-filters';
import type { DsiWorkspaceSummary } from '$lib/types';

const ALL_CLEAR: SessionFilterState = { workspace: null, preset: null, blankMode: 'any' };

const WS: FilterOption = {
	key: '/tmp/ws',
	label: 'ws',
	path: '/tmp/ws',
	count: 3,
	registered: true
};
const GHOST_WS: FilterOption = { key: '/tmp/ghost', label: 'ghost', count: 2, registered: false };
const PRESETS: FilterOption[] = [{ key: 'cordis', label: 'Creator mode', count: 1 }];

function mountHeader(
	filter: SessionFilterState = ALL_CLEAR,
	{
		workspaces = [],
		presets = PRESETS,
		collapsed = true,
		registry = [] as DsiWorkspaceSummary[]
	}: {
		workspaces?: FilterOption[];
		presets?: FilterOption[];
		collapsed?: boolean;
		registry?: DsiWorkspaceSummary[];
	} = {}
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const ontoggle = vi.fn();
	const onchange = vi.fn();
	const instance = mount(SidebarSessionFilterHeader, {
		target,
		props: { workspaces, presets, filter, collapsed, ontoggle, onchange, oncreated: vi.fn(), registry }
	});
	flushSync();
	return { target, instance, ontoggle, onchange };
}

const head = (target: HTMLElement): HTMLButtonElement =>
	target.querySelector('[data-testid="filter-toggle"]') as HTMLButtonElement;

const summary = (target: HTMLElement): HTMLElement =>
	target.querySelector('[data-testid="filter-summary"]') as HTMLElement;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SidebarSessionFilterHeader — collapse button', () => {
	it('tracks the fold: aria-expanded + chevron, click reports ontoggle', () => {
		const { target, instance, ontoggle } = mountHeader(ALL_CLEAR, { collapsed: true });
		const button = head(target);
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(button.getAttribute('aria-controls')).toBe('filter-pills');
		expect(button.querySelector('svg')).not.toBeNull();
		button.click();
		flushSync();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('aria-expanded="true" when unfolded', () => {
		const { target, instance } = mountHeader(ALL_CLEAR, { collapsed: false });
		expect(head(target).getAttribute('aria-expanded')).toBe('true');
		unmount(instance);
	});
});

describe('SidebarSessionFilterHeader — chip menu gesture (Chip Menu ADR D1/D4)', () => {
	const WS_FILTER: SessionFilterState = { workspace: '/tmp/ws', preset: null, blankMode: 'any' };
	const REGISTRY: DsiWorkspaceSummary[] = [
		{ workspaceId: 'w-1', title: 'Harness', path: '/tmp/ws', sessionIds: [] }
	];

	it('registered chip click opens the menu and does NOT fire ontoggle', async () => {
		const { target, instance, ontoggle } = mountHeader(WS_FILTER, { workspaces: [WS], registry: REGISTRY });
		const chip = target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		chip.click();
		await flushSync();
		expect(ontoggle).not.toHaveBeenCalled();
		expect(target.querySelector('[data-testid="workspace-actions-menu"]')).not.toBeNull();
		unmount(instance);
	});

	it('ghost chip click still fires ontoggle (bubbles to the fold), no menu', async () => {
		const ghostFilter: SessionFilterState = { workspace: '/tmp/ghost', preset: null, blankMode: 'any' };
		const { target, instance, ontoggle } = mountHeader(ghostFilter, { workspaces: [GHOST_WS], collapsed: true });
		const chip = target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		chip.click();
		await flushSync();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		expect(target.querySelector('[data-testid="workspace-actions-menu"]')).toBeNull();
		unmount(instance);
	});

	it('registered selection with a registry miss (stale) never opens a menu (ADR D4)', async () => {
		const staleFilter: SessionFilterState = { workspace: '/tmp/gone', preset: null, blankMode: 'any' };
		const staleWs: FilterOption = { key: '/tmp/gone', label: 'gone', path: '/tmp/gone', count: 1, registered: false };
		const { target, instance, ontoggle } = mountHeader(staleFilter, { workspaces: [staleWs], collapsed: true });
		const chip = target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		chip.click();
		await flushSync();
		// Registered=false marks it ghost — bubbles; even a registered flag
		// with no registry row would find no id: either way, no menu.
		expect(ontoggle).toHaveBeenCalledTimes(1);
		expect(target.querySelector('[data-testid="workspace-actions-menu"]')).toBeNull();
		unmount(instance);
	});

	it('no button nests inside the collapse button (ADR D1 — the chip stays a span)', () => {
		const { target, instance } = mountHeader(WS_FILTER, { workspaces: [WS], registry: REGISTRY });
		const button = head(target);
		expect(button.querySelectorAll('button').length).toBe(0);
		unmount(instance);
	});

	it('registered chip tooltip discloses the menu gesture; ghost keeps its suffix', () => {
		const reg = mountHeader(WS_FILTER, { workspaces: [WS], registry: REGISTRY });
		const regChip = reg.target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		expect(regChip.getAttribute('title')).toContain('click for Rename / Delete');
		unmount(reg.instance);
		const ghostFilter: SessionFilterState = { workspace: '/tmp/ghost', preset: null, blankMode: 'any' };
		const ghost = mountHeader(ghostFilter, { workspaces: [GHOST_WS] });
		const ghostChip = ghost.target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		expect(ghostChip.getAttribute('title')).toContain('not in the workspace registry');
		unmount(ghost.instance);
	});
});

describe('SidebarSessionFilterHeader — meta on the header line', () => {
	it('renders `All` folded or not (meta is always visible)', () => {
		const folded = mountHeader(ALL_CLEAR, { collapsed: true });
		expect(folded.target.querySelector('[data-testid="filter-all"]')).not.toBeNull();
		unmount(folded.instance);
		const unfolded = mountHeader(ALL_CLEAR, { collapsed: false });
		expect(unfolded.target.querySelector('[data-testid="filter-all"]')).not.toBeNull();
		unmount(unfolded.instance);
	});
});

describe('SidebarSessionFilterHeader — summary string contract', () => {
	it('placeholder when nothing filters', () => {
		const { target, instance } = mountHeader(ALL_CLEAR);
		expect(summary(target).textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Filter by - Workspace + Agent'
		);
		expect(target.querySelector('[data-testid="filter-summary-placeholder"]')).not.toBeNull();
		unmount(instance);
	});

	it('a chip per selected dimension with the ` + ` separator', () => {
		const { target, instance } = mountHeader(
			{ workspace: '/tmp/ws', preset: 'cordis', blankMode: 'any' },
			{ workspaces: [WS] }
		);
		expect(summary(target).textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Filter by - ws + Creator mode'
		);
		expect(target.querySelector('[data-testid="filter-summary-chip-ws"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="filter-summary-chip-agent"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="filter-summary-placeholder"]')).toBeNull();
		unmount(instance);
	});
});

describe('SidebarSessionFilterHeader — disclosure', () => {
	it('the head tooltip discloses the full state, count included', () => {
		const { target, instance } = mountHeader({
			workspace: '/tmp/ws',
			preset: 'cordis',
			blankMode: 'nonempty'
		}, { workspaces: [WS] });
		expect(head(target).getAttribute('title')).toBe(
			'Workspace: ws · Agent: Creator mode · Count: !0'
		);
		unmount(instance);
	});

	it('a ghost workspace renders the grey chip with the ghost-suffix tooltip', () => {
		const { target, instance } = mountHeader(
			{ workspace: '/tmp/ghost', preset: null, blankMode: 'any' },
			{ workspaces: [GHOST_WS] }
		);
		const chip = target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		expect(chip.classList.contains('ghost')).toBe(true);
		expect(chip.getAttribute('title')).toBe('/tmp/ghost — not in the workspace registry');
		unmount(instance);
	});
});

describe('SidebarSessionFilterHeader — chip menu gesture + tooltip arms (coverage pass 2026-09-14)', () => {
	const REGISTRY: DsiWorkspaceSummary[] = [
		{
			workspaceId: 'w1',
			title: 'ws',
			path: '/tmp/ws',
			sessionIds: ['s1']
		}
	];

	it('a registered chip click opens the menu and NEVER folds; a foreign keydown stays inert', () => {
		const { target, instance, ontoggle } = mountHeader(
			{ workspace: '/tmp/ws', preset: null, blankMode: 'any' },
			{ workspaces: [WS], registry: REGISTRY }
		);
		const chip = target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		// a key that is neither Enter nor Space is a guard early-return: no menu
		chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(target.querySelector('.menu-anchor')).toBeNull();
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(target.querySelector('.menu-anchor')).not.toBeNull();
		expect(ontoggle).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('the keyboard twin (Enter) opens the menu on a registered chip', () => {
		const { target, instance } = mountHeader(
			{ workspace: '/tmp/ws', preset: null, blankMode: 'any' },
			{ workspaces: [WS], registry: REGISTRY }
		);
		const chip = target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		flushSync();
		expect(target.querySelector('.menu-anchor')).not.toBeNull();
		unmount(instance);
	});

	it('a registry MISS (stale selection) falls through to the fold — no menu', () => {
		const { target, instance, ontoggle } = mountHeader(
			{ workspace: '/tmp/ws', preset: null, blankMode: 'any' },
			{ workspaces: [WS], registry: [] }
		);
		const chip = target.querySelector('[data-testid="filter-summary-chip-ws"]') as HTMLElement;
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(target.querySelector('.menu-anchor')).toBeNull();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('an unknown preset key falls back to the raw key in the agent chip', () => {
		const { target, instance } = mountHeader(
			{ workspace: null, preset: 'ghost-preset', blankMode: 'any' },
			{ presets: PRESETS }
		);
		const agentChip = target.querySelector('[data-testid="filter-summary-chip-agent"]');
		expect(agentChip).not.toBeNull();
		expect(agentChip!.textContent).toContain('ghost-preset');
		unmount(instance);
	});

	it('the tooltip discloses every blankMode arm', () => {
		const cases: Array<[SessionFilterState, string]> = [
			[{ workspace: null, preset: null, blankMode: 'empty' }, 'Count: 0'],
			[{ workspace: null, preset: null, blankMode: 'workspace' }, 'Count: ws'],
			[{ workspace: null, preset: null, blankMode: 'nonempty' }, 'Count: !0']
		];
		for (const [filter, needle] of cases) {
			const { target, instance } = mountHeader(filter);
			expect(head(target).getAttribute('title')).toContain(needle);
			unmount(instance);
		}
	});
});
