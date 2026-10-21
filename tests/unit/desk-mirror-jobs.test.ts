/**
 * clampDeskMirror job-tab persistence tests (D5 amendment, 2026-10-21):
 * remembered -J tabs survive the clamp; junk drops field-wise; an empty
 * shells array with remembered jobs stays usable.
 */
import { describe, expect, it } from 'vitest';
import { clampDeskMirror } from '../../src/lib/utils/panel-prefs';

describe('clampDeskMirror — job tabs', () => {
	it('keeps remembered jobs beside shells', () => {
		const m = clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0, jobs: [{ owner: 's1', jobId: 'bash-1' }] });
		expect(m?.jobs).toEqual([{ owner: 's1', jobId: 'bash-1' }]);
		expect(m?.tabs).toEqual([{ sessionIds: ['s1'] }]);
	});

	it('keeps a job-only mirror usable when shells are empty', () => {
		const m = clampDeskMirror({ tabs: [], selectedTab: 1, jobs: [{ owner: 's1', jobId: 'bash-9' }] });
		expect(m?.tabs).toEqual([]);
		expect(m?.jobs).toHaveLength(1);
		expect(m?.selectedTab).toBe(1);
	});

	it('drops junk jobs field-wise and undefined when nothing usable', () => {
		expect(clampDeskMirror({ tabs: [], jobs: [{ owner: 1, jobId: 'x' }, null, 'x'] })).toBeUndefined();
		expect(clampDeskMirror({ tabs: [{ sessionIds: ['s1'] }], jobs: 'junk' })).toEqual({ tabs: [{ sessionIds: ['s1'] }], selectedTab: 0 });
	});
});
