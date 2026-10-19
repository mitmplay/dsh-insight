/**
 * DeliverablesPopup unit tests — header file-count math + nested each
 * rows (ADR-0027f D3 amendment 2026-10-19): the header sums file counts
 * across deliveries, an empty files array contributes 0 and renders no
 * rows, an empty delivery list shows 0 with no rows, and every row's
 * data-turn echoes its own delivery's turn.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import DeliverablesPopup from '../../src/lib/components/anchor/deliverables-anchor/DeliverablesPopup.svelte';
import type { PresentedDelivery } from '../../src/lib/services/conversation/deliverables';

function mountPopup(deliveries: PresentedDelivery[]) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DeliverablesPopup, {
		target,
		props: { deliveries, triggerEl: document.createElement('div'), open: true }
	});
	flushSync();
	return { target, instance };
}

describe('DeliverablesPopup header count + rows', () => {
	it('header sums file counts across multiple deliveries', () => {
		const FIXTURE: PresentedDelivery[] = [
			{ turn: 1, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] },
			{ turn: 2, callId: 'c2', files: [{ path: '/tmp/chart.png' }, { path: '/tmp/data.csv' }] }
		];
		const { target, instance } = mountPopup(FIXTURE);
		expect(target.querySelector('[data-testid="deliverables-popup-header"]')?.textContent).toContain('3');
		const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')];
		expect(rows.length).toBe(3);
		unmount(instance);
	});

	it('a delivery with an empty files array contributes 0 and renders no rows', () => {
		const FIXTURE: PresentedDelivery[] = [
			{ turn: 1, callId: 'c1', files: [] },
			{ turn: 2, callId: 'c2', files: [{ path: '/tmp/report.md' }] }
		];
		const { target, instance } = mountPopup(FIXTURE);
		expect(target.querySelector('[data-testid="deliverables-popup-header"]')?.textContent).toContain('1');
		const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')];
		expect(rows.length).toBe(1);
		expect(rows[0]?.getAttribute('data-turn')).toBe('2');
		unmount(instance);
	});

	it('empty deliveries: header shows 0 and no rows render', () => {
		const { target, instance } = mountPopup([]);
		expect(target.querySelector('[data-testid="deliverables-popup-header"]')?.textContent).toContain('0');
		expect(target.querySelector('[data-testid="deliverables-popup-row"]')).toBeNull();
		unmount(instance);
	});

	it('each row carries its own delivery turn in data-turn', () => {
		const FIXTURE: PresentedDelivery[] = [
			{ turn: 3, callId: 'c1', files: [{ path: '/tmp/a.md' }, { path: '/tmp/b.md' }] },
			{ turn: 7, callId: 'c2', files: [{ path: '/tmp/c.md' }] }
		];
		const { target, instance } = mountPopup(FIXTURE);
		const turns = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')].map((r) =>
			r.getAttribute('data-turn')
		);
		expect(turns).toEqual(['3', '3', '7']);
		unmount(instance);
	});
});
