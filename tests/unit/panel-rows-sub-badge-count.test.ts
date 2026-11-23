/**
 * panel-rows × subagentCountFor (ADR-0078 D2, task 2.2-T) — the panel
 * layer calls the SAME helper the spine caller derives from, so spine
 * and panels agree on the number for the same fixture list. Spec:
 * dev/specs/2026-11/2026-11-23 - Sub-Agent Parent Badge.
 */
import { describe, expect, it } from 'vitest';
import { subagentCountFor } from '../../src/lib/services/panels/panel-rows';
import type { DsiSessionSummary } from '../../src/lib/types';

function sess(sessionId: string, parentSessionId: string | null, origin: DsiSessionSummary['origin']): DsiSessionSummary {
	return {
		sessionId,
		title: 's-' + sessionId,
		workspace: '/tmp/ws',
		running: false,
		updatedAt: Date.now(),
		parentSessionId,
		origin,
		agentPreset: null
	} as DsiSessionSummary;
}

const list: DsiSessionSummary[] = [
	sess('p', null, null),
	sess('sub-1', 'p', 'subagent'),
	sess('sub-2', 'p', 'subagent'),
	sess('sub-3', 'p', 'subagent'),
	sess('fork-1', 'p', 'scheduled'),
	sess('grand', 'sub-2', 'subagent')
];

describe('panel-rows — subagentCountFor (ADR-0078 2.2-T)', () => {
	it('counts 3 subagent children for the parent (forks excluded)', () => {
		expect(subagentCountFor('p', list)).toBe(3);
	});

	it('a child row counts nothing', () => {
		expect(subagentCountFor('sub-1', list)).toBe(0);
	});

	it('an id with no rows counts 0', () => {
		expect(subagentCountFor('ghost', list)).toBe(0);
	});

	it('duplicate child rows (defensive) count DISTINCT ids once', () => {
		const duped = [...list, sess('sub-1', 'p', 'subagent')];
		expect(subagentCountFor('p', duped)).toBe(3);
	});
});
