/**
 * subagent-clock — first-sight registry tests (Subagent Anchor Wave 3,
 * Task 3.1-T): first sight records; freeze on settle; expire cleans; and
 * the honesty lanes — first-seen-settled has NO sample (dash), elapsed
 * derives from Date.now() deltas, and localStorage is NEVER written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubagentClock } from '$lib/services/conversation/subagent-clock.svelte';

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
	vi.spyOn(Storage.prototype, 'setItem');
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

function advance(ms: number): void {
	vi.setSystemTime(new Date(Date.now() + ms));
}

describe('SubagentClock', () => {
	it('first sight records: a running row starts its clock at the observing tick', () => {
		const clock = new SubagentClock();
		clock.observe([{ sessionId: 'a', running: true }]);
		advance(65_000);
		clock.tick();
		expect(clock.elapsedMs('a')).toBe(65_000);
	});

	it('unseen id: elapsed is null — the honest dash lane', () => {
		const clock = new SubagentClock();
		expect(clock.elapsedMs('never')).toBeNull();
		expect(clock.sighted('never')).toBe(false);
	});

	it('first seen already settled: no sample — null, never a 0s guess', () => {
		const clock = new SubagentClock();
		clock.observe([{ sessionId: 'late', running: false }]);
		advance(5_000);
		clock.tick();
		expect(clock.elapsedMs('late')).toBeNull();
	});

	it('freeze on settle: elapsed stops at the settle observation', () => {
		const clock = new SubagentClock();
		clock.observe([{ sessionId: 'a', running: true }]);
		advance(30_000);
		clock.observe([{ sessionId: 'a', running: false }]); // settle tick
		advance(120_000);
		clock.observe([{ sessionId: 'a', running: false }]);
		clock.tick();
		expect(clock.elapsedMs('a')).toBe(30_000);
	});

	it('expire cleans: ids gone from the spine lose their sample', () => {
		const clock = new SubagentClock();
		clock.observe([{ sessionId: 'a', running: true }]);
		advance(1_000);
		clock.observe([]); // feed without a
		expect(clock.elapsedMs('a')).toBeNull();
		expect(clock.sighted('a')).toBe(false);
	});

	it('a re-spawned id re-registers fresh (expire wiped the old sample)', () => {
		const clock = new SubagentClock();
		clock.observe([{ sessionId: 'a', running: true }]);
		advance(50_000);
		clock.observe([]);
		clock.observe([{ sessionId: 'a', running: true }]);
		advance(2_000);
		clock.tick();
		expect(clock.elapsedMs('a')).toBe(2_000);
	});

	it('never persists: localStorage.setItem is never called through the lifecycle', () => {
		const clock = new SubagentClock();
		clock.observe([{ sessionId: 'a', running: true }]);
		advance(10_000);
		clock.observe([{ sessionId: 'a', running: false }]);
		advance(10_000);
		clock.observe([]);
		clock.tick();
		clock.elapsedMs('a');
		expect(Storage.prototype.setItem).not.toHaveBeenCalled();
	});
});
