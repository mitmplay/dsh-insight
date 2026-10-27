/**
 * DsiSubagentRow wire view — type contract (Subagent Anchor Wave 1, Task
 * 1.1-T): every field present with the right runtime shape; both token
 * lanes representable (folded totals, and the honest null on a missing
 * projection). A fixture typed as DsiSubagentRow must compile AND satisfy
 * these runtime assertions — the null lanes are the spec's honesty lanes.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { DsiSubagentRow } from '$lib/types';

describe('DsiSubagentRow wire view', () => {
	it('carries every field with the right runtime shape', () => {
		const row: DsiSubagentRow = {
			sessionId: 'session-child',
			title: 'Explore repo',
			parentTitle: 'Parent session',
			tokens: { input: 1_200_000, output: 42_000 },
			operateMs: 7_800_000,
			running: true,
			updatedAt: 1_770_000_000_000
		};
		expect(typeof row.sessionId).toBe('string');
		expect(row.title).toBeTypeOf('string');
		expect(row.parentTitle).toBeTypeOf('string');
		expect(row.tokens).toEqual({ input: 1_200_000, output: 42_000 });
		expect(row.running).toBe(true);
		expect(row.updatedAt).toBeTypeOf('number');
		expectTypeOf(row).toEqualTypeOf<DsiSubagentRow>();
	});

	it('represents the null lanes: null tokens, null titles', () => {
		const degraded: DsiSubagentRow = {
			sessionId: 'session-drift',
			title: null,
			parentTitle: null,
			tokens: null,
			operateMs: null,
			running: false,
			updatedAt: 0
		};
		expect(degraded.tokens).toBeNull();
		expect(degraded.title).toBeNull();
		expect(degraded.parentTitle).toBeNull();
		expect(degraded.running).toBe(false);
	});

	it('token lanes are exhaustive: the pair or null — never a synthesized scalar', () => {
		// Type-level: DsiSubagentRow['tokens'] accepts exactly the pair or null.
		expectTypeOf<DsiSubagentRow['tokens']>().toEqualTypeOf<{ input: number; output: number } | null>();
	});
});
