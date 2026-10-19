/**
 * DeliverablesPopup — the row-label branch (line 74):
 * file.description ?? displayName(file.path). The label is the
 * description when the model supplied one (even an empty string —
 * empty is NOT nullish), and the extension-stripped basename
 * otherwise (undefined / null description).
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
		props: { deliveries, open: true, triggerEl: document.createElement('div') }
	});
	flushSync();
	return { target, instance };
}

function rowLabels(target: HTMLElement): string[] {
	return [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')].map(
		(r) => (r.querySelector('span') as HTMLElement).textContent
	);
}

describe('DeliverablesPopup row label (description ?? displayName)', () => {
	it('description present — the span shows the description, NOT the filename', () => {
		const { target, instance } = mountPopup([
			{ turn: 1, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] }
		]);
		expect(rowLabels(target)).toEqual(['the report']);
		expect(target.querySelector('[data-testid="deliverables-popup-row"]')?.getAttribute('title')).toBe(
			'/tmp/report.md'
		);
		unmount(instance);
	});

	it('description undefined / null — fallback to the extension-stripped basename', () => {
		const { target, instance } = mountPopup([
			{
				turn: 1,
				callId: 'c1',
				files: [
					{ path: '/tmp/chart.png' },
					{ path: '/a/b/c/notes.dev.md', description: null as unknown as undefined }
				]
			}
		]);
		expect(rowLabels(target)).toEqual(['chart', 'notes.dev']);
		unmount(instance);
	});

	it('description empty string — NOT nullish, so the label renders empty', () => {
		const { target, instance } = mountPopup([
			{ turn: 1, callId: 'c1', files: [{ path: '/tmp/data.csv', description: '' }] }
		]);
		expect(rowLabels(target)).toEqual(['']);
		unmount(instance);
	});
});
