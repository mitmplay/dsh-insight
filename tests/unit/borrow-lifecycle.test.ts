import { describe, expect, it } from 'vitest';
import { reaperEligible } from '../../src/lib/server/browser/registry.js';

// Task 1.3-T — the lifecycle contract (ADR-0047 D4/D5), pure seams.
describe('borrowed lifecycle (task 1.3-T)', () => {
	const now = 1_000_000;

	it('a borrowed entry is NEVER reaper-eligible — no watchers, ancient traffic, still immune (D4)', () => {
		expect(reaperEligible({ streamSubscribers: 0, lastMcpActivity: 0, borrowed: true }, 60_000, now)).toBe(false);
	});

	it('a plain entry with the SAME dead signals stays eligible (the exemption is borrow-only)', () => {
		expect(reaperEligible({ streamSubscribers: 0, lastMcpActivity: 0 }, 60_000, now)).toBe(true);
	});

	it('a borrowed entry with live traffic is of course also immune', () => {
		expect(reaperEligible({ streamSubscribers: 2, lastMcpActivity: now, borrowed: true }, 60_000, now)).toBe(false);
	});
});
