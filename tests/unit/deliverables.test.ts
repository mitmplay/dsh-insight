/**
 * deliverables unit tests — the ADR-0027f D1 reducer: accumulation order,
 * multi-file events, empty input, junk payloads skipped whole.
 */
import { describe, expect, it } from 'vitest';
import {
	deliverablesFromEvents,
	isDeliverablesEventType,
	type PresentedDelivery
} from '../../src/lib/services/conversation/deliverables';
import type { DshRawEvent } from '../../src/lib/services/conversation/events/content';

function ev(seq: number, data: unknown, type = 'deliverables/presented'): DshRawEvent {
	return { seq, time: seq * 1000, type, data } as DshRawEvent;
}

describe('deliverablesFromEvents', () => {
	it('collects deliverables events in ledger order, newest last', () => {
		const out = deliverablesFromEvents([
			ev(1, { turn: 1, callId: 'a', files: [{ path: '/tmp/one.md' }] }),
			ev(2, { turn: 2, callId: 'b', files: [{ path: '/tmp/two.md' }] })
		]);
		expect(out.map((d) => d.callId)).toEqual(['a', 'b']);
	});

	it('one event can carry many files, kept in wire order with descriptions', () => {
		const out = deliverablesFromEvents([
			ev(1, {
				turn: 3,
				callId: 'c',
				files: [
					{ path: '/tmp/x.png', description: 'chart' },
					{ path: '/tmp/y.csv' },
					{ path: '/tmp/z.md', description: '' }
				]
			})
		]);
		expect(out[0]?.files).toEqual([
			{ path: '/tmp/x.png', description: 'chart' },
			{ path: '/tmp/y.csv' },
			{ path: '/tmp/z.md' }
		]);
	});

	it('empty input and event lists with no deliverables reduce to []', () => {
		expect(deliverablesFromEvents([])).toEqual<PresentedDelivery[]>([]);
		expect(
			deliverablesFromEvents([
				ev(1, { turn: 1, callId: 'a', files: [{ path: '/x' }] }, 'user/message'),
				ev(2, { turn: 1 }, 'todo/write')
			])
		).toEqual<PresentedDelivery[]>([]);
	});

	it('junk payloads are skipped whole, never partially kept', () => {
		const junk = [
			undefined,
			null,
			'string',
			{},
			{ turn: 'x', callId: 'a', files: [{ path: '/x' }] },
			{ turn: 1, callId: '', files: [{ path: '/x' }] },
			{ turn: 1, callId: 'a' },
			{ turn: 1, callId: 'a', files: [] },
			{ turn: 1, callId: 'a', files: 'no' },
			{ turn: 1, callId: 'a', files: [{ path: '' }] },
			{ turn: 1, callId: 'a', files: [{ path: 7 }, { path: '/ok' }] }
		];
		for (const [i, data] of junk.entries()) {
			expect(deliverablesFromEvents([ev(i + 1, data)]), `case ${i}`).toEqual<PresentedDelivery[]>([]);
		}
	});

	it('a junk event between two good ones only drops itself', () => {
		const out = deliverablesFromEvents([
			ev(1, { turn: 1, callId: 'a', files: [{ path: '/a' }] }),
			ev(2, { turn: 1, callId: 'b', files: null }),
			ev(3, { turn: 2, callId: 'c', files: [{ path: '/c' }] })
		]);
		expect(out.map((d) => d.callId)).toEqual(['a', 'c']);
	});
});

describe('isDeliverablesEventType', () => {
	it('matches exactly the wire spelling', () => {
		expect(isDeliverablesEventType('deliverables/presented')).toBe(true);
		expect(isDeliverablesEventType('deliverables/other')).toBe(false);
	});
});
