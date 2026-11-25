/**
 * DeliverablesPopup — the bindable `open` prop's TRUE default arm
 * (2026-11-25 branch mop): `open = $bindable(false)` supplies a
 * default the earlier default-open suite never hit — it passed
 * `open: false` explicitly. Mounting with the prop omitted entirely
 * is what exercises the default: the popup must stay closed (no box,
 * no rows) and stay closed after prop-less re-render flushes.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import DeliverablesPopup from '../../src/lib/components/anchor/deliverables-anchor/DeliverablesPopup.svelte';
import type { PresentedDelivery } from '../../src/lib/services/conversation/deliverables';

const FIXTURE: PresentedDelivery[] = [
	{ turn: 1, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] }
];

describe('DeliverablesPopup — $bindable(false) default arm (open omitted)', () => {
	it('omitting open entirely mounts closed — no popup box, no rows', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		// open is NOT in props at all — this is the default-value arm
		const instance = mount(DeliverablesPopup, {
			target,
			props: { deliveries: FIXTURE, triggerEl: document.createElement('div') } as Parameters<typeof mount>[1] extends infer P ? Record<string, unknown> & { target: HTMLElement } : never
		});
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		expect(target.querySelector('[data-testid="deliverables-popup-header"]')).toBeNull();
		expect(target.querySelector('[data-testid="deliverables-popup-row"]')).toBeNull();
		unmount(instance);
	});

	it('a later flush with the prop still omitted keeps it closed', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(DeliverablesPopup, {
			target,
			props: { deliveries: FIXTURE, triggerEl: target } as unknown as Parameters<typeof mount>[1]
		});
		flushSync();
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		unmount(instance);
	});
});