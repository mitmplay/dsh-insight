/**
 * The Job Bridge (ADR-0081 D1/D2, PRD 4.5), Task 2.1-T: the ONE adoption
 * predicate both birth stages share (roster push + spine-tick snapshot).
 *
 * Table-driven: each of the four conditions vetoes on its own — and each
 * row carries a REPAIRED twin that flips only that condition back, so a
 * veto is attributable to its named condition, never to the fixture.
 * Then the traps the spec names: `stopping` is live, an unowned key is
 * `|id`, a settled job is never adoptable, and selectAdoptable is inert
 * across the SAME roster delivered twice (the replace-on-every-tick trap).
 */
import { describe, expect, it } from 'vitest';
import { isAdoptable, jobKey, selectAdoptable } from '$lib/services/jobs/job-adoption';
import type { DsiJobView } from '$lib/types';

const job = (over: Partial<DsiJobView> = {}): DsiJobView => ({
	id: 'bash-1',
	kind: 'bash',
	label: 'npm test',
	owner: 'conv-1',
	status: 'running',
	startedAt: 1,
	output: { total: 0, earliest: 0 },
	...over
});

const none = new Set<string>();

describe('jobKey — the follow relay\'s own identity', () => {
	it('an owned job keys as owner|id (JobFollowRelay.keyOf)', () => {
		expect(jobKey(job())).toBe('conv-1|bash-1');
	});

	it('an unowned job has no owner: its key is |id (planner call P4)', () => {
		expect(jobKey(job({ owner: undefined }))).toBe('|bash-1');
	});
});

describe('isAdoptable — the four conditions', () => {
	it('adopts when ALL four hold: consent on, live, no row, not dismissed', () => {
		expect(isAdoptable(job(), none, none, true)).toBe(true);
	});

	type Case = {
		name: string;
		vetoed: DsiJobView;
		attached: Set<string>;
		dismissed: Set<string>;
		autoAttach: boolean;
		/** the SAME row with only the named condition repaired */
		repaired: () => boolean;
	};

	const cases: Case[] = [
		{
			name: '1 · autoAttach is off (consent withdrawn)',
			vetoed: job(),
			attached: none,
			dismissed: none,
			autoAttach: false,
			repaired: () => isAdoptable(job(), none, none, true)
		},
		{
			name: '2 · status completed (settled — never adoptable)',
			vetoed: job({ status: 'completed', finishedAt: 2 }),
			attached: none,
			dismissed: none,
			autoAttach: true,
			repaired: () => isAdoptable(job(), none, none, true)
		},
		{
			name: '2 · status killed',
			vetoed: job({ status: 'killed', finishedAt: 2 }),
			attached: none,
			dismissed: none,
			autoAttach: true,
			repaired: () => isAdoptable(job(), none, none, true)
		},
		{
			name: '2 · status failed',
			vetoed: job({ status: 'failed', finishedAt: 2 }),
			attached: none,
			dismissed: none,
			autoAttach: true,
			repaired: () => isAdoptable(job(), none, none, true)
		},
		{
			name: '3 · a row is already attached for this key',
			vetoed: job(),
			attached: new Set(['conv-1|bash-1']),
			dismissed: none,
			autoAttach: true,
			repaired: () => isAdoptable(job(), none, none, true)
		},
		{
			name: '4 · the operator dismissed this key this session',
			vetoed: job(),
			attached: none,
			dismissed: new Set(['conv-1|bash-1']),
			autoAttach: true,
			repaired: () => isAdoptable(job(), none, none, true)
		}
	];

	it.each(cases)('vetoes on its own: $name', ({ vetoed, attached, dismissed, autoAttach, repaired }) => {
		expect(isAdoptable(vetoed, attached, dismissed, autoAttach)).toBe(false);
		expect(selectAdoptable([vetoed], attached, dismissed, autoAttach)).toEqual([]);
		// control: repairing ONLY that condition makes the same job adoptable
		expect(repaired()).toBe(true);
	});

	it('stopping counts as live (isLiveJob) — still adoptable', () => {
		expect(isAdoptable(job({ status: 'stopping' }), none, none, true)).toBe(true);
	});

	it('an unowned job is adoptable exactly like an owned one', () => {
		const unowned = job({ owner: undefined });
		expect(isAdoptable(unowned, none, none, true)).toBe(true);
		// and its dismissal keys on |id, not on some owner
		expect(isAdoptable(unowned, none, new Set(['|bash-1']), true)).toBe(false);
	});

	it('keys are per owner: another owner\'s attached row never vetoes mine', () => {
		expect(isAdoptable(job({ owner: 'conv-2' }), new Set(['conv-1|bash-1']), none, true)).toBe(true);
	});

	it('a wire entry without an id is malformed — never adoptable', () => {
		const noId = job({ id: '' }) as DsiJobView;
		expect(isAdoptable(noId, none, none, true)).toBe(false);
		expect(isAdoptable(undefined as unknown as DsiJobView, none, none, true)).toBe(false);
		const survivors = selectAdoptable([undefined as unknown as DsiJobView, job()], none, none, true);
		expect(survivors.map((j) => j.id)).toEqual(['bash-1']);
	});
});

describe('selectAdoptable — filtering a roster frame', () => {
	const roster = [
		job({ id: 'bash-1' }),
		job({ id: 'bash-2', status: 'completed' }),
		job({ id: 'bash-3', owner: undefined }),
		job({ id: 'bash-4', status: 'stopping' })
	];

	it('keeps the adoptable jobs in frame order and drops the rest', () => {
		expect(selectAdoptable(roster, none, none, true).map((j) => j.id)).toEqual(['bash-1', 'bash-3', 'bash-4']);
	});

	it('returns nothing at all when consent is off', () => {
		expect(selectAdoptable(roster, none, none, false)).toEqual([]);
	});

	it('skips a key the operator dismissed, keeps the others', () => {
		const out = selectAdoptable(roster, none, new Set(['|bash-3', 'conv-1|bash-4']), true);
		expect(out.map((j) => j.id)).toEqual(['bash-1']);
	});

	it('is inert across the SAME roster delivered twice — the replace-on-every-tick trap', () => {
		// The desk\'s own record: a key joins `attached` once its row exists.
		const attached = new Set<string>();
		const first = selectAdoptable(roster, attached, none, true);
		expect(first.map((j) => j.id)).toEqual(['bash-1', 'bash-3', 'bash-4']);
		for (const j of first) attached.add(jobKey(j));
		// every later spine tick re-delivers the identical running set…
		expect(selectAdoptable(roster, attached, none, true)).toEqual([]);
		expect(selectAdoptable(roster, attached, none, true)).toEqual([]);
	});

	it('a dismissal stays sticky across repeated deliveries, not just once', () => {
		const attached = new Set<string>();
		const dismissed = new Set<string>();
		for (const j of selectAdoptable(roster, attached, none, true)) attached.add(jobKey(j));
		// the operator closes bash-1 while it is still running
		attached.delete('conv-1|bash-1');
		dismissed.add('conv-1|bash-1');
		for (let tick = 0; tick < 5; tick++) {
			const again = selectAdoptable(roster, attached, dismissed, true);
			expect(again.map((j) => j.id)).toEqual([]); // bash-1 never resurrects
		}
	});

	it('returns each key at most once even when one frame repeats it', () => {
		const twice = [job(), job({ label: 'same key, later entry' }), job({ id: 'bash-9' })];
		expect(selectAdoptable(twice, none, none, true).map((j) => j.id)).toEqual(['bash-1', 'bash-9']);
	});

	it('handles an empty roster', () => {
		expect(selectAdoptable([], none, none, true)).toEqual([]);
	});
});
