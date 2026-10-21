/**
 * SidebarSessionsList — header VIEW state rendering (unit lane).
 *
 * Component-direct mount (sidebar-panel-list.test.ts / sessions-list.test.ts
 * pattern): the shell receives resolved spine view state and reports writes
 * upward, so every test mounts with cold props and asserts the DOM.
 *
 * Covers the header-only VIEW contract:
 *  - the chevron: ChevronDown + aria-expanded=true expanded, ChevronRight +
 *    aria-expanded=false collapsed (real lucide svgs carry .lucide-* classes,
 *    the system-prompt-chip.test.ts assertion grammar)
 *  - the sub-agent toggle: Bot + 'Hide sub-agents' when shown, BotOff +
 *    'Show sub-agents' + .active when hidden
 *  - FilterDateButton receives spine.dateFilter + sessionDates (module
 *    mocked with a stub that mirrors its props into data-attributes)
 *  - the title text resolves t(m.sessions) to 'Sessions'
 *  - collapsed unmounts the rows block while aria-controls keeps pointing
 *    at its id
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';
import { defaultSpineGroupPrefs, type SpineGroupPrefs } from '$lib/utils/spine-group-prefs';

// The date button is mocked, not mounted: its own calendar behavior is
// pinned by filter-date-button.test.ts; here we only need the WIRING —
// which value and dates the header hands it — exposed as data-attributes.
vi.mock('$lib/components/common/buttons/FilterDateButton.svelte', async () => {
	const { default: FilterDateButtonStub } = await import('./__stubs__/FilterDateButtonStub.svelte');
	return { default: FilterDateButtonStub };
});

import SidebarSessionsList from '$lib/components/sessions/SidebarSessionsList.svelte';

/** One summary row — the full DsiSessionSummary shape. */
function summary(
	sessionId: string,
	over: Partial<DsiSessionSummary> = {}
): DsiSessionSummary {
	return {
		sessionId,
		title: 'Session ' + sessionId,
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now(),
		workspace: '/tmp/e2e-harness',
		turns: null,
		...over
	};
}

function mountList(props: {
	visible?: DsiSessionSummary[];
	current?: DsiSessionSummary | null;
	spine?: SpineGroupPrefs;
	sessionDates?: Set<string>;
	onspinechange?: (partial: Partial<SpineGroupPrefs>) => void;
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarSessionsList, {
		target,
		props: {
			current: props.current ?? null,
			visible: props.visible ?? [],
			depthById: {},
			workspaces: [] as DsiWorkspaceSummary[],
			sessionDates: props.sessionDates ?? new Set<string>(),
			spine: props.spine ?? defaultSpineGroupPrefs(),
			...(props.onspinechange ? { onspinechange: props.onspinechange } : {})
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('SidebarSessionsList — header VIEW state', () => {
	it('expanded: the toggle renders ChevronDown with aria-expanded=true', () => {
		const { target, instance } = mountList({
			visible: [summary('s-one')],
			spine: { ...defaultSpineGroupPrefs(), collapsed: false }
		});
		const toggle = target.querySelector('[data-testid="sidebar-spine-group-toggle"]');
		expect(toggle).not.toBeNull();
		expect(toggle?.getAttribute('aria-expanded')).toBe('true');
		expect(toggle?.querySelector('svg.lucide-chevron-down')).not.toBeNull();
		expect(toggle?.querySelector('svg.lucide-chevron-right')).toBeNull();
		unmount(instance);
	});

	it('collapsed: the toggle renders ChevronRight with aria-expanded=false', () => {
		const { target, instance } = mountList({
			visible: [summary('s-one')],
			spine: { ...defaultSpineGroupPrefs(), collapsed: true }
		});
		const toggle = target.querySelector('[data-testid="sidebar-spine-group-toggle"]');
		expect(toggle).not.toBeNull();
		expect(toggle?.getAttribute('aria-expanded')).toBe('false');
		expect(toggle?.querySelector('svg.lucide-chevron-right')).not.toBeNull();
		expect(toggle?.querySelector('svg.lucide-chevron-down')).toBeNull();
		unmount(instance);
	});

	it('sub-agents shown: aria-pressed=false, title "Hide sub-agents", Bot icon', () => {
		const { target, instance } = mountList({
			visible: [summary('s-one')],
			spine: { ...defaultSpineGroupPrefs(), subagentsHidden: false }
		});
		const btn = target.querySelector('[data-testid="sidebar-spine-subagents"]');
		expect(btn?.getAttribute('aria-pressed')).toBe('false');
		expect(btn?.getAttribute('title')).toBe('Hide sub-agents');
		expect(btn?.classList.contains('active')).toBe(false);
		expect(btn?.querySelector('svg.lucide-bot')).not.toBeNull();
		expect(btn?.querySelector('svg.lucide-bot-off')).toBeNull();
		unmount(instance);
	});

	it('sub-agents hidden: aria-pressed=true, title "Show sub-agents", .active, BotOff icon', () => {
		const { target, instance } = mountList({
			visible: [summary('s-one')],
			spine: { ...defaultSpineGroupPrefs(), subagentsHidden: true }
		});
		const btn = target.querySelector('[data-testid="sidebar-spine-subagents"]');
		expect(btn?.getAttribute('aria-pressed')).toBe('true');
		expect(btn?.getAttribute('title')).toBe('Show sub-agents');
		expect(btn?.classList.contains('active')).toBe(true);
		expect(btn?.querySelector('svg.lucide-bot-off')).not.toBeNull();
		expect(btn?.querySelector('svg.lucide-bot')).toBeNull();
		unmount(instance);
	});

	it('FilterDateButton rides the header with spine.dateFilter and the session dates set', () => {
		const { target, instance } = mountList({
			visible: [summary('s-one')],
			spine: { ...defaultSpineGroupPrefs(), dateFilter: '2026-09-04' },
			sessionDates: new Set(['2026-09-04', '2026-08-31'])
		});
		const stub = target.querySelector('[data-testid="filter-date-stub"]');
		expect(stub).not.toBeNull();
		// Inside the header row, after the name filter (the 2026-09-04 slot).
		expect(target.querySelector('.group-head [data-testid="filter-date-stub"]')).not.toBeNull();
		expect(stub?.getAttribute('data-value')).toBe('2026-09-04');
		expect(stub?.getAttribute('data-dates')).toBe('2026-08-31,2026-09-04');
		unmount(instance);
	});

	it('the title renders the resolved sessions label: t(m.sessions) renders "Sessions"', () => {
		const { target, instance } = mountList({ visible: [summary('s-one')] });
		expect(target.querySelector('[data-testid="sidebar-spine-group-title"]')?.textContent).toBe(
			'Sessions'
		);
		unmount(instance);
	});

	it('collapsed unmounts the rows block; aria-controls still points at its id', () => {
		const { target, instance } = mountList({
			visible: [summary('s-one')],
			spine: { ...defaultSpineGroupPrefs(), collapsed: true }
		});
		expect(target.querySelector('[data-testid="sidebar-spine-group-rows"]')).toBeNull();
		const toggle = target.querySelector('[data-testid="sidebar-spine-group-toggle"]');
		expect(toggle?.getAttribute('aria-controls')).toBe('sidebar-spine-group-rows');
		// The header itself stays mounted while folded.
		expect(target.querySelector('[data-testid="sidebar-spine-group-title"]')).not.toBeNull();
		unmount(instance);
	});
});
