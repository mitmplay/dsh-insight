/**
 * DeliverablesPopup displayName() unit tests (ADR-0027f D3 amendment
 * 2026-10-19): the row label is the bare filename with the extension
 * stripped — exercised through rendered rows (no description → the
 * displayName fallback is the visible line). Branches pinned:
 * deep path, extension-less basename, dotfile, multi-dot basename.
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
		props: { deliveries, triggerEl: target, open: true }
	});
	flushSync();
	return { target, instance };
}

function rowLabels(paths: string[]): string[] {
	const files = paths.map((path) => ({ path }));
	const { target, instance } = mountPopup([{ turn: 1, callId: 'c1', files }]);
	const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')];
	const labels = rows.map((r) => r.textContent?.trim() ?? '');
	unmount(instance);
	return labels;
}

describe('DeliverablesPopup displayName()', () => {
	it('a deep path with an extension yields the basename sans extension', () => {
		expect(rowLabels(['/tmp/build/out/report.final.md'])).toEqual(['report.final']);
	});

	it('a basename with NO dot is used whole', () => {
		expect(rowLabels(['/tmp/LICENSE'])).toEqual(['LICENSE']);
	});

	it('a dotfile (dot at index 0) keeps its full name', () => {
		expect(rowLabels(['/srv/app/.env'])).toEqual(['.env']);
	});

	it('a multi-dot basename strips only the last extension', () => {
		expect(rowLabels(['/tmp/archive.test.tar.gz'])).toEqual(['archive.test.tar']);
	});
});
