/**
 * DeliverablesPopup — the row-click file-open seat (ADR-0013 D5,
 * ADR-0027f): each row's click routes its OWN file's full path through
 * the optional onopen callback; the callback is optional, so omitting
 * it must not throw.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import DeliverablesPopup from '../../src/lib/components/anchor/deliverables-anchor/DeliverablesPopup.svelte';
import type { PresentedDelivery } from '../../src/lib/services/conversation/deliverables';

const FIXTURE: PresentedDelivery[] = [
	{ turn: 1, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] },
	{ turn: 2, callId: 'c2', files: [{ path: '/tmp/chart.png' }] }
];

function mountPopup(props: {
	deliveries: PresentedDelivery[];
	onopen?: (path: string) => void;
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DeliverablesPopup, {
		target,
		props: { ...props, open: true, triggerEl: document.createElement('div') }
	});
	flushSync();
	return { target, instance };
}

describe('DeliverablesPopup row-click open seat', () => {
	it('a row click invokes onopen exactly once with the FULL path', () => {
		const onopen = vi.fn();
		const { target, instance } = mountPopup({ deliveries: FIXTURE, onopen });
		const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')];
		(rows[0] as HTMLButtonElement).click();
		flushSync();
		expect(onopen).toHaveBeenCalledTimes(1);
		expect(onopen).toHaveBeenCalledWith('/tmp/report.md');
		expect(onopen).toHaveBeenCalledWith(expect.stringContaining('report.md'));
		unmount(instance);
	});

	it('omitting onopen does not throw on a row click', () => {
		const { target, instance } = mountPopup({ deliveries: FIXTURE });
		const row = target.querySelector('[data-testid="deliverables-popup-row"]') as HTMLButtonElement;
		expect(() => {
			row.click();
			flushSync();
		}).not.toThrow();
		unmount(instance);
	});

	it('two rows from different deliveries each carry their own path', () => {
		const onopen = vi.fn();
		const { target, instance } = mountPopup({ deliveries: FIXTURE, onopen });
		const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')];
		expect(rows.length).toBe(2);
		(rows[0] as HTMLButtonElement).click();
		flushSync();
		(rows[1] as HTMLButtonElement).click();
		flushSync();
		expect(onopen).toHaveBeenCalledTimes(2);
		expect(onopen).toHaveBeenNthCalledWith(1, '/tmp/report.md');
		expect(onopen).toHaveBeenNthCalledWith(2, '/tmp/chart.png');
		unmount(instance);
	});
});
