/**
 * Unit: SchedulerViewToggle (Filter Cluster ADR D2, task 2.1-T) — the
 * shelf's tri-state delivery view as one joined pill. Pins: none-lit at
 * 'all', S lit at 'scheduled', D lit at 'delivered', click payloads,
 * and the re-click of the lit segment returning to 'all'. The
 * component is STATELESS — a suite-wide spy also proves it never
 * touches localStorage (ADR D1 contract).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SchedulerViewToggle from '../../src/lib/components/sidebar/session-scheduler/SchedulerViewToggle.svelte';
import type { SchedulerViewMode } from '$lib/utils/scheduler-prefs';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import id from '../../messages/id.json';
import zh from '../../messages/zh.json';

interface Handle {
	host: HTMLElement;
	instance: unknown;
}

function mountToggle(value: SchedulerViewMode, onchange: (next: SchedulerViewMode) => void): Handle {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const instance = mount(SchedulerViewToggle, { target: host, props: { value, onchange } });
	flushSync();
	return { host, instance };
}

describe('scheduler-view-toggle', () => {
	let onchange: (next: SchedulerViewMode) => void;
	let h: Handle;

	beforeEach(() => {
		localStorage.clear();
		localStorage.setItem('sentinel', 'untouched');
		onchange = vi.fn<(next: SchedulerViewMode) => void>();
	});

	afterEach(() => {
		unmount(h.instance as never);
		h.host.remove();
		// Stateless (D1): the toggle never touched storage.
		expect(localStorage.getItem('sentinel')).toBe('untouched');
		expect(localStorage.length).toBe(1);
		vi.restoreAllMocks();
	});

	const seg = (testid: string): HTMLButtonElement =>
		h.host.querySelector('[data-testid="' + testid + '"]') as HTMLButtonElement;

	it('renders none-lit at all', () => {
		h = mountToggle('all', onchange);
		expect(seg('scheduler-view-toggle-s').getAttribute('aria-pressed')).toBe('false');
		expect(seg('scheduler-view-toggle-d').getAttribute('aria-pressed')).toBe('false');
		expect(seg('scheduler-view-toggle-s').classList.contains('on')).toBe(false);
		expect(seg('scheduler-view-toggle-d').classList.contains('on')).toBe(false);
	});

	it('lights S at scheduled', () => {
		h = mountToggle('scheduled', onchange);
		expect(seg('scheduler-view-toggle-s').getAttribute('aria-pressed')).toBe('true');
		expect(seg('scheduler-view-toggle-s').classList.contains('on')).toBe(true);
		expect(seg('scheduler-view-toggle-d').classList.contains('on')).toBe(false);
	});

	it('lights D at delivered', () => {
		h = mountToggle('delivered', onchange);
		expect(seg('scheduler-view-toggle-d').getAttribute('aria-pressed')).toBe('true');
		expect(seg('scheduler-view-toggle-d').classList.contains('on')).toBe(true);
		expect(seg('scheduler-view-toggle-s').classList.contains('on')).toBe(false);
	});

	it('clicks emit onchange payloads', () => {
		h = mountToggle('all', onchange);
		seg('scheduler-view-toggle-s').click();
		seg('scheduler-view-toggle-d').click();
		flushSync();
		expect(onchange).toHaveBeenNthCalledWith(1, 'scheduled');
		expect(onchange).toHaveBeenNthCalledWith(2, 'delivered');
	});

	it('renders the translated copy (Healed Gates 1-T): aria-label + titles from the dictionaries', () => {
		h = mountToggle('all', onchange);
		expect(seg('scheduler-view-toggle').getAttribute('aria-label')).toBe('Delivery view');
		expect(seg('scheduler-view-toggle-s').getAttribute('title')).toBe('Show pending (awaiting delivery)');
		expect(seg('scheduler-view-toggle-d').getAttribute('title')).toBe('Show delivered');
		// ADR-0060 D1: each new key exists in all four tongues.
		const locales = [en, es, id, zh] as Record<string, string>[];
		for (const key of ['schedulerDeliveryView', 'schedulerShowPending', 'schedulerShowDelivered']) {
			for (const dict of locales) expect(typeof dict[key]).toBe('string');
		}
	});

	it('re-click of the lit segment emits all', () => {
		h = mountToggle('scheduled', onchange);
		seg('scheduler-view-toggle-s').click();
		flushSync();
		expect(onchange).toHaveBeenCalledWith('all');
		unmount(h.instance as never);
		h.host.remove();
		h = mountToggle('delivered', onchange);
		seg('scheduler-view-toggle-d').click();
		flushSync();
		expect(onchange).toHaveBeenCalledWith('all');
	});
});
