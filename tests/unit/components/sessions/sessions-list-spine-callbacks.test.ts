/**
 * SidebarSessionsList spine-callback tests — the view-state report
 * contract, component-direct (sessions-list.test.ts mount pattern).
 *
 * The component only RENDERS the spine header and REPORTS upward — the
 * owner (SidebarSessions, via spine-group-prefs) applies + persists. So
 * every test mounts with a cold spine prop and a single
 * onspinechange: vi.fn(), then drives one control and asserts the exact
 * partial the owner would receive:
 *  - the group-toggle click reports { collapsed: !spine.collapsed }
 *  - the name-filter input reports { nameFilter } — expanded; and the
 *    collapsed auto-expand branch reports BOTH facts in ONE report
 *    ({ collapsed: false, nameFilter }) so the owner persists once
 *  - the sub-agent toggle reports { subagentsHidden: !spine.subagentsHidden }
 *  - the FilterDateButton's onchange: a date pick while collapsed
 *    auto-expands ({ collapsed: false, dateFilter }), a pick while
 *    expanded reports the date alone, and CLEARING never expands —
 *    the unfiltered view is the default state, nothing to reveal.
 *
 * FilterDateButton is the REAL component driven through its own DOM
 * (badge → calendar day, badge × for clear) — its contract is pinned by
 * filter-date-button.test.ts; here it is only the trigger surface.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionsList from '$lib/components/sessions/SidebarSessionsList.svelte';
import { defaultSpineGroupPrefs, type SpineGroupPrefs } from '$lib/utils/spine-group-prefs';
import type { DsiSessionSummary } from '$lib/types';

/** One summary row — the full DsiSessionSummary shape (sessions-list.test.ts). */
function summary(sessionId: string): DsiSessionSummary {
	return {
		sessionId,
		title: `Session ${sessionId}`,
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now(),
		workspace: '/tmp/e2e-harness',
		turns: null
	};
}

function mountList(opts: { spine?: Partial<SpineGroupPrefs> } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const spine: SpineGroupPrefs = { ...defaultSpineGroupPrefs(), ...opts.spine };
	const onspinechange = vi.fn<(partial: Partial<SpineGroupPrefs>) => void>();
	const instance = mount(SidebarSessionsList, {
		target,
		props: {
			current: null,
			visible: [summary('s-one')],
			workspaces: [],
			spine,
			onspinechange
		}
	});
	flushSync();
	return { target, instance, onspinechange };
}

/** FilterDateButton opens its calendar on a setTimeout-attached
 *  click-outside listener — one macrotask hop before interacting. */
async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('SidebarSessionsList — spine view-state callbacks', () => {
	it('group-toggle click reports { collapsed: !spine.collapsed }', () => {
		const { target, instance, onspinechange } = mountList();
		expect(
			(target.querySelector('[data-testid="sidebar-spine-group-toggle"]') as HTMLButtonElement)
				.getAttribute('aria-expanded')
		).toBe('true');
		(target.querySelector('[data-testid="sidebar-spine-group-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(onspinechange).toHaveBeenCalledTimes(1);
		expect(onspinechange).toHaveBeenCalledWith({ collapsed: true });
		unmount(instance);
	});

	it('group-toggle click on a collapsed spine reports { collapsed: false }', () => {
		const { target, instance, onspinechange } = mountList({ spine: { collapsed: true } });
		expect(
			(target.querySelector('[data-testid="sidebar-spine-group-toggle"]') as HTMLButtonElement)
				.getAttribute('aria-expanded')
		).toBe('false');
		(target.querySelector('[data-testid="sidebar-spine-group-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(onspinechange).toHaveBeenCalledWith({ collapsed: false });
		unmount(instance);
	});

	it('name-filter input while expanded reports { nameFilter: value } only', () => {
		const { target, instance, onspinechange } = mountList();
		const input = target.querySelector('[data-testid="sidebar-spine-filter"]') as HTMLInputElement;
		input.value = 'harness';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onspinechange).toHaveBeenCalledTimes(1);
		expect(onspinechange).toHaveBeenCalledWith({ nameFilter: 'harness' });
		unmount(instance);
	});

	it('name-filter input while collapsed auto-expands: ONE report with both facts', () => {
		const { target, instance, onspinechange } = mountList({ spine: { collapsed: true } });
		const input = target.querySelector('[data-testid="sidebar-spine-filter"]') as HTMLInputElement;
		input.value = 'harness';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onspinechange).toHaveBeenCalledTimes(1);
		expect(onspinechange).toHaveBeenCalledWith({ collapsed: false, nameFilter: 'harness' });
		unmount(instance);
	});

	it('sub-agent toggle reports { subagentsHidden: !spine.subagentsHidden }', () => {
		const { target, instance, onspinechange } = mountList();
		(target.querySelector('[data-testid="sidebar-spine-subagents"]') as HTMLButtonElement).click();
		flushSync();
		expect(onspinechange).toHaveBeenCalledTimes(1);
		expect(onspinechange).toHaveBeenCalledWith({ subagentsHidden: true });
		// …and back — the report mirrors the CURRENT prop, not the DOM.
		const { target: t2, instance: i2, onspinechange: on2 } = mountList({ spine: { subagentsHidden: true } });
		(t2.querySelector('[data-testid="sidebar-spine-subagents"]') as HTMLButtonElement).click();
		flushSync();
		expect(on2).toHaveBeenCalledWith({ subagentsHidden: false });
		unmount(i2);
		unmount(instance);
	});

	it('date pick while collapsed auto-expands: { collapsed: false, dateFilter }', async () => {
		const { target, instance, onspinechange } = mountList({ spine: { collapsed: true } });
		const badge = target.querySelector('button[aria-label="Filter sessions by date"]') as HTMLButtonElement;
		badge.click();
		await settle();
		const day = (Array.from(target.querySelectorAll('[role="dialog"][aria-label="Date picker"] button')) as HTMLButtonElement[])
			.find((b) => /^15$/.test(b.textContent?.trim() ?? ''));
		expect(day, 'day 15 rendered in the shown month').not.toBeNull();
		day!.click();
		await settle();
		expect(onspinechange).toHaveBeenCalledTimes(1);
		const report = onspinechange.mock.calls[0][0] as Partial<SpineGroupPrefs>;
		expect(report.collapsed).toBe(false);
		expect(String(report.dateFilter)).toMatch(/^\d{4}-\d{2}-15$/);
		unmount(instance);
	});

	it('date pick while expanded reports { dateFilter } alone — no collapse facts', async () => {
		const { target, instance, onspinechange } = mountList();
		const badge = target.querySelector('button[aria-label="Filter sessions by date"]') as HTMLButtonElement;
		badge.click();
		await settle();
		const day = (Array.from(target.querySelectorAll('[role="dialog"][aria-label="Date picker"] button')) as HTMLButtonElement[])
			.find((b) => /^15$/.test(b.textContent?.trim() ?? ''));
		expect(day, 'day 15 rendered in the shown month').not.toBeNull();
		day!.click();
		await settle();
		expect(onspinechange).toHaveBeenCalledTimes(1);
		const report = onspinechange.mock.calls[0][0] as Partial<SpineGroupPrefs>;
		expect(report).toEqual({ dateFilter: String(report.dateFilter) });
		expect(String(report.dateFilter)).toMatch(/^\d{4}-\d{2}-15$/);
		expect('collapsed' in report).toBe(false);
		unmount(instance);
	});

	it('clearing (date === "") while collapsed NEVER expands: { dateFilter: "" } only', async () => {
		const { target, instance, onspinechange } = mountList({
			spine: { collapsed: true, dateFilter: '2026-09-15' }
		});
		const clear = target.querySelector('button[data-clear-date]') as HTMLButtonElement;
		expect(clear, 'an active dateFilter renders the × clear').not.toBeNull();
		clear.click();
		await settle();
		expect(onspinechange).toHaveBeenCalledTimes(1);
		expect(onspinechange).toHaveBeenCalledWith({ dateFilter: '' });
		unmount(instance);
	});
});
