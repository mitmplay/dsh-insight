import { flushSync, mount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PanelListboxFilter from '../../src/components/PanelListboxFilter.svelte';

/**
 * 1.1-T (Container Base R9, ADR-0071) — the filter organ's contract:
 * value in, keystrokes out, NOTHING else. No match logic, no consumer
 * imports, no state — the input carries the grammar once so the two
 * hand-drawn DSI copies can retire (D9).
 */

function mountFilter(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PanelListboxFilter, { target, props: props as never });
	flushSync();
	return { instance, target };
}

const inputOf = (target: HTMLElement) =>
	target.querySelector<HTMLInputElement>('[data-testid="panel-listbox-filter"]')!;

describe('PanelListboxFilter (search-input organ, ADR-0071 D1)', () => {
	it('renders value in and reports keystrokes out via oninput', async () => {
		const oninput = vi.fn();
		const { target } = mountFilter({ value: 'sched', oninput });
		const input = inputOf(target);
		expect(input.value).toBe('sched');
		input.value = 'scheduler';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		expect(oninput).toHaveBeenCalledTimes(1);
		expect(oninput).toHaveBeenCalledWith('scheduler');
	});

	it('survives a missing oninput handler', () => {
		const { target } = mountFilter({});
		const input = inputOf(target);
		expect(() => {
			input.value = 'x';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}).not.toThrow();
	});

	it('carries the English placeholder default and the override', () => {
		const { target } = mountFilter({});
		expect(inputOf(target).placeholder).toBe('Filter');
		const { target: t2 } = mountFilter({ placeholder: 'Filter by task name' });
		expect(inputOf(t2).placeholder).toBe('Filter by task name');
	});

	it('carries the neutral testid default and the override (D6)', () => {
		const { target } = mountFilter({});
		expect(target.querySelector('[data-testid="panel-listbox-filter"]')).not.toBeNull();
		const { target: t2 } = mountFilter({ testid: 'sidebar-scheduler-filter' });
		expect(t2.querySelector('[data-testid="sidebar-scheduler-filter"]')).not.toBeNull();
	});

	it('labels via ariaLabel, falling back to the placeholder text', () => {
		const { target } = mountFilter({ placeholder: 'Filter sessions' });
		expect(inputOf(target).getAttribute('aria-label')).toBe('Filter sessions');
		const { target: t2 } = mountFilter({ placeholder: 'Filter', ariaLabel: 'Filter sessions' });
		expect(inputOf(t2).getAttribute('aria-label')).toBe('Filter sessions');
	});

	it('paints through --panel-listbox-filter-* tokens WITH inline neutral fallbacks (D5, UX amendment)', () => {
		const src = readFileSync(
			new URL('../../src/components/PanelListboxFilter.svelte', 'file://' + fileURLToPath(import.meta.url)),
			'utf8'
		);
		expect(src).toContain('var(--panel-listbox-filter-border)');
		expect(src).toContain('var(--panel-listbox-filter-bg)');
		expect(src).toContain('var(--panel-listbox-filter-ring)');
		expect(src).toContain('var(--panel-listbox-filter-placeholder)');
		expect(src).not.toMatch(/--color-navy|--color-accent|spine|scheduler/i);
	});

	it('ships no match logic — the source mentions no filtering verb (D1 boundary)', () => {
		const src = readFileSync(
			new URL('../../src/components/PanelListboxFilter.svelte', 'file://' + fileURLToPath(import.meta.url)),
			'utf8'
		);
		// no match pipeline in the source: no array filtering verb anywhere
		expect(src).not.toMatch(/\.includes\(/);
		expect(src).not.toMatch(/\.filter\(/);
	});
});
