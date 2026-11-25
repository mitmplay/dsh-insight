/**
 * TerminalDesk — THE ROSTER CLICK tests (The Job Bridge, ADR-0081 — Task
 * 4.1-T; the successor of the ADR-0035 "job follower tab" tests that lived in
 * this file).
 *
 * The Tn-J tab species is RETIRED (Wave 4.1): a roster click attaches or
 * selects a read-only job ROW on a shell tab. The command bus keeps every
 * name (`openJobTab` / `clearJobTab`, `registerJobTabOpener` / `-Clearer` /
 * `-Launcher`) — with a desk mounted, `openJobTab` now attaches the row.
 *
 * The old file pinned the job TAB: its `-J` button, the combined shell+job
 * tab index, its settle/autoClose effect, and its mirror restore. Those pins
 * are REMOVED ON PURPOSE — the subject no longer exists — and each one is
 * replaced here (or in 4.2-T's file) by the pin that protects the same
 * operator promise for the row:
 *   - a click attaches a row (was: appends a tab) + ONE follow stream
 *   - a re-click SELECTS the row's tab — never a second row, stream or tab
 *   - two jobs → two rows + two streams
 *   - clearJobTab closes the row (dismissing); destroy closes every stream
 *   - settle + linger through the CLICK path: jobs.autoClose closes a settled
 *     row after the 25 s grace, manual mode never does, only clear does
 *     (the grace itself is pinned in terminal-desk-job-rows.test.ts)
 *   - TRAP 3, the launcher path, byte-identical in BEHAVIOUR: a click with
 *     no desk mounted LAUNCHES the panel and replays into the desk that
 *     registers — as a ROW. Pinned three times: the pure bus contract, the
 *     plain replay, and a replay that lands on a desk still REBUILDING
 *     (held, never dropped — a row needs a host tab, a tab did not).
 *   - the mirror carries ROWS and the ladder restores live jobs only, without
 *     stealing the stored selection — the successor of this file's old
 *     'job tabs ride the mirror' / 'restore keeps the selection' pins lives in
 *     terminal-desk-rebuild-jobs.test.ts (Task 4.2-T).
 *   - D-k (a Wave 3 gap this wave's 4.4 e2e found): what the desk watched
 *     settle on its OWN stream outranks a lagging snapshot — a settled row's
 *     close is never undone by a stale `running` roster; the PUSH stage keeps
 *     the fresh word (a settled close still records nothing); a LIVE close
 *     still records its dismissal
 *   - NO `T*-J` tab button renders — anywhere, ever (the zero-`-J` guard).
 *
 * Harness: Wave 3's desk harness (terminal-desk-job-rows.test.ts shape):
 * happy-dom, mount + flushSync, a FakeEventSource double with URL-selected
 * instances (the desk opens its own roster-push stream on mount), a fetch
 * double, the shared TerminalPanelStub, a microtask settle.
 */
import { readFileSync } from 'node:fs';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalDesk from '../../src/lib/components/terminal/TerminalDesk.svelte';
import {
	clearJobTab,
	openJobTab,
	registerJobTabLauncher,
	registerJobTabOpener,
	__resetFollowClientForTests
} from '$lib/services/jobs/follow-client.svelte';
import { __resetRosterPushForTests } from '$lib/services/jobs/roster-push-client.svelte';
import { jobsRoster } from '$lib/services/jobs/roster-store.svelte';
import { appConfig, resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';
import type { DsiJobView } from '$lib/types';

vi.mock('$lib/components/terminal/TerminalPanel.svelte', async () =>
	await import('./TerminalPanelStub.svelte')
);

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}
	close(): void {
		this.closed = true;
	}
	/** The server writes one SSE data line. */
	emit(data: string): void {
		this.onmessage?.({ data });
	}
}

const OWNER = 'session-a';

const job = (id: string, status: DsiJobView['status'] = 'running', owner?: string): DsiJobView => ({
	id,
	kind: 'bash',
	label: 'coverage ' + id,
	...(owner === undefined ? {} : { owner }),
	status,
	startedAt: 1,
	output: { total: 0, earliest: 0 }
});

const frame = (sessionId: string, jobs: DsiJobView[]): string => JSON.stringify({ sessionId, jobs });

/** The desk's ONE roster-push stream (opened on mount). */
function pushSource(): FakeEventSource {
	const es = FakeEventSource.instances.find((i) => i.url === '/api/dsh/jobs/stream');
	if (!es) throw new Error('no roster push stream open');
	return es;
}

/** The follow streams still OPEN — a closed one stays in the registry with closed=true. */
function openFollows(): FakeEventSource[] {
	return FakeEventSource.instances.filter((i) => i.url.includes('/api/dsh/jobs/follow') && !i.closed);
}

function followFor(jobId: string): FakeEventSource {
	const es = FakeEventSource.instances.find((i) => i.url.includes('/api/dsh/jobs/follow') && i.url.includes('jobId=' + jobId));
	if (!es) throw new Error('no follow stream open for ' + jobId);
	return es;
}

/** A fetch double's Response — `ok`/`status`/`json()` only, with a
 *  microtask-bound body: everything the desk awaits settles inside settle(),
 *  under real AND fake timers (happy-dom's real Response.json() needs far
 *  more microtask turns than a microtask loop spends). */
function jsonResponse(body: unknown): Response {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** Tunable per test: what a roster SNAPSHOT answers (the default is an
 *  honest empty roster — the push is the only signal unless said otherwise). */
let snapshotJobs: DsiJobView[] | null = null;

/** While set, the fresh-T1 mint (POST /api/terminal) stays in flight — the
 *  desk's ORPHAN WINDOW, where no tab exists to host a row. */
let mintGate: Promise<void> | null = null;

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith('/api/config')) return jsonResponse({ ok: true });
			if (url.includes('sessionIds=')) {
				// the spine tick's BATCH snapshot: one roster per watched session
				const ids = (new URL(url, 'http://x').searchParams.get('sessionIds') ?? '').split(',');
				return jsonResponse({ ok: true, rosters: Object.fromEntries(ids.map((id) => [id, { jobs: snapshotJobs ?? [] }])) });
			}
			if (url.includes('/api/dsh/jobs')) {
				return jsonResponse(snapshotJobs === null ? {} : { ok: true, jobs: snapshotJobs });
			}
			if (url.includes('/reattach')) return jsonResponse({ token: 'tok' });
			if (url === '/api/terminal' && !init) {
				// the rebuild ladder's probe: one live, remembered session
				return jsonResponse({ enabled: true, sessions: [{ id: 's1', exited: false }] });
			}
			if (url === '/api/terminal' && init) {
				if (mintGate !== null) await mintGate;
				return jsonResponse({ sessionId: 'minted-1', token: 'tok', totalBytes: 0 });
			}
			return jsonResponse({});
		})
	);
}

/** Let async work land: the config load (which releases held roster frames), a
 *  rebuild ladder, a minted session, the roster's first refresh. The config
 *  chain alone costs ~8 microtask turns (promise assimilation per .then), so
 *  this spends 10 — after it, a roster frame attaches on emit + flushSync. */
async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

let mounted: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

/** Mount WITHOUT awaiting: only onMount has run (the push stream is open; a
 *  restored desk is still on its ladder). */
function mountRaw(props: Record<string, unknown> = {}): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(TerminalDesk, { target, props: props as never }) as unknown as Record<string, unknown>;
	flushSync();
	return target;
}

/** Mount and let everything settle: the desk can adopt (config landed). */
async function mountDesk(props: Record<string, unknown> = {}): Promise<HTMLElement> {
	const root = mountRaw(props);
	await settle();
	return root;
}

/** Destroy the mounted desk (the closer of last resort). */
function unmountDesk(): void {
	const handle = mounted;
	mounted = null;
	if (handle !== null) unmount(handle as unknown as ReturnType<typeof mount>);
}

/** One spine tick: the batch roster snapshot lands, the effects re-run. */
async function tick(): Promise<void> {
	jobsRoster.refreshWatched();
	await settle();
}

const rowsOf = (root: HTMLElement): HTMLElement[] =>
	Array.from(root.querySelectorAll<HTMLElement>('[data-testid="terminal-job-row"]'));

function tabContainer(root: HTMLElement, index: number): HTMLElement {
	const el = root.querySelector<HTMLElement>('[data-testid="terminal-tab-container-' + index + '"]');
	if (!el) throw new Error('no tab container ' + index);
	return el;
}

const splitRows = (root: HTMLElement, index: number): string | null =>
	tabContainer(root, index).querySelector('[data-testid="terminal-split-container"]')?.getAttribute('data-rows') ?? null;

/** THE zero-`-J` GUARD: every tab button whose label carries the retired job-tab
 *  mark. Must stay empty in every scenario of this file. */
const jobTabButtons = (root: HTMLElement): Element[] =>
	Array.from(root.querySelectorAll('[data-testid^="terminal-tab-button-"]')).filter((el) => (el.textContent ?? '').includes('-J'));

/** Every tab button — shell tabs only, since a job row is no tab. */
const tabCount = (root: HTMLElement): number => root.querySelectorAll('[data-testid^="terminal-tab-button-"]').length;

function selectedTabIndex(root: HTMLElement): number {
	return Array.from(root.querySelectorAll('[data-testid^="terminal-tab-button-"]')).findIndex((el) => el.getAttribute('data-selected') === 'true');
}

function selectTab(root: HTMLElement, index: number): void {
	(root.querySelector('[data-testid="terminal-tab-button-' + index + '"]') as HTMLElement).click();
	flushSync();
}

beforeEach(() => {
	snapshotJobs = null;
	mintGate = null;
	installFetch();
	vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	if (mounted) unmountDesk();
	// the roster store is module-level: a watch a test took itself, or a roster it
	// filled, must never leak into the next test's adoption
	jobsRoster.unwatch(OWNER);
	target?.remove();
	target = null;
	__resetFollowClientForTests();
	__resetRosterPushForTests();
	resetStreamHubForTests();
	resetAppConfigForTests();
	FakeEventSource.instances = [];
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('TerminalDesk — the roster click attaches a ROW (The Job Bridge 4.1-T)', () => {
	it('openJobTab attaches ONE row on the selected tab — under its shell — with ONE follow stream; no T*-J tab renders', async () => {
		const root = await mountDesk();
		expect(tabCount(root)).toBe(1);
		openJobTab(OWNER, 'j1', 'coverage j1');
		flushSync();
		const row = rowsOf(root);
		expect(row).toHaveLength(1); // a row, not a tab
		expect(row[0].textContent).toContain('coverage j1');
		expect(row[0].getAttribute('data-state')).toBe('live');
		expect(tabCount(root)).toBe(1); // the strip did not grow: no tab was appended
		expect(selectedTabIndex(root)).toBe(0); // the selected tab is the row's host
		expect(tabContainer(root, 0).querySelector('[data-testid="terminal-job-row"]')).not.toBeNull();
		expect(splitRows(root, 0)).toBe('2'); // the shell + the job row
		expect(jobTabButtons(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(1);
		expect(openFollows()[0].url).toContain('/api/dsh/jobs/follow?');
		expect(openFollows()[0].url).toContain('jobId=j1');
		expect(openFollows()[0].url).toContain('sessionId=' + OWNER);
	});

	it('a re-click SELECTS the row — its tab becomes selected; never a second row, stream or tab', async () => {
		const root = await mountDesk();
		(mounted as unknown as { applyAction: (a: 'new-tab') => void }).applyAction('new-tab');
		await settle(); // T2 is the selected tab
		expect(tabCount(root)).toBe(2);
		selectTab(root, 0); // the operator looks at T1 when the click lands
		openJobTab(OWNER, 'j1', 'coverage j1');
		flushSync();
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(1);
		expect(openFollows()).toHaveLength(1);
		// the operator moves to T2, then clicks the SAME job again
		selectTab(root, 1);
		expect(selectedTabIndex(root)).toBe(1);
		openJobTab(OWNER, 'j1', 'coverage j1');
		flushSync();
		expect(selectedTabIndex(root)).toBe(0); // selected — the row's host
		expect(rowsOf(root)).toHaveLength(1); // not duplicated
		expect(openFollows()).toHaveLength(1); // one stream, never two
		expect(tabCount(root)).toBe(2); // no tab appended
		expect(jobTabButtons(root)).toHaveLength(0);
	});

	it('two different jobs become two rows and two streams; an unowned job attaches too', async () => {
		const root = await mountDesk();
		openJobTab(OWNER, 'j1', 'one');
		openJobTab(OWNER, 'j2', 'two');
		openJobTab('', 'u1', 'unowned loop job');
		flushSync();
		expect(rowsOf(root)).toHaveLength(3);
		expect(openFollows()).toHaveLength(3);
		expect(followFor('u1').url).toContain('/api/dsh/jobs/follow?jobId=u1');
		expect(followFor('u1').url.includes('sessionId')).toBe(false); // no owner, no sessionId
		expect(jobTabButtons(root)).toHaveLength(0);
	});

	it('clearJobTab (the roster clear button) closes the row — its follow closes, the dismissal sticks; destroy closes every stream', async () => {
		const root = await mountDesk();
		openJobTab(OWNER, 'j1', 'one');
		openJobTab(OWNER, 'j2', 'two');
		flushSync();
		const follow = followFor('j1');
		const other = followFor('j2');
		const push = pushSource();
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(rowsOf(root)[0].textContent).toContain('two');
		expect(follow.closed).toBe(true);
		expect(splitRows(root, 0)).toBe('2');
		// closed while live: the identical live job re-arrives — no resurrection
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(jobTabButtons(root)).toHaveLength(0);
		// destroy is the closer of last resort: every stream closes
		unmountDesk();
		flushSync();
		expect(other.closed).toBe(true);
		expect(push.closed).toBe(true);
		expect(openFollows()).toHaveLength(0);
	});

	it('source-level guard: no job-tab loop, type or -J label remains in the desk', () => {
		const src = readFileSync('src/lib/components/terminal/TerminalDesk.svelte', 'utf8');
		expect(src).not.toContain('{#each jobTabs');
		expect(src).not.toContain('type JobTab');
		expect(src).not.toContain("'-J'");
		// the row loop is the one job surface, inside its tab (rows belong to tabs)
		expect(src).toContain('{#each tab.jobRows as jobRow (jobRow.key)}');
	});
});

describe('TerminalDesk — a clicked row settles and lingers (the click path)', () => {
	it('under jobs.autoClose a settled clicked row lingers 25 s, then closes — the roster shows no live jobs', async () => {
		vi.useFakeTimers();
		appConfig().jobs.autoClose = true;
		snapshotJobs = [job('j1', 'completed', OWNER)]; // the roster agrees: nothing live is left
		const root = await mountDesk();
		openJobTab(OWNER, 'j1', 'cov');
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		const follow = followFor('j1');
		follow.emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('settled');
		await vi.advanceTimersByTimeAsync(24_999); // operator grace — time to read the tail
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
		expect(jobTabButtons(root)).toHaveLength(0);
	});

	it('an UNOWNED clicked row closes at settle under jobs.autoClose (no roster to read — the settle is the end)', async () => {
		vi.useFakeTimers();
		appConfig().jobs.autoClose = true;
		const root = await mountDesk();
		openJobTab('', 'u1', 'unowned loop job');
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		const follow = followFor('u1');
		follow.emit(JSON.stringify({ type: 'status', job: job('u1', 'completed') }));
		flushSync();
		await vi.advanceTimersByTimeAsync(25_000);
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
	});

	it('manual mode (jobs.autoClose false, the default): a settled clicked row STAYS through ANY roster churn — only clear closes it', async () => {
		vi.useFakeTimers();
		appConfig().jobs.autoClose = false;
		// the churn roster carries SETTLED jobs only: a live sibling in a watched
		// roster would be ADOPTED as its own row (The Job Bridge D1 — pinned in
		// terminal-desk-job-adopt.test.ts), which is not what this test measures
		snapshotJobs = [job('j1', 'completed', OWNER), job('other', 'completed', OWNER)];
		const root = await mountDesk();
		openJobTab(OWNER, 'j1', 'cov');
		flushSync();
		const follow = followFor('j1');
		follow.emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('settled');
		// the roster churns: j1 dropped, then EVERYTHING gone — the row survives it all
		snapshotJobs = [job('other', 'completed', OWNER)];
		await vi.advanceTimersByTimeAsync(60_000);
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		snapshotJobs = [];
		await vi.advanceTimersByTimeAsync(60_000);
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		// the follow ended at its own status frame (the stream's rule, never a desk
		// action — live gate 2026-11-25); the ROW survived every churn above.
		expect(follow.closed).toBe(true);
		// the roster's clear button (the bus command) is the only remover
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
	});
});

describe('TerminalDesk — D-k: what the desk watched settle outranks a lagging snapshot (found by the 4.4 e2e)', () => {
	it('a row the FOLLOW settled stays closed while a STALE snapshot still shows it running — no new follow stream opens', async () => {
		// ANOTHER watcher holds the owner's roster after the row's own watch is
		// released (the e2e had the sidebar badge) — so the snapshot stays alive
		jobsRoster.watch(OWNER);
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		const follow = followFor('j1');
		// the spine tick lands its snapshot: running — true at that moment
		snapshotJobs = [job('j1', 'running', OWNER)];
		await tick();
		// the FOLLOW reports the settle FIRST; the next snapshot is a tick away
		follow.emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('settled');
		const streams = FakeEventSource.instances.length;
		(rowsOf(root)[0].querySelector('[data-testid="terminal-job-row-close"]') as HTMLElement).click(); // the x
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
		// the snapshot re-runs and STILL says running (it lags the follow by up to one refreshMs)
		await tick();
		flushSync();
		expect(rowsOf(root)).toHaveLength(0); // never resurrected
		expect(FakeEventSource.instances.length).toBe(streams); // and no follow stream opened for it
		jobsRoster.unwatch(OWNER); // the watch this test took itself (the store is module-level)
	});

	it('closing a SETTLED row records nothing — a PUSH frame showing it running attaches it again (3.1-T, unchanged by D-k)', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		const first = followFor('j1');
		first.emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		// the relay's frame is the fresh word: the same id running again still attaches
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('live');
		expect(openFollows()).toHaveLength(1);
		expect(openFollows()[0]).not.toBe(first); // a FRESH follow for the re-attached row
	});

	it('a LIVE row closed with its x still records a dismissal — an identical frame and a live snapshot never bring it back', async () => {
		const root = await mountDesk();
		snapshotJobs = [job('j1', 'running', OWNER)];
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		const follow = followFor('j1');
		(rowsOf(root)[0].querySelector('[data-testid="terminal-job-row-close"]') as HTMLElement).click();
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
		await tick(); // the snapshot says running — the dismissal sticks (trap 1)
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(0);
	});
});

describe('follow-client bus contract', () => {
	it('openJobTab is a no-op with no desk registered', () => {
		expect(() => openJobTab('s', 'j', 'l')).not.toThrow();
	});

	it('unregister stops delivery', () => {
		const seen: string[] = [];
		const unregister = registerJobTabOpener((owner, jobId) => seen.push(owner + '|' + jobId));
		unregister();
		openJobTab('s', 'j', 'l');
		expect(seen).toEqual([]);
	});
});

describe('the follow stream ends at the job\'s status — no reconnect loop per settled row (live gate 2026-11-25)', () => {
	it('the follow EventSource CLOSES ITSELF once the status frame arrives; a live row\'s follow stays open', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j-live', 'running', OWNER), job('j-done', 'running', OWNER)]));
		flushSync();
		const live = followFor('j-live');
		const done = followFor('j-done');
		expect(live.closed).toBe(false); // a running job keeps streaming
		expect(done.closed).toBe(false);
		done.emit(JSON.stringify({ type: 'status', job: job('j-done', 'completed', OWNER) }));
		expect(done.closed).toBe(true); // the stream ended at status: closed, never re-opened
		flushSync(); // the status settles the row
		expect(root.querySelectorAll('[data-testid="terminal-job-row"][data-state="settled"]')).toHaveLength(1); // the row stays, settled
		expect(live.closed).toBe(false); // the sibling's stream is untouched
	});
});

describe('follow-client — no-desk launch fallback, the pure bus (RCA 2026-10-21)', () => {
	it('launches the terminal panel and replays the click when the desk registers', () => {
		const launched = vi.fn();
		const unregisterLauncher = registerJobTabLauncher(launched);
		const seen: string[] = [];
		// click BEFORE any desk exists: launcher fires, request parks
		openJobTab('session-a', 'j9', 'coverage run');
		expect(launched).toHaveBeenCalledTimes(1);
		expect(seen).toEqual([]);
		// the fresh desk registers: the parked click replays into it
		const unregisterOpener = registerJobTabOpener((owner, jobId, label) => seen.push(owner + '|' + jobId + '|' + label));
		expect(seen).toEqual(['session-a|j9|coverage run']);
		// subsequent clicks deliver directly, launcher is not re-fired
		openJobTab('session-a', 'j8', 'other');
		expect(launched).toHaveBeenCalledTimes(1);
		expect(seen).toEqual(['session-a|j9|coverage run', 'session-a|j8|other']);
		unregisterOpener();
		unregisterLauncher();
	});
});

describe('TerminalDesk — TRAP 3: a click with NO desk mounted launches the panel and replays as a ROW', () => {
	it('(i) the plain case: the click launches once; the desk that registers replays it as a row on its selected tab', async () => {
		const launched = vi.fn();
		const unregisterLauncher = registerJobTabLauncher(launched);
		// no desk is mounted: the launcher fires and the click parks — no stream opens
		openJobTab(OWNER, 'j9', 'coverage run');
		expect(launched).toHaveBeenCalledTimes(1);
		expect(FakeEventSource.instances).toHaveLength(0);
		// the launcher's doAdd mounts the terminal panel: its desk registers, and
		// the registration DRAINS the parked click — a row, never a silent no-op
		const root = await mountDesk();
		expect(rowsOf(root)).toHaveLength(1);
		expect(rowsOf(root)[0].textContent).toContain('coverage run');
		expect(selectedTabIndex(root)).toBe(0);
		expect(tabCount(root)).toBe(1); // the default shell tab — nothing appended
		expect(jobTabButtons(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(1);
		expect(followFor('j9').url).toContain('jobId=j9');
		// the next click delivers directly: the launcher is never re-fired
		openJobTab(OWNER, 'j8', 'other');
		flushSync();
		expect(launched).toHaveBeenCalledTimes(1);
		expect(rowsOf(root)).toHaveLength(2);
		unregisterLauncher();
	});

	it('(ii) the replay lands on a desk that is still REBUILDING — held, never dropped: the row attaches once the ladder settles', async () => {
		const launched = vi.fn();
		const unregisterLauncher = registerJobTabLauncher(launched);
		openJobTab(OWNER, 'j9', 'coverage run'); // parked: no desk mounted
		expect(launched).toHaveBeenCalledTimes(1);
		// the launcher's doAdd mounts a desk that has a REMEMBERED structure: it
		// registers (draining the parked click) at component init, BEFORE its
		// rebuild ladder runs — a row has no host tab yet
		const root = mountRaw({ restored: { tabs: [{ sessionIds: ['s1'] }], selectedTab: 0 } });
		expect(root.querySelector('[data-testid="terminal-desk-restoring"]')).not.toBeNull();
		expect(rowsOf(root)).toHaveLength(0); // held — nothing can host it yet
		expect(openFollows()).toHaveLength(0);
		await settle(); // the ladder settles
		expect(root.querySelector('[data-testid="terminal-desk-restoring"]')).toBeNull();
		// the replayed click lands: ONE row on the restored tab — never dropped
		expect(rowsOf(root)).toHaveLength(1);
		expect(rowsOf(root)[0].textContent).toContain('coverage run');
		expect(tabContainer(root, 0).querySelector('[data-testid="terminal-job-row"]')).not.toBeNull();
		expect(tabContainer(root, 0).querySelector('[data-testid="terminal-panel"]')?.getAttribute('data-assigned')).toBe('s1'); // the remembered shell re-attached
		expect(selectedTabIndex(root)).toBe(0);
		expect(tabCount(root)).toBe(1);
		expect(jobTabButtons(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(1);
		expect(followFor('j9').url).toContain('jobId=j9');
		expect(launched).toHaveBeenCalledTimes(1);
		unregisterLauncher();
	});

	it("(iii) a click that lands in clearScope('terminals')'s orphan window is replayed on the fresh T1", async () => {
		const root = await mountDesk();
		openJobTab(OWNER, 'j1', 'first');
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		// the fresh-T1 mint is held open: after the verb fires, NO tab exists
		let openMint!: () => void;
		mintGate = new Promise<void>((resolve) => {
			openMint = resolve;
		});
		(root.querySelector('[data-testid="terminal-tabstrip-clear"]') as HTMLElement).click();
		flushSync();
		(root.querySelector('[data-testid="terminal-tabstrip-clear-terminals"]') as HTMLElement).click();
		flushSync();
		expect(tabCount(root)).toBe(0); // the orphan window
		openJobTab(OWNER, 'j2', 'second'); // nothing to host on — held
		flushSync();
		expect(openFollows()).toHaveLength(1); // only the first row's stream
		openMint();
		await settle(); // the fresh T1 lands
		expect(tabCount(root)).toBe(1);
		expect(selectedTabIndex(root)).toBe(0);
		// the moved row AND the held click's row, both on the fresh T1
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(2);
		expect(rowsOf(root).map((r) => r.textContent)).toEqual([expect.stringContaining('first'), expect.stringContaining('second')]);
		expect(openFollows()).toHaveLength(2);
		expect(followFor('j2').url).toContain('jobId=j2');
		expect(jobTabButtons(root)).toHaveLength(0);
	});
});
