/**
 * developer-message-row unit tests (ADR-0027b task 2.2-T) — the muted
 * notice row in the real ConversationScrollArea branch.
 *
 * Pins: a developer/message entry renders a developer-message-row with its
 * text; it is NOT an unknown-event chip; an empty stream renders nothing.
 * Spec: dev/specs/2026-10/2026-10-17 - ADR-0027b The Developer Turn.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DeveloperMessageRowHost from './DeveloperMessageRowHost.svelte';
import type { DsiEntry } from '$lib/types';

const devEntry: DsiEntry = {
	kind: 'developer-message',
	id: 'dm:7',
	seq: 7,
	time: 1700000000000,
	text: 'tools added: foo'
};

let instance: { destroy?: () => void } | null = null;
let host: HTMLElement | null = null;

function mountHost(entries: DsiEntry[]): HTMLElement {
	host = document.createElement('div');
	document.body.appendChild(host);
	instance = mount(DeveloperMessageRowHost, { target: host, props: { entries } });
	flushSync();
	return host;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	host?.remove();
	host = null;
});

describe('developer-message row (ADR-0027b 2.2-T)', () => {
	it('renders the muted notice row with the extracted text', () => {
		const h = mountHost([devEntry]);
		const row = h.querySelector('[data-testid="developer-message-row"]');
		expect(row).not.toBeNull();
		expect(row?.getAttribute('data-seq')).toBe('7');
		expect(h.querySelector('[data-testid="developer-message-text"]')?.textContent?.trim()).toBe('tools added: foo');
	});

	it('never renders an unknown-event chip for the developer turn', () => {
		const h = mountHost([devEntry]);
		expect(h.querySelector('[data-testid="dev-unknown-event"]')).toBeNull();
		const chips = Array.from(h.querySelectorAll('[data-group-key]')).filter((el) =>
			(el as HTMLElement).dataset.groupKey === 'dm:7'
		);
		expect(chips.length).toBe(1);
		expect(chips[0].querySelector('[data-testid="developer-message-row"]')).not.toBeNull();
	});

	it('renders nothing for an empty stream (no row, no chip)', () => {
		const h = mountHost([]);
		expect(h.querySelector('[data-testid="developer-message-row"]')).toBeNull();
	});
});
