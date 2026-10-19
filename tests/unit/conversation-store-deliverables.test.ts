/**
 * Store deliverables tests (ADR-0027f D1, task 3.1-T): delta-append
 * idempotence by callId, resync wholesale replace, undefined keeps state.
 */
import { describe, expect, it } from 'vitest';
import { createConversationStore } from '../../src/lib/services/conversation/store.svelte';
import type { PresentedDelivery } from '../../src/lib/services/conversation/deliverables';

const A: PresentedDelivery = { turn: 1, callId: 'a', files: [{ path: '/a.md' }] };
const B: PresentedDelivery = { turn: 2, callId: 'b', files: [{ path: '/b.md' }] };

function pollBody(deliverables?: PresentedDelivery[]) {
	return { entries: [], lastSeq: 10, running: false, ...(deliverables ? { deliverables } : {}) };
}

describe('store deliverables', () => {
	it('starts empty (the button gate)', () => {
		expect(createConversationStore('s1').deliverables).toEqual<PresentedDelivery[]>([]);
	});

	it('delta appends new callIds in order; re-delivered callIds never duplicate', () => {
		const store = createConversationStore('s1');
		store.applyPoll(pollBody([A]));
		store.applyPoll(pollBody([A, B])); // at-least-once re-delivery
		expect(store.deliverables.map((d) => d.callId)).toEqual(['a', 'b']);
	});

	it('resync replaces wholesale (authoritative ledger tail)', () => {
		const store = createConversationStore('s1');
		store.applyPoll(pollBody([A, B]));
		store.resyncFromLedgerEntries([], 5, false, undefined, undefined, [B]);
		expect(store.deliverables.map((d) => d.callId)).toEqual(['b']);
	});

	it('a poll without the field keeps current state', () => {
		const store = createConversationStore('s1');
		store.applyPoll(pollBody([A]));
		store.applyPoll(pollBody());
		expect(store.deliverables.map((d) => d.callId)).toEqual(['a']);
	});

	it('seedDeliverables replaces (cold-load seed semantics)', () => {
		const store = createConversationStore('s1');
		store.applyPoll(pollBody([A]));
		store.seedDeliverables([B]);
		expect(store.deliverables).toEqual<PresentedDelivery[]>([B]);
	});
});
