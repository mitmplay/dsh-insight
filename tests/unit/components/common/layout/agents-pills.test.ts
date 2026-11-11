/**
 * Agents pill group unit tests — pins the presentational contract of
 * Agents.svelte (the agent pill group of SidebarSessionFilter):
 *  - no presets → nothing renders (the {#if} empty branch);
 *  - one Bot pill per preset option, badged with its session count
 *    (count 0 for a preset with no sessions yet still renders);
 *  - the testid anchors to the stable preset KEY, never the label;
 *  - selected state: .on + aria-pressed="true" on the active pill only;
 *  - a pick reports the preset key upward through onpick.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Agents from '$lib/components/common/layout/Agents.svelte';
import AgentsHost from '../../../../fixtures/AgentsHost.svelte';
import type { FilterOption } from '$lib/utils/session-filters';

const PRESETS: FilterOption[] = [
	{ key: 'cordis', label: 'Creator mode', count: 3 },
	{ key: 'coder', label: 'coder', count: 0 }
];

function mountAgents(presets: FilterOption[], selected: string | null = null) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onpick = vi.fn();
	const instance = mount(Agents, { target, props: { presets, selected, onpick } });
	flushSync();
	return { target, instance, onpick };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('Agents pill group — render', () => {
	it('renders nothing without presets (empty option list)', () => {
		const { target, instance } = mountAgents([]);
		expect(target.querySelectorAll('.pill').length).toBe(0);
		expect(target.textContent?.trim()).toBe('');
		unmount(instance);
	});

	it('renders one pill per preset with its label and session count', () => {
		const { target, instance } = mountAgents(PRESETS);
		const pills = [...target.querySelectorAll<HTMLButtonElement>('.pill')];
		expect(pills.length).toBe(2);
		expect(pills[0].textContent).toContain('Creator mode');
		expect(pills[0].textContent).toContain('3');
		// count 0 still renders — the pill arms + New chat for the agent
		expect(pills[1].textContent).toContain('0');
		unmount(instance);
	});

	it('anchors the testid to the preset key, not the mutable label', () => {
		const { target, instance } = mountAgents(PRESETS);
		const pills = [...target.querySelectorAll<HTMLButtonElement>('.pill')];
		expect(pills[0].dataset.testid).toBe('filter-preset-cordis');
		expect(pills[1].dataset.testid).toBe('filter-preset-coder');
		unmount(instance);
	});
});

describe('Agents pill group — selection', () => {
	it('marks only the selected pill: .on + aria-pressed="true"', () => {
		const { target, instance } = mountAgents(PRESETS, 'coder');
		const pills = [...target.querySelectorAll<HTMLButtonElement>('.pill')];
		expect(pills[0].classList.contains('on')).toBe(false);
		expect(pills[0].getAttribute('aria-pressed')).toBe('false');
		expect(pills[1].classList.contains('on')).toBe(true);
		expect(pills[1].getAttribute('aria-pressed')).toBe('true');
		unmount(instance);
	});

	it('marks no pill when nothing is selected (null)', () => {
		const { target, instance } = mountAgents(PRESETS, null);
		const pills = [...target.querySelectorAll<HTMLButtonElement>('.pill')];
		expect(pills.every((p) => !p.classList.contains('on'))).toBe(true);
		expect(pills.every((p) => p.getAttribute('aria-pressed') === 'false')).toBe(true);
		unmount(instance);
	});
});

describe('Agents pill group — pick', () => {
	it('reports the picked preset key upward for both picked states', () => {
		const { target, instance, onpick } = mountAgents(PRESETS, 'cordis');
		const pills = [...target.querySelectorAll<HTMLButtonElement>('.pill')];
		pills[0].click(); // picking the selected pill (owner untoggles)
		pills[1].click();
		expect(onpick.mock.calls).toEqual([['cordis'], ['coder']]);
		unmount(instance);
	});
});

describe('Agents pill group — prop changes after mount', () => {
	it('re-renders pills, selection state, and counts when the owner updates them', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const onpick = vi.fn();
		const instance = mount(AgentsHost, {
			target,
			props: { initialPresets: PRESETS, initialSelected: 'cordis', onpick }
		});
		flushSync();
		const host = instance as unknown as { set: (next: Record<string, unknown>) => void };

		// selection moves cordis → coder: class/on and aria-pressed flip
		host.set({ selected: 'coder' });
		flushSync();
		let pills = [...target.querySelectorAll<HTMLButtonElement>('.pill')];
		expect(pills[0].classList.contains('on')).toBe(false);
		expect(pills[1].classList.contains('on')).toBe(true);
		expect(pills[1].getAttribute('aria-pressed')).toBe('true');

		// selection clears: no pill is on
		host.set({ selected: null });
		flushSync();
		pills = [...target.querySelectorAll<HTMLButtonElement>('.pill')];
		expect(pills.every((p) => !p.classList.contains('on'))).toBe(true);

		// the option list itself changes: counts and labels update in place
		host.set({
			presets: [
				{ key: 'cordis', label: 'Creator mode', count: 9 },
				{ key: 'coder', label: 'coder', count: 1 }
			]
		});
		flushSync();
		pills = [...target.querySelectorAll<HTMLButtonElement>('.pill')];
		expect(pills).toHaveLength(2);
		expect(pills[0].textContent).toContain('9');
		expect(pills[1].textContent).toContain('1');

		pills[1].click();
		expect(onpick).toHaveBeenCalledWith('coder');
		unmount(instance);
	});
});

describe('Agents pill group — compiler fallback', () => {
	it('degrades the testid to its static prefix when a preset key is missing', () => {
		// Svelte compiles the interpolated attribute to
		// `filter-preset-${key ?? ''}` — the fallback is unreachable through
		// the FilterOption contract (key: string), so this deliberately
		// violates it to pin the degradation instead of "undefined" leaking
		// into the DOM.
		const keyless = [{ key: undefined as unknown as string, label: 'ghost preset', count: 1 }];
		const { target, instance } = mountAgents(keyless, null);
		const pill = target.querySelector<HTMLButtonElement>('.pill');
		expect(pill?.dataset.testid).toBe('filter-preset-');
		expect(pill?.textContent).toContain('ghost preset');
		unmount(instance);
	});
});
