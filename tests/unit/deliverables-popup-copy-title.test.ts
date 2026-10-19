/**
 * DeliverablesPopup — CopyButton child + hover title per row
 * (ADR-0027f D3 amendment 2026-10-19): each row's CopyButton receives the
 * FULL file.path as its value, the row button's hover title is the full
 * path, and the popup testids (root + header) are present.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi, afterEach } from 'vitest';
import DeliverablesPopup from '../../src/lib/components/anchor/deliverables-anchor/DeliverablesPopup.svelte';
import type { PresentedDelivery } from '../../src/lib/services/conversation/deliverables';

const FIXTURE: PresentedDelivery[] = [
	{ turn: 1, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] },
	{
		turn: 2,
		callId: 'c2',
		files: [{ path: '/tmp/chart.png' }, { path: '/tmp/data.csv', description: 'raw numbers' }]
	}
];

function mountPopup(deliveries: PresentedDelivery[]) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DeliverablesPopup, {
		target,
		props: { deliveries, triggerEl: target, open: true }
	});
	flushSync();
	return { target, instance };
}

describe('DeliverablesPopup — copy value + hover title', () => {
	it('renders the popup with root and header testids', () => {
		const { target, instance } = mountPopup(FIXTURE);
		expect(target.querySelector('[data-testid="deliverables-popup"]')).not.toBeNull();
		const header = target.querySelector('[data-testid="deliverables-popup-header"]');
		expect(header).not.toBeNull();
		expect(header?.textContent).toContain('3');
		unmount(instance);
	});

	it('each row button carries the full path as its hover title', () => {
		const { target, instance } = mountPopup(FIXTURE);
		const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')] as HTMLButtonElement[];
		expect(rows.length).toBe(3);
		expect(rows.map((r) => r.getAttribute('title'))).toEqual([
			'/tmp/report.md',
			'/tmp/chart.png',
			'/tmp/data.csv'
		]);
		unmount(instance);
	});

	it("every row's CopyButton copies the row's FULL file.path (not the label)", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const { target, instance } = mountPopup(FIXTURE);
		const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')];
		const expected = ['/tmp/report.md', '/tmp/chart.png', '/tmp/data.csv'];
		for (let i = 0; i < rows.length; i++) {
			const copy = rows[i]?.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement;
			expect(copy).not.toBeNull();
			expect(copy.getAttribute('title')).toBe('Copy full path');
			copy.click();
			flushSync();
			// clipboard write is async — let the feedback promise settle
			await Promise.resolve();
			expect(writeText).toHaveBeenNthCalledWith(i + 1, expected[i]);
		}
		expect(target.querySelectorAll('[data-testid="copy-text-button"]').length).toBe(3);
		unmount(instance);
	});

	it("a CopyButton click does NOT trigger the row's file-open seat (stopPropagation)", () => {
		const onopen = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(DeliverablesPopup, {
			target,
			props: { deliveries: FIXTURE, triggerEl: target, open: true, onopen }
		});
		flushSync();
		const copy = target.querySelector('[data-testid="copy-text-button"]') as HTMLButtonElement;
		copy.click();
		flushSync();
		expect(onopen).not.toHaveBeenCalled();
		unmount(instance);
	});
});
