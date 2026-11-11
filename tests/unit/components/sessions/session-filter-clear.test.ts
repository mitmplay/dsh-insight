/**
 * SessionFilterClear unit tests — pins the presentational contract of
 * SessionFilterClear.svelte (the `All` pill of SidebarSessionFilter,
 * extracted 2026-09-04):
 *  - one button, testid `filter-all`, title "Clear every filter";
 *  - `on` + aria-pressed="true" only when NOTHING filters (workspace,
 *    preset, and blankMode all at rest — blankMode 'any');
 *  - `count-only` marks the conversation-count toggle as the ONLY
 *    active dimension, and never coexists with `on` (the :not(.on)
 *    guard's data-side twin);
 *  - a click reports the clear REQUEST upward (onclear) — the child
 *    never builds the reset state itself.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionFilterClear from '$lib/components/sessions/SessionFilterClear.svelte';
import type { SessionFilterState } from '$lib/utils/session-filters';

/** The no-filter state — NOT DEFAULT_SESSION_FILTER, whose standing
 *  [!0] selection is precisely the count-only case. */
const ALL_CLEAR: SessionFilterState = { workspace: null, preset: null, blankMode: 'any' };

function mountClear(filter: SessionFilterState) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onclear = vi.fn();
	const instance = mount(SessionFilterClear, { target, props: { filter, onclear } });
	flushSync();
	return { target, instance, onclear };
}

const pill = (target: HTMLElement): HTMLButtonElement =>
	target.querySelector('[data-testid="filter-all"]') as HTMLButtonElement;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SessionFilterClear — render', () => {
	it('renders one `All` button announcing "Clear every filter"', () => {
		const { target, instance } = mountClear(ALL_CLEAR);
		const button = pill(target);
		expect(button.textContent?.trim()).toBe('All');
		expect(button.getAttribute('title')).toBe('Clear every filter');
		expect(button.getAttribute('type')).toBe('button');
		unmount(instance);
	});
});

describe('SessionFilterClear — states', () => {
	it('reads on + aria-pressed="true" when nothing filters', () => {
		const { target, instance } = mountClear(ALL_CLEAR);
		const button = pill(target);
		expect(button.classList.contains('on')).toBe(true);
		expect(button.getAttribute('aria-pressed')).toBe('true');
		expect(button.classList.contains('count-only')).toBe(false);
		unmount(instance);
	});

	it('reads count-only when the count toggle is the ONLY active dimension', () => {
		const { target, instance } = mountClear({ ...ALL_CLEAR, blankMode: 'nonempty' });
		const button = pill(target);
		expect(button.classList.contains('count-only')).toBe(true);
		// the guard: count-only and on are mutually exclusive
		expect(button.classList.contains('on')).toBe(false);
		expect(button.getAttribute('aria-pressed')).toBe('false');
		unmount(instance);
	});

	it.each(['empty', 'workspace'] as const)(
		'count-only holds for every non-any blankMode (%s)',
		(blankMode) => {
			const { target, instance } = mountClear({ ...ALL_CLEAR, blankMode });
			expect(pill(target).classList.contains('count-only')).toBe(true);
			unmount(instance);
		}
	);

	it('reads neither state when a workspace filters', () => {
		const { target, instance } = mountClear({ ...ALL_CLEAR, workspace: '/tmp/ws' });
		const button = pill(target);
		expect(button.classList.contains('on')).toBe(false);
		expect(button.classList.contains('count-only')).toBe(false);
		expect(button.getAttribute('aria-pressed')).toBe('false');
		unmount(instance);
	});

	it('reads neither state when a preset filters', () => {
		const { target, instance } = mountClear({ ...ALL_CLEAR, preset: 'coder' });
		const button = pill(target);
		expect(button.classList.contains('on')).toBe(false);
		expect(button.classList.contains('count-only')).toBe(false);
		unmount(instance);
	});

	it('count-only requires a resting workspace dimension', () => {
		const { target, instance } = mountClear({
			workspace: '/tmp/ws',
			preset: null,
			blankMode: 'empty'
		});
		const button = pill(target);
		expect(button.classList.contains('count-only')).toBe(false);
		expect(button.classList.contains('on')).toBe(false);
		unmount(instance);
	});
});

describe('SessionFilterClear — reporting', () => {
	it('reports the clear request upward on click', () => {
		const { target, instance, onclear } = mountClear({ ...ALL_CLEAR, blankMode: 'nonempty' });
		pill(target).click();
		flushSync();
		expect(onclear).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});
