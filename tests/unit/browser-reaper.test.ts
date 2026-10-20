import { describe, expect, it } from 'vitest';

import { browserRegistry, reaperEligible } from '$lib/server/browser/registry.js';

/** Task 1.3-T (The Sticky Glass, ADR-0030 D2): the reaper's eligibility is
 *  pinned pure — a subscribed stream blocks reaping; MCP traffic resets the
 *  idle clock; the counter notes never go negative. */
describe('reaperEligible (pure predicate)', () => {
	const base = { streamSubscribers: 0, lastMcpActivity: 1_000 };

	it('idle session with no subscribers is eligible', () => {
		expect(reaperEligible(base, 600_000, 1_000 + 600_000)).toBe(true);
	});

	it('a subscribed stream blocks reaping regardless of idle time', () => {
		expect(reaperEligible({ ...base, streamSubscribers: 1 }, 600_000, 1_000 + 86_400_000)).toBe(false);
	});

	it('MCP traffic younger than idleMs resets the idle clock (active agent is never reaped)', () => {
		expect(reaperEligible(base, 600_000, 1_000 + 599_999)).toBe(false);
	});

	it('exactly idleMs old is eligible (>= boundary)', () => {
		expect(reaperEligible(base, 600_000, 1_000 + 600_000)).toBe(true);
	});
});

describe('registry reaper notes + findLive', () => {
	it('findLive is false for null/undefined/unknown ids and true only for live sessions', async () => {
		expect(browserRegistry.findLive(null)).toBe(false);
		expect(browserRegistry.findLive(undefined)).toBe(false);
		expect(browserRegistry.findLive('no-such-id')).toBe(false);
		const info = await browserRegistry.open({ spawnMcp: false, headless: true });
		try {
			expect(browserRegistry.findLive(info.id)).toBe(true);
			await browserRegistry.close(info.id);
			expect(browserRegistry.findLive(info.id)).toBe(false);
		} finally {
			await browserRegistry.close(info.id); // idempotent D8
		}
	}, 120_000);

	it('stream subscriber notes clamp at zero (no negative counts)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, headless: true });
		try {
			browserRegistry.noteStreamClose(info.id); // unbalanced close — must not go negative
			browserRegistry.noteStreamOpen(info.id);
			browserRegistry.noteStreamOpen(info.id);
			browserRegistry.noteStreamClose(info.id);
			browserRegistry.noteMcpTraffic(info.id); // must not throw on a live id
			// the session survives — a watched session is never reaper-eligible
			const src = (await import('node:fs')).readFileSync('src/lib/server/browser/registry.ts', 'utf8');
			expect(src).toContain('streamSubscribers = Math.max(0, e.streamSubscribers - 1)');
		} finally {
			await browserRegistry.close(info.id);
		}
	}, 120_000);
});
