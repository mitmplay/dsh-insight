/**
 * ADR-0027f D4 mapper tests: deliverables/presented renders null (the
 * hand-off), while another unknown type still chips (the alarm intact),
 * and the raw-lane field rides the delta beside the (now empty) entries.
 */
import { describe, expect, it } from 'vitest';
import { entryForEvent } from '../../src/lib/services/conversation/dsh-events';

describe('deliverables/presented hand-off (ADR-0027f D4)', () => {
	it('renders null — the DeliverablesButton popup owns the content', () => {
		expect(
			entryForEvent({
				seq: 1,
				time: 1,
				type: 'deliverables/presented',
				data: { turn: 1, callId: 'c', files: [{ path: '/a.md' }] }
			} as never)
		).toBeNull();
	});

	it('a junk payload of the type is silent too (no alarm chip for it)', () => {
		expect(
			entryForEvent({ seq: 2, time: 2, type: 'deliverables/presented', data: null } as never)
		).toBeNull();
	});

	it('the alarm stays armed: another unknown type still chips', () => {
		expect(
			entryForEvent({ seq: 3, time: 3, type: 'plugin/frobnicated', data: { x: 1 } as never } as never)
		).toMatchObject({ kind: 'unknown-event', eventType: 'plugin/frobnicated' });
	});
});
