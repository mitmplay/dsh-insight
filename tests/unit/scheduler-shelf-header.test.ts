/**
 * Unit: SidebarSessionSchedulerHeader (Filter Cluster tasks 2.2/2.2-T) —
 * the pills + filter cluster, fully prop/callback driven. Pins: both
 * pills render values including honest 0; the filter input echoes the
 * value and emits oninput; FilterDateButton receives the date value
 * (active badge + clear affordance) and the dot set; the view toggle is
 * wired through; the header stays STATELESS (localStorage untouched).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionSchedulerHeader from '../../src/lib/components/sidebar/session-scheduler/SidebarSessionSchedulerHeader.svelte';
import type { SchedulerViewMode } from '$lib/utils/scheduler-prefs';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import id from '../../messages/id.json';
import zh from '../../messages/zh.json';

interface Handle {
	host: HTMLElement;
	instance: unknown;
}

function mountHeader(over: Partial<Record<string, unknown>> = {}): Handle {
	const props = {
		collapsed: false,
		pendingCount: 3,
		deliveredCount: 1,
		nameFilter: '',
		dateFilter: '',
		viewMode: 'all' as SchedulerViewMode,
		sessionDates: new Set(['2026-11-11']),
		ontoggle: vi.fn(),
		onfilterinput: vi.fn(),
		ondatechange: vi.fn(),
		onviewchange: vi.fn(),
		...over
	};
	const host = document.createElement('div');
	document.body.appendChild(host);
	const instance = mount(SidebarSessionSchedulerHeader, { target: host, props });
	flushSync();
	return { host, instance };
}

describe('scheduler-shelf-header', () => {
	let h: Handle;

	beforeEach(() => {
		localStorage.clear();
		localStorage.setItem('sentinel', 'untouched');
	});

	afterEach(() => {
		unmount(h.instance as never);
		h.host.remove();
		// Stateless (D1): the header never touched storage.
		expect(localStorage.getItem('sentinel')).toBe('untouched');
		expect(localStorage.length).toBe(1);
	});

	it('pills render values including honest 0, input sits after the fold toggle', () => {
		h = mountHeader({ pendingCount: 0, deliveredCount: 0 });
		// Row order (operator amendment 2026-11-11): toggle → input → pills.
		const toggle = h.host.querySelector('[data-testid="scheduler-shelf-toggle"]');
		const input = h.host.querySelector('[data-testid="sidebar-scheduler-filter"]');
		expect(input?.previousElementSibling).toBe(toggle);
		expect(h.host.querySelector('[data-testid="scheduler-counts"]')?.textContent).toBe('(0/0)');
		unmount(h.instance as never);
		h.host.remove();
		h = mountHeader({ pendingCount: 7, deliveredCount: 2 });
		expect(h.host.querySelector('[data-testid="scheduler-counts"]')?.textContent).toBe('(7/2)');
	});

	it('renders the translated filter copy (Healed Gates 1-T): aria-label from the dictionaries', () => {
		h = mountHeader();
		const input = h.host.querySelector('[data-testid="sidebar-scheduler-filter"]');
		expect(input?.getAttribute('aria-label')).toBe('Filter by task name');
		// ADR-0060 D1: schedulerFilterByTaskName stays present in all four tongues.
		const locales = [en, es, id, zh] as Record<string, string>[];
		for (const dict of locales) expect(typeof dict['schedulerFilterByTaskName']).toBe('string');
	});

	it('the filter input echoes the value and emits on input', () => {
		const onfilterinput = vi.fn();
		h = mountHeader({ nameFilter: 'rep', onfilterinput });
		const input = h.host.querySelector('[data-testid="sidebar-scheduler-filter"]') as HTMLInputElement;
		expect(input.value).toBe('rep');
		expect(input.type).toBe('search');
		input.value = 'report';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onfilterinput).toHaveBeenCalledTimes(1);
	});

	it('FilterDateButton receives the date value and the dot set', () => {
		h = mountHeader({ dateFilter: '2026-11-11', sessionDates: new Set(['2026-11-11', '2026-11-12']) });
		// Active badge: the picked day's MM-DD label + the clear affordance.
		expect(h.host.querySelector('.badge.active .label')?.textContent).toBe('11-11');
		expect(h.host.querySelector('[data-clear-date]')).not.toBeNull();
		// Inactive: calendar glyph, no label, no clear.
		unmount(h.instance as never);
		h.host.remove();
		h = mountHeader({ dateFilter: '' });
		expect(h.host.querySelector('.badge.active')).toBeNull();
		expect(h.host.querySelector('[data-clear-date]')).toBeNull();
	});

	it('the view toggle is wired: click forwards the view payload', () => {
		const onviewchange = vi.fn();
		h = mountHeader({ viewMode: 'all', onviewchange });
		const d = h.host.querySelector('[data-testid="scheduler-view-toggle-d"]') as HTMLButtonElement;
		expect(d.getAttribute('aria-pressed')).toBe('false');
		d.click();
		flushSync();
		expect(onviewchange).toHaveBeenCalledWith('delivered');
	});

	it('the fold toggle still fires ontoggle', () => {
		const ontoggle = vi.fn();
		h = mountHeader({ ontoggle });
		(h.host.querySelector('[data-testid="scheduler-shelf-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(ontoggle).toHaveBeenCalledTimes(1);
	});
});
