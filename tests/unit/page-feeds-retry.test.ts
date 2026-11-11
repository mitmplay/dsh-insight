/**
 * page-feeds retry store (Born-Late Panel T2-T, ADR-0059 D1/D2) — the five
 * pins: (1) dead + ledger birth -> entry cleared, cold re-run once;
 * (2) dead + no birth -> entry stays; (3) manual retryDead on a still-dead
 * id -> one wire call, card honestly re-recorded; (4) ledger fetch
 * failure -> nothing heals, nothing clears (fail-open); (5) the re-entry
 * guard holds when a delivery lands while a cold fetch is mid-flight.
 */
import { flushSync } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';
import { pageFeeds, type ColdLoad } from '$lib/services/workspace/page-feeds.svelte';
import { refreshScheduleLedger } from '$lib/services/schedule-ledger.svelte';
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

/** Mutable ledger wire the schedule-ledger single-flight fetch reads. */
let ledgerItems: unknown[] = [];
const wireColdCalls = vi.fn();

function stubLedgerWire(): void {
	vi.stubGlobal('fetch', vi.fn(async () => ({
		ok: true,
		json: async () => ({ items: ledgerItems })
	})));
}

function cold(overrides: Partial<ColdLoad> = {}): ColdLoad {
	return {
		title: 't', workspace: 'w', agentPreset: null, entries: [], lastSeq: 0,
		running: false, hasMore: false, pendingAnswers: [], settledAnswers: [],
		permission: null, imageLimits: null, knobEvents: [], deliverables: [], ...overrides
	};
}

/** Install the retry store watcher under an effect root (route parity). */
function installWatcher(fetchCold: (id: string) => Promise<ColdLoad | null>) {
	return effectRoot(() => pageFeeds.installFeeds(() => [] as string[], fetchCold));
}

beforeEach(() => {
	vi.clearAllMocks();
	stubLedgerWire();
	wireColdCalls.mockReset();
	pageFeeds.coldCache = {};
	pageFeeds.coldInFlight = new SvelteSet<string>();
	pageFeeds.deadSessions = {};
	pageFeeds.edgeCache = {};
	ledgerItems = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('page-feeds retry store (ADR-0059 T2-T)', () => {
	it('pin 1: dead + ledger birth appears -> entry cleared, cold re-invoked once', async () => {
		// Dead card recorded pre-birth (the born-late panel trap).
		await pageFeeds.runCold('born-late', async () => null);
		expect(pageFeeds.deadSessions['born-late']).toContain('not found');

		// Cold fetcher the heal path re-runs — succeeds post-birth.
		const healFetcher = vi.fn(async () => cold({ title: 'healed' }));
		const stop = installWatcher(healFetcher);

		// The ledger tick lands: the schedule HAS delivered (birth fact).
		ledgerItems = [{ targetSessionId: 'born-late', status: 'active', lastDelivery: { deliveredAt: '2026-11-11T01:03:30Z', targetSessionId: 'born-late' } }];
		await refreshScheduleLedger();
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		expect(pageFeeds.deadSessions['born-late']).toBeUndefined();
		expect(pageFeeds.coldCache['born-late']?.title).toBe('healed');
		expect(healFetcher).toHaveBeenCalledTimes(1); // once per birth, no loop
		stop();
	});

	it('pin 2: dead + no ledger birth -> entry stays (no false healing)', async () => {
		await pageFeeds.runCold('not-born', async () => null);
		const healFetcher = vi.fn(async () => cold());
		const stop = installWatcher(healFetcher);

		ledgerItems = [{ targetSessionId: 'not-born', status: 'active' }]; // reserved, never delivered
		await refreshScheduleLedger();
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		expect(pageFeeds.deadSessions['not-born']).toContain('not found');
		expect(healFetcher).not.toHaveBeenCalled();
		stop();
	});

	it('pin 3: manual retryDead on a still-dead id -> one wire call, card re-recorded', async () => {
		await pageFeeds.runCold('gone', async () => null);
		const stillDead = vi.fn(async () => null);

		await pageFeeds.retryDead('gone', stillDead);

		expect(stillDead).toHaveBeenCalledTimes(1); // exactly one cheap wire call
		expect(pageFeeds.deadSessions['gone']).toContain('not found'); // honest re-record
	});

	it('pin 4: ledger fetch failure -> fail-open, nothing heals or clears', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
		await pageFeeds.runCold('keep-dead', async () => null);
		const healFetcher = vi.fn(async () => cold());
		const stop = installWatcher(healFetcher);

		await refreshScheduleLedger(); // the failed read
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		expect(pageFeeds.deadSessions['keep-dead']).toContain('not found');
		expect(healFetcher).not.toHaveBeenCalled();
		stop();
	});

	it('pin 5: birth landing mid-flight -> re-entry guard holds, no second cold call', async () => {
		await pageFeeds.runCold('mid-flight', async () => null);

		// A cold fetch is already in flight when the ledger tick lands.
		let releaseGate!: (v: ColdLoad | null) => void;
		const gate = new Promise<ColdLoad | null>((r) => (releaseGate = r));
		const inFlightFetcher = vi.fn(() => gate);
		const running = pageFeeds.runCold('mid-flight', inFlightFetcher);
		expect(pageFeeds.coldInFlight.has('mid-flight')).toBe(true);

		const healFetcher = vi.fn(async () => cold());
		const stop = installWatcher(healFetcher);
		ledgerItems = [{ targetSessionId: 'mid-flight', lastDelivery: { deliveredAt: '2026-11-11T02:00:00Z' } }];
		await refreshScheduleLedger();
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();

		// The heal retry respected the in-flight guard: no extra wire call.
		expect(healFetcher).not.toHaveBeenCalled();

		// The original flight settles dead — the card honestly re-records.
		releaseGate(null);
		await running;
		expect(pageFeeds.deadSessions['mid-flight']).toContain('not found');
		expect(inFlightFetcher).toHaveBeenCalledTimes(1);
		stop();
	});
});


	describe('ledger pulse (only while a dead entry exists)', () => {
		it('pin 6: healthy floor -> no schedule wire reads on the pulse cadence', async () => {
			vi.useFakeTimers();
			try {
				const healFetcher = vi.fn(async () => cold());
				const stop = installWatcher(healFetcher);
				flushSync();
				const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }));
				vi.stubGlobal('fetch', fetchMock);
				await vi.advanceTimersByTimeAsync(65_000);
				expect(fetchMock).not.toHaveBeenCalled(); // no dead entry, no pulse
				stop();
			} finally {
				vi.useRealTimers();
			}
		});

		it('pin 7: a dead entry arms the pulse -> the shared read heals on the tick', async () => {
			await pageFeeds.runCold('pulse-dead', async () => null);
			vi.useFakeTimers();
			try {
				const healFetcher = vi.fn(async () => cold({ title: 'pulsed' }));
				const stop = installWatcher(healFetcher);
				const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ targetSessionId: 'pulse-dead', lastDelivery: { deliveredAt: '2026-11-11T03:00:00Z' } }] }) }));
				vi.stubGlobal('fetch', fetchMock);
				await vi.advanceTimersByTimeAsync(35_000);
				expect(fetchMock.mock.calls.length).toBeGreaterThan(0); // the pulse read
				await vi.advanceTimersByTimeAsync(0); // flush microtasks (still fake clock)
				expect(pageFeeds.deadSessions['pulse-dead']).toBeUndefined(); // healed on the tick
				expect(pageFeeds.coldCache['pulse-dead']?.title).toBe('pulsed');
				stop();
			} finally {
				vi.useRealTimers();
			}
		});
	});
