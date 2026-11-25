/**
 * clampDeskMirror job-entry persistence tests (The Job Bridge, ADR-0081 — Task
 * 4.2-T; successor of the 2026-10-21 job-TAB amendment's clamp tests, which
 * this file used to pin as "job tabs"). The remembered entries are job ROWS:
 * `jobs: [{ owner, jobId }]` is the shape the desk's mirror publishes (from its
 * rows) and the rebuild ladder consumes (live jobs only — that half is pinned in
 * terminal-desk-rebuild-jobs.test.ts).
 *   - remembered jobs survive the clamp beside shells
 *   - a shells-only-empty (job-only) mirror stays usable — and its stored
 *     index clamps to 0: a job row is no tab of its own, it rides a shell tab,
 *     and the ONE fallback shell is the only selectable tab (the tab era's
 *     `tabs.length + jobs.length` rule existed for the first job TAB)
 *   - junk drops FIELD-WISE: a non-string owner or jobId drops, an empty jobId
 *     drops — never a phantom row
 *   - an UNOWNED job (owner '') round-trips (ADR-0081 P4: unowned jobs attach as
 *     rows; the empty-owner drop dated from the tab era)
 */
import { describe, expect, it } from 'vitest';
import { clampDeskMirror } from '../../src/lib/utils/panel-prefs';

describe('clampDeskMirror — job rows', () => {
	it('keeps remembered jobs beside shells', () => {
		const m = clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0, jobs: [{ owner: 's1', jobId: 'bash-1' }] });
		expect(m?.jobs).toEqual([{ owner: 's1', jobId: 'bash-1' }]);
		expect(m?.tabs).toEqual([{ sessionIds: ['s1'] }]);
		expect(m?.selectedTab).toBe(0);
	});

	it('keeps a job-only mirror usable when shells are empty — the index clamps to 0 (one fallback shell)', () => {
		const m = clampDeskMirror({ tabs: [], selectedTab: 1, jobs: [{ owner: 's1', jobId: 'bash-9' }] });
		expect(m?.tabs).toEqual([]);
		expect(m?.jobs).toHaveLength(1);
		expect(m?.selectedTab).toBe(0); // the tab era clamped to 1 (the first job tab index)
		// any stored index lands on the same one shell
		expect(clampDeskMirror({ tabs: [], selectedTab: 0, jobs: [{ owner: 's1', jobId: 'a' }] })?.selectedTab).toBe(0);
		expect(clampDeskMirror({ tabs: [], selectedTab: 7, jobs: [{ owner: 's1', jobId: 'a' }] })?.selectedTab).toBe(0);
	});

	it('a job entry never widens the selection: the index clamps into the SHELL tabs only', () => {
		const jobs = [{ owner: 's1', jobId: 'bash-1' }, { owner: 's2', jobId: 'bash-2' }];
		// two shells + two jobs: 5 would once have clamped onto the second job tab (4)
		expect(clampDeskMirror({ tabs: [{ sessionIds: ['a'] }, { sessionIds: ['b'] }], selectedTab: 5, jobs })?.selectedTab).toBe(1);
		// 2 = the first job tab under the old rule — now the last shell's neighbour
		expect(clampDeskMirror({ tabs: [{ sessionIds: ['a'] }, { sessionIds: ['b'] }], selectedTab: 2, jobs })?.selectedTab).toBe(1);
		expect(clampDeskMirror({ tabs: [{ sessionIds: ['a'] }, { sessionIds: ['b'] }], selectedTab: 1, jobs })?.selectedTab).toBe(1);
	});

	it('drops junk jobs field-wise and undefined when nothing usable', () => {
		expect(clampDeskMirror({ tabs: [], jobs: [{ owner: 1, jobId: 'x' }, null, 'x'] })).toBeUndefined();
		expect(clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], jobs: 'junk' })).toEqual({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0 });
	});

	it('each field must be right: a non-string owner, a non-string or EMPTY jobId, a missing field — the entry drops', () => {
		const junk = [
			{ owner: 7, jobId: 'x' }, // owner is a number
			{ owner: null, jobId: 'x' },
			{ jobId: 'x' }, // no owner
			{ owner: 'x' }, // no jobId
			{ owner: 'x', jobId: '' }, // empty id — nothing to follow
			{ owner: 'x', jobId: 3 },
			{ owner: 'x', jobId: null },
			42,
			undefined
		];
		const m = clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0, jobs: [...junk, { owner: 's1', jobId: 'keep' }] });
		expect(m?.jobs).toEqual([{ owner: 's1', jobId: 'keep' }]); // junk drops ONE entry, never the mirror
		expect(clampDeskMirror({ tabs: [], jobs: junk })).toBeUndefined(); // nothing usable
		expect(clampDeskMirror({ tabs: [], jobs: {} })).toBeUndefined(); // jobs is not an array
	});

	it('only owner + jobId survive an entry — extra fields are not carried into the mirror', () => {
		const m = clampDeskMirror({ tabs: [], selectedTab: 0, jobs: [{ owner: 's1', jobId: 'j1', label: 'stale', settled: true, events: [] }] });
		expect(m?.jobs).toEqual([{ owner: 's1', jobId: 'j1' }]);
		expect(JSON.stringify(m)).toBe('{"tabs":[],"selectedTab":0,"jobs":[{"owner":"s1","jobId":"j1"}]}');
	});

	it('an UNOWNED entry round-trips: { owner: \'\', jobId } is a remembered job too', () => {
		const m = clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0, jobs: [{ owner: '', jobId: 'u1' }] });
		expect(m?.jobs).toEqual([{ owner: '', jobId: 'u1' }]);
		// job-only + unowned: still a usable mirror
		expect(clampDeskMirror({ tabs: [], selectedTab: 2, jobs: [{ owner: '', jobId: 'u1' }] })).toEqual({ tabs: [], selectedTab: 0, jobs: [{ owner: '', jobId: 'u1' }] });
	});

	it('a mirror without jobs keeps the legacy shape — no jobs key is invented', () => {
		expect(clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0 })).toEqual({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0 });
		expect(clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0, jobs: [] })).toEqual({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0 });
		expect(clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0, jobs: [{ owner: '', jobId: '' }] })).toEqual({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0 });
	});
});
