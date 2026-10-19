import { describe, it, expect, vi } from 'vitest';
import { pageFeeds, type ColdLoad } from '$lib/services/workspace/page-feeds.svelte';

function cold(overrides: Partial<ColdLoad> = {}): ColdLoad {
	return {
		title: 't', workspace: 'w', agentPreset: null, entries: [], lastSeq: 0,
		running: false, hasMore: false, pendingAnswers: [], settledAnswers: [],
		permission: null, imageLimits: null, knobEvents: [], deliverables: [], ...overrides
	};
}

describe('page-feeds registries (ADR-0018 W2 task 2.2)', () => {
	it('primeSeed lands the payload before first render', () => {
		pageFeeds.primeSeed('s1', cold({ title: 'seed' }));
		expect(pageFeeds.coldCache['s1']?.title).toBe('seed');
	});

	it('rememberEdge records the ADD-time parent edge', () => {
		pageFeeds.rememberEdge('child', 'parent');
		expect(pageFeeds.edgeCache['child']).toBe('parent');
	});

	it('runCold caches the fetch result and clears the in-flight guard', async () => {
		const fetcher = vi.fn(async () => cold({ title: 'x' }));
		await pageFeeds.runCold('s2', fetcher);
		expect(pageFeeds.coldCache['s2']?.title).toBe('x');
		expect(pageFeeds.coldInFlight.has('s2')).toBe(false);
	});

	it('runCold records an honest dead-session card on null (commitment 7)', async () => {
		await pageFeeds.runCold('gone', async () => null);
		expect(pageFeeds.deadSessions['gone']).toContain('not found on the DSH host');
	});

	it('runCold de-duplicates a session already in flight (singleton trap guard)', async () => {
		let release!: (v: ColdLoad) => void;
		const gate = new Promise<ColdLoad>((r) => (release = r));
		const fetcher = vi.fn(() => gate);
		const a = pageFeeds.runCold('s3', fetcher);
		const b = pageFeeds.runCold('s3', fetcher);
		release(cold({ title: 'once' }));
		await Promise.all([a, b]);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(pageFeeds.coldCache['s3']?.title).toBe('once');
	});
});
