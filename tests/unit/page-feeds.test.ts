import { flushSync } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { pageFeeds, type ColdLoad } from '$lib/services/workspace/page-feeds.svelte';
import { effectRoot } from '../stubs/runes-helpers.svelte';

const { pruneSync, subscribeSpineFeed } = vi.hoisted(() => ({
	pruneSync: vi.fn(),
	subscribeSpineFeed: vi.fn()
}));

vi.mock('$lib/services/chat/prompt-sync.svelte', () => ({ pruneSync }));
vi.mock('$lib/services/conversation/spine-feed.svelte', () => ({
	subscribeSpineFeed,
	spineFeed: { rows: [], presets: [], workspaces: {}, a2aRows: [] }
}));

beforeEach(() => {
	vi.clearAllMocks();
	pageFeeds.coldCache = {};
	pageFeeds.coldInFlight = new SvelteSet<string>();
	pageFeeds.deadSessions = {};
	pageFeeds.edgeCache = {};
});

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

	it('primeSeed keeps sibling sessions (spread write, no clobber)', () => {
		pageFeeds.primeSeed('s1', cold({ title: 'one' }));
		pageFeeds.primeSeed('s2', cold({ title: 'two' }));
		expect(pageFeeds.coldCache['s1']?.title).toBe('one');
		expect(pageFeeds.coldCache['s2']?.title).toBe('two');
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

	it('runCold skips the fetch when the session is already cached', async () => {
		pageFeeds.primeSeed('cached', cold());
		const fetcher = vi.fn(async () => null);
		await pageFeeds.runCold('cached', fetcher);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('runCold records an honest dead-session card on null (commitment 7)', async () => {
		await pageFeeds.runCold('gone', async () => null);
		expect(pageFeeds.deadSessions['gone']).toContain('not found on the DSH host');
		expect(pageFeeds.coldInFlight.has('gone')).toBe(false);
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

	it('runCold clears the in-flight guard even when the fetch throws (finally)', async () => {
		const fetcher = vi.fn(async () => {
			throw new Error('wire down');
		});
		await expect(pageFeeds.runCold('s4', fetcher)).rejects.toThrow('wire down');
		expect(pageFeeds.coldInFlight.has('s4')).toBe(false);
	});
});

describe('page-feeds installFeeds (the floor lifecycle feeds)', () => {
	it('wires the prompt-sync prune and the spine subscription inside an effect owner; cleanup is a noop', () => {
		pruneSync.mockClear();
		subscribeSpineFeed.mockClear();
		subscribeSpineFeed.mockReturnValue(() => {});
		const ids = () => ['a', 'b'];

		const stopRoot = effectRoot(() => pageFeeds.installFeeds(ids));
		try {
			flushSync();
		} finally {
			stopRoot();
		}

		expect(pruneSync).toHaveBeenCalledExactlyOnceWith(new Set(['a', 'b']));
		expect(subscribeSpineFeed).toHaveBeenCalledExactlyOnceWith(ids);
		expect(effectRoot(() => pageFeeds.installFeeds(ids))()).toBeUndefined();
	});
});