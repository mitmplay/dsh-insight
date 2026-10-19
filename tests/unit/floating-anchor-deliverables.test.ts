/**
 * ConversationFloatingAnchor × DeliverablesButton (ADR-0027f, task 5.3-T):
 * the anchor renders the DeliverablesButton ONLY when the fed inventory is
 * non-empty — nothing deliverable-shaped when null/empty. Row clicks thread
 * the page's onfileopen seat through.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import ConversationFloatingAnchor from '../../src/lib/components/conversation/ConversationFloatingAnchor.svelte';

const DELIVERIES = [
	{ turn: 1, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] }
];

function mountAnchor(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(ConversationFloatingAnchor, {
		target,
		props: { groups: [], container: document.createElement('div'), ...props }
	});
	flushSync();
	return { component, target };
}

describe('ConversationFloatingAnchor DeliverablesButton', () => {
	it('renders the DeliverablesButton when the session has presented files', () => {
		const { component, target } = mountAnchor({ deliverables: DELIVERIES });
		expect(target.querySelector('[data-testid="deliverables-button"]')).not.toBeNull();
		unmount(component);
	});

	it('renders nothing deliverable-shaped when the list is null or empty', () => {
		const a = mountAnchor({ deliverables: null });
		expect(a.target.querySelector('[data-testid="deliverables-button"]')).toBeNull();
		unmount(a.component);
		const b = mountAnchor({ deliverables: [] });
		expect(b.target.querySelector('[data-testid="deliverables-button"]')).toBeNull();
		unmount(b.component);
	});

	it('a popup row click threads the onfileopen seat', () => {
		const onfileopen = vi.fn();
		const { component, target } = mountAnchor({ deliverables: DELIVERIES, onfileopen });
		(target.querySelector('[data-testid="deliverables-button"]') as HTMLButtonElement).click();
		flushSync();
		const row = target.querySelector('[data-testid="deliverables-popup-row"]') as HTMLButtonElement;
		expect(row).not.toBeNull();
		row.click();
		flushSync();
		expect(onfileopen).toHaveBeenCalledWith('/tmp/report.md');
		unmount(component);
	});
});
