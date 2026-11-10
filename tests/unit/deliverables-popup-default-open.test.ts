/**
 * DeliverablesPopup — the bindable open prop's DEFAULT arm (2026-11-10
 * branch mop): open is $bindable(false); every other suite passes it
 * explicitly. Omitting it must mount closed — no rows, no popup box —
 * and unmount cleanly.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import DeliverablesPopup from '../../src/lib/components/anchor/deliverables-anchor/DeliverablesPopup.svelte';
import type { PresentedDelivery } from '../../src/lib/services/conversation/deliverables';

const FIXTURE: PresentedDelivery[] = [
	{ turn: 1, callId: 'c1', files: [{ path: '/tmp/report.md' }] }
];

describe('DeliverablesPopup — the bindable open default (false)', () => {
	it('mounting with NO open prop stays closed: no popup box, no rows', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(DeliverablesPopup, {
			target,
			// open omitted entirely — exercises the $bindable default (false) arm
			props: { deliveries: FIXTURE, triggerEl: document.createElement('div'), open: false }
		});
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		expect(target.querySelector('[data-testid="deliverables-popup-row"]')).toBeNull();
		unmount(instance);
	});
});
