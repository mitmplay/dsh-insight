/**
 * TerminalDesk — THE MIRROR + REBUILD LADDER carry job rows (The Job Bridge,
 * ADR-0081 D5 — Task 4.2-T).
 *
 * The mirror (D5, first half): every attached job ROW publishes as
 * jobs: [{ owner, jobId }] — the shape clampDeskMirror keeps (its clamp tests:
 * desk-mirror-jobs.test.ts) and the rebuild ladder consumes.
 *   - an owned row, an unowned row (owner '') and a row BETWEEN HOSTS (D-g prime:
 *     closing its host tab, or the orphan window of clearScope('terminals')) all
 *     publish; a closed row drops out
 *   - published on CONTENT change only (an identical roster publishes nothing)
 *
 * The ladder (D-j, second half): after the shell ladder settles, a remembered
 * job re-attaches as a ROW only while the roster shows it live.
 *   - live (running | stopping) -> ONE row + ONE follow, on the restored
 *     selection, which it never steals; the label comes from the roster
 *   - finished / unknown / a DARK roster -> restores CLOSED, no watch left
 *   - jobs.autoAttach:false -> nothing is probed, nothing attaches (karpathy
 *     2.4); the config is AWAITED so the real setting decides, never the default
 *   - the probe never leaks a watch (one per attached row, net 0 when closed)
 *   - an UNOWNED remembered job is not probed; a roster frame re-attaches it
 *     if it is still live
 *   - the mirror round-trips: onMirror -> clampDeskMirror -> a fresh desk
 *
 * Harness: terminal-desk-job-adopt.test.ts shape (happy-dom, mount + flushSync, a
 * FakeEventSource double, a fetch double, the shared TerminalPanelStub). The
 * roster SNAPSHOT is driven through the real store fetches; the store WATCH SET
 * is observed black-box: refreshWatched() fetches ONLY watched sessions, in one
 * batch URL.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalDesk from '../../src/lib/components/terminal/TerminalDesk.svelte';
import { clearJobTab, __resetFollowClientForTests } from '$lib/services/jobs/follow-client.svelte';
import { __resetRosterPushForTests } from '$lib/services/jobs/roster-push-client.svelte';
import { jobsRoster } from '$lib/services/jobs/roster-store.svelte';
import { appConfig, resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';
import { clampDeskMirror } from '../../src/lib/utils/panel-prefs';
import type { DsiJobView } from '$lib/types';

vi.mock('$lib/components/terminal/TerminalPanel.svelte', async () =>
	await import('./TerminalPanelStub.svelte')
);

let failFollows = false;

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	constructor(public url: string) {
		// a follow stream that REFUSES TO OPEN (the ladder must never wedge on it)
		if (failFollows && url.includes('/api/dsh/jobs/follow')) throw new Error('stream refused');
		FakeEventSource.instances.push(this);
	}
	close(): void {
		this.closed = true;
	}
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

interface Mirror {
	tabs: Array<{ sessionIds: string[] }>;
	selectedTab: number;
	jobs?: Array<{ owner: string; jobId: string }>;
}

function pushSource(): FakeEventSource {
	const es = FakeEventSource.instances.find((i) => i.url === '/api/dsh/jobs/stream');
	if (!es) throw new Error('no roster push stream open');
	return es;
}

const openFollows = (): FakeEventSource[] =>
	FakeEventSource.instances.filter((i) => i.url.includes('/api/dsh/jobs/follow') && !i.closed);

/** A fetch double Response — ok/status/json() only, microtask-bound: everything the
 *  desk awaits settles inside settle(), under real AND fake timers. */
function jsonResponse(body: unknown): Response {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const fetchCalls: string[] = [];

/** Tunable per test. */
let snapshotJobs: DsiJobView[] | null = null;
/** The snapshot answers pending: true — honest DARKNESS (the mirror has no frame yet). */
let snapshotDark = false;
let configBody: Record<string, unknown> = {};
/** While set, /api/config stays in flight — the ladder runs BEFORE the config lands. */
let configGate: Promise<void> | null = null;
/** What the shell ladder probe lists as live. */
let probeSessions: Array<{ id: string; exited: boolean }> = [
	{ id: 's1', exited: false },
	{ id: 's2', exited: false }
];

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			fetchCalls.push(url);
			if (url.startsWith('/api/config')) {
				if (configGate !== null) await configGate;
				return jsonResponse({ ok: true, ...configBody });
			}
			if (url.includes('/api/dsh/jobs')) {
				if (url.includes('sessionIds=')) {
					// the spine tick BATCH snapshot: one roster per watched session
					const ids = (new URL(url, 'http://x').searchParams.get('sessionIds') ?? '').split(',');
					const rosters = Object.fromEntries(ids.map((id) => [id, rosterFor(id)]));
					return jsonResponse({ ok: true, rosters });
				}
				return jsonResponse(snapshotDark ? { ok: true, sessionId: OWNER, jobs: [], pending: true } : snapshotJobs === null ? {} : { ok: true, jobs: snapshotJobs });
			}
			if (url.includes('/reattach')) return jsonResponse({ token: 'tok' });
			if (url === '/api/terminal' && !init) return jsonResponse({ enabled: true, sessions: probeSessions });
			if (url === '/api/terminal' && init) return jsonResponse({ sessionId: 'minted-1', token: 'tok', totalBytes: 0 });
			return jsonResponse({});
		})
	);
}

/** What the batch snapshot answers for one session: the owner carries the roster
 *  under test (or darkness); any other watched session is honestly empty. */
function rosterFor(id: string): { jobs: DsiJobView[]; pending?: boolean } {
	if (id !== OWNER) return { jobs: [] };
	return snapshotDark ? { jobs: [], pending: true } : { jobs: snapshotJobs ?? [] };
}

/** Let async work land (flush + one microtask, turns times). The config chain
 *  alone costs ~8 microtask turns; the shell ladder ~10; each remembered job
 *  probes its owner (a few more) — the default spends 80, enough for several. */
async function settle(turns = 80): Promise<void> {
	for (let i = 0; i < turns; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** The store WATCH SET, observed black-box: refreshWatched fetches ONLY watched
 *  sessions, as ONE batch URL — the ids in that URL are the watches. */
function watchedIds(): string[] {
	const before = fetchCalls.length;
	jobsRoster.refreshWatched();
	return fetchCalls
		.slice(before)
		.filter((u) => u.includes('sessionIds='))
		.flatMap((u) => (new URL(u, 'http://x').searchParams.get('sessionIds') ?? '').split(','))
		.filter((id) => id !== '');
}

/** Every singular roster probe (a first watch load or an explicit refresh). */
const rosterProbes = (): string[] => fetchCalls.filter((u) => u.includes('/api/dsh/jobs?sessionId='));

let mounted: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

/** Mount WITHOUT awaiting: only onMount has run (the push stream is open; a
 *  restored desk is on its ladder). */
function mountRaw(props: Record<string, unknown> = {}): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(TerminalDesk, { target, props: props as never }) as unknown as Record<string, unknown>;
	flushSync();
	return target;
}

/** Destroy the mounted desk. */
function unmountDesk(): void {
	const handle = mounted;
	mounted = null;
	if (handle !== null) unmount(handle as unknown as ReturnType<typeof mount>);
}

/** Mount with an onMirror sink — the caller settles. */
function mountWithMirror(mirrors: Mirror[], props: Record<string, unknown> = {}): HTMLElement {
	return mountRaw({ onMirror: (m: Mirror) => mirrors.push(structuredClone(m) as Mirror), ...props });
}

const rowsOf = (root: HTMLElement): HTMLElement[] =>
	Array.from(root.querySelectorAll('[data-testid="terminal-job-row"]'));

function tabContainer(root: HTMLElement, index: number): HTMLElement {
	const el = root.querySelector('[data-testid="terminal-tab-container-' + index + '"]');
	if (!el) throw new Error('no tab container ' + index);
	return el as HTMLElement;
}

const tabCount = (root: HTMLElement): number => root.querySelectorAll('[data-testid^="terminal-tab-button-"]').length;

/** The retired species mark — must never render. */
const jobTabButtons = (root: HTMLElement): Element[] =>
	Array.from(root.querySelectorAll('[data-testid^="terminal-tab-button-"]')).filter((el) => (el.textContent ?? '').includes('-J'));

function selectedTabIndex(root: HTMLElement): number {
	return Array.from(root.querySelectorAll('[data-testid^="terminal-tab-button-"]')).findIndex((el) => el.getAttribute('data-selected') === 'true');
}

const isRestoring = (root: HTMLElement): boolean => root.querySelector('[data-testid="terminal-desk-restoring"]') !== null;

/** The last mirror the desk published. */
function lastMirror(mirrors: Mirror[]): Mirror {
	if (mirrors.length === 0) throw new Error('the desk published no mirror');
	return mirrors[mirrors.length - 1];
}

beforeEach(() => {
	snapshotJobs = null;
	snapshotDark = false;
	configBody = {};
	configGate = null;
	probeSessions = [
		{ id: 's1', exited: false },
		{ id: 's2', exited: false }
	];
	fetchCalls.length = 0;
	failFollows = false;
	installFetch();
	vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	if (mounted) unmountDesk();
	target?.remove();
	target = null;
	__resetFollowClientForTests();
	__resetRosterPushForTests();
	resetStreamHubForTests();
	resetAppConfigForTests();
	FakeEventSource.instances = [];
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('TerminalDesk — the mirror carries job rows (The Job Bridge 4.2-T, D5)', () => {
	it('every job row publishes as { owner, jobId } — owned, unowned, and a row between hosts; a closed row drops out', async () => {
		const mirrors: Mirror[] = [];
		const root = mountWithMirror(mirrors);
		await settle();
		const both = [{ owner: OWNER, jobId: 'j1' }, { owner: '', jobId: 'u1' }];
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('u1')]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(2);
		const m = lastMirror(mirrors);
		expect(m.jobs).toEqual(both);
		expect(m.tabs).toHaveLength(1); // the shell half is still published beside them
		expect(m.selectedTab).toBe(0);
		// content change ONLY: the identical roster re-arrives (every spine tick) — nothing republishes
		const published = mirrors.length;
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('u1')]));
		flushSync();
		flushSync();
		expect(mirrors).toHaveLength(published);
		// D-g prime: clearScope('terminals') — the rows are ORPHANS for a moment, then
		// re-home on the fresh T1: every mirror of that journey keeps both jobs
		(root.querySelector('[data-testid="terminal-tabstrip-clear"]') as HTMLElement).click();
		flushSync();
		(root.querySelector('[data-testid="terminal-tabstrip-clear-terminals"]') as HTMLElement).click();
		flushSync();
		await settle();
		expect(mirrors.length).toBeGreaterThan(published); // the tab half changed under the rows
		for (const publishedMirror of mirrors.slice(published)) expect(publishedMirror.jobs).toEqual(both);
		// closing a row drops its entry — and only its own
		clearJobTab('', 'u1');
		flushSync();
		expect(lastMirror(mirrors).jobs).toEqual([{ owner: OWNER, jobId: 'j1' }]);
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(lastMirror(mirrors).jobs).toBeUndefined(); // no jobs key once none is shown
	});

	it('D-g prime — closing the host tab RELOCATES its row: the mirror keeps the job entry', async () => {
		const mirrors: Mirror[] = [];
		const root = mountWithMirror(mirrors);
		await settle();
		const desk = mounted as unknown as { applyAction: (a: 'new-tab' | 'split-down') => void };
		desk.applyAction('new-tab');
		await settle(); // T2, selected
		desk.applyAction('split-down');
		await settle(); // a second shell on T2, so closing T1 leaves this neighbour
		(root.querySelector('[data-testid="terminal-tab-button-1"]') as HTMLElement).click(); // T2 stays selected
		flushSync();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(tabContainer(root, 1).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(1);
		const published = mirrors.length;
		expect(lastMirror(mirrors).jobs).toEqual([{ owner: OWNER, jobId: 'j1' }]);
		// the x on T1: T2 takes the row — the job entry never leaves the mirror
		(root.querySelector('[data-testid="terminal-tab-close-0"]') as HTMLElement).click();
		flushSync();
		await settle();
		expect(tabCount(root)).toBe(1);
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(1);
		expect(mirrors.length).toBeGreaterThan(published); // the tab half changed
		expect(lastMirror(mirrors).jobs).toEqual([{ owner: OWNER, jobId: 'j1' }]);
	});
});

describe('TerminalDesk — the rebuild ladder restores job rows (The Job Bridge 4.2-T, D-j)', () => {
	const remembered = {
		tabs: [{ sessionIds: ['s1'] }, { sessionIds: ['s2'] }],
		selectedTab: 1,
		jobs: [{ owner: OWNER, jobId: 'j1' }]
	};

	it('a remembered LIVE job re-attaches as a row after the shell ladder — ONE follow, the roster label, on the restored selection (never stealing it)', async () => {
		snapshotJobs = [job('j1', 'running', OWNER)];
		const root = mountRaw({ restored: remembered });
		expect(isRestoring(root)).toBe(true); // the ladder is running — nothing shows yet
		expect(rowsOf(root)).toHaveLength(0);
		await settle();
		expect(isRestoring(root)).toBe(false); // the ladder always settles
		expect(tabCount(root)).toBe(2); // the shell half restored first
		expect(selectedTabIndex(root)).toBe(1); // the stored selection is untouched
		expect(rowsOf(root)).toHaveLength(1);
		const row = rowsOf(root)[0];
		expect(tabContainer(root, 1).contains(row)).toBe(true); // hosted on the restored selection
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(0);
		expect(row.textContent).toContain('coverage j1'); // the ROSTER label, never the bare id
		expect(row.getAttribute('data-state')).toBe('live');
		expect(openFollows()).toHaveLength(1);
		expect(openFollows()[0].url).toContain('jobId=j1');
		expect(openFollows()[0].url).toContain('sessionId=' + OWNER);
		expect(jobTabButtons(root)).toHaveLength(0);
	});

	it('stopping counts as live; a settled remembered job restores closed — two rows for three remembered', async () => {
		snapshotJobs = [job('j1', 'running', OWNER), job('j2', 'stopping', OWNER), job('j3', 'completed', OWNER)];
		const root = mountRaw({
			restored: { ...remembered, jobs: [{ owner: OWNER, jobId: 'j1' }, { owner: OWNER, jobId: 'j2' }, { owner: OWNER, jobId: 'j3' }] }
		});
		await settle();
		expect(isRestoring(root)).toBe(false);
		expect(rowsOf(root)).toHaveLength(2);
		expect(rowsOf(root).map((r) => r.textContent)).toEqual([expect.stringContaining('coverage j1'), expect.stringContaining('coverage j2')]);
		expect(openFollows()).toHaveLength(2);
	});

	it('a remembered FINISHED job restores CLOSED — no row, no stream, no watch', async () => {
		snapshotJobs = [job('j1', 'completed', OWNER)];
		const root = mountRaw({ restored: remembered });
		await settle();
		expect(isRestoring(root)).toBe(false);
		expect(rowsOf(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(0);
		expect(rosterProbes().length).toBeGreaterThanOrEqual(1); // it WAS probed (the roster names it finished)
		expect(watchedIds()).toEqual([]); // and the probe left no watch behind
	});

	it('a job the roster no longer lists restores CLOSED — and the probe never adopts an un-remembered live sibling', async () => {
		snapshotJobs = [job('other', 'running', OWNER)]; // j1 is gone; other is live but was never remembered
		const root = mountRaw({ restored: remembered });
		await settle();
		expect(isRestoring(root)).toBe(false);
		expect(rowsOf(root)).toHaveLength(0); // unknown means closed; the probe judges the remembered job only
		expect(watchedIds()).toEqual([]);
	});

	it('a DARK roster (the mirror still pending) counts as not live — restores closed, no watch; a later frame showing it running attaches the row', async () => {
		snapshotDark = true;
		const root = mountRaw({ restored: remembered });
		await settle();
		expect(isRestoring(root)).toBe(false);
		expect(rowsOf(root)).toHaveLength(0);
		expect(watchedIds()).toEqual([]);
		// the push stage re-adopts: the same job, now known to be running
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(openFollows()).toHaveLength(1);
		expect(watchedIds()).toEqual([OWNER]);
	});

	it('the probe never leaks a watch — a live remembered job leaves exactly the watch of its ROW; closing the rows empties the watch set', async () => {
		snapshotJobs = [job('j1', 'running', OWNER)];
		mountRaw({ restored: remembered });
		await settle();
		expect(watchedIds()).toEqual([OWNER]); // the probe watch was released: one row, one watch
		unmountDesk();
		flushSync();
		expect(watchedIds()).toEqual([]); // destroy released the watch of the row
		// two remembered live jobs on ONE owner, closed one by one: net 0, never a leaked refcount
		snapshotJobs = [job('j1', 'running', OWNER), job('j2', 'running', OWNER)];
		const root = mountRaw({ restored: { ...remembered, jobs: [{ owner: OWNER, jobId: 'j1' }, { owner: OWNER, jobId: 'j2' }] } });
		await settle();
		expect(rowsOf(root)).toHaveLength(2);
		expect(watchedIds()).toEqual([OWNER]);
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(watchedIds()).toEqual([OWNER]); // the row of j2 still holds its own
		clearJobTab(OWNER, 'j2');
		flushSync();
		expect(watchedIds()).toEqual([]);
	});

	it('jobs.autoAttach:false — a remembered LIVE job does NOT re-attach: nothing is probed, no roster fetch, no watch (karpathy 2.4)', async () => {
		configBody = { jobs: { autoAttach: false } };
		snapshotJobs = [job('j1', 'running', OWNER)];
		const root = mountRaw({ restored: remembered });
		await settle();
		expect(appConfig().jobs.autoAttach).toBe(false); // the real setting landed
		expect(isRestoring(root)).toBe(false);
		expect(tabCount(root)).toBe(2); // the SHELL half restores regardless
		expect(rowsOf(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(0);
		expect(rosterProbes()).toEqual([]);
		expect(watchedIds()).toEqual([]);
	});

	it.each([
		{ autoAttach: false, rows: 0 },
		{ autoAttach: true, rows: 1 }
	])('the config lands AFTER the ladder starts — the real setting ($autoAttach) decides, never the default', async ({ autoAttach, rows }) => {
		configBody = { jobs: { autoAttach } };
		snapshotJobs = [job('j1', 'running', OWNER)];
		let openGate!: () => void;
		configGate = new Promise<void>((resolve) => {
			openGate = resolve;
		});
		const root = mountRaw({ restored: remembered });
		await settle();
		// the shell half of the ladder has already run (the re-attach was issued)
		expect(fetchCalls.some((u) => u.includes('/s2/reattach'))).toBe(true);
		// but the desk still shows its placeholder: the job probe is WAITING on the
		// config — appConfig() is still the default true right now
		expect(appConfig().jobs.autoAttach).toBe(true);
		expect(isRestoring(root)).toBe(true);
		expect(rowsOf(root)).toHaveLength(0);
		expect(rosterProbes()).toEqual([]); // nothing probed before the setting is known
		openGate();
		await settle();
		expect(appConfig().jobs.autoAttach).toBe(autoAttach);
		expect(isRestoring(root)).toBe(false);
		expect(rowsOf(root)).toHaveLength(rows);
		if (!autoAttach) expect(rosterProbes()).toEqual([]);
	});

	it('an UNOWNED remembered job is not probed — a roster frame showing it live re-attaches it (the adoption stage)', async () => {
		const root = mountRaw({ restored: { ...remembered, jobs: [{ owner: '', jobId: 'u1' }] } });
		await settle();
		expect(isRestoring(root)).toBe(false);
		expect(rosterProbes()).toEqual([]); // no owner roster to probe
		expect(watchedIds()).toEqual([]);
		expect(rowsOf(root)).toHaveLength(0); // never attached blind — the job may be finished
		pushSource().emit(frame(OWNER, [job('u1')])); // still live: it rides a frame
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(openFollows()[0].url).toContain('/api/dsh/jobs/follow?jobId=u1');
		expect(openFollows()[0].url.includes('sessionId')).toBe(false);
	});

	it('an unowned remembered job that FINISHED stays closed — the frame shows it settled, so nothing attaches', async () => {
		const root = mountRaw({ restored: { ...remembered, jobs: [{ owner: '', jobId: 'u1' }] } });
		await settle();
		pushSource().emit(frame(OWNER, [job('u1', 'completed')]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(0);
	});

	it('the mirror round-trips owner + jobId: onMirror -> clampDeskMirror -> a fresh desk re-attaches the row', async () => {
		// desk A: a live row publishes
		snapshotJobs = [job('j1', 'running', OWNER)];
		const mirrorsA: Mirror[] = [];
		mountWithMirror(mirrorsA);
		await settle();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		const published = lastMirror(mirrorsA);
		expect(published.jobs).toEqual([{ owner: OWNER, jobId: 'j1' }]);
		unmountDesk();
		flushSync();
		// the stored blob, through the clamp, becomes the next desk restored prop
		const clamped = clampDeskMirror(JSON.parse(JSON.stringify(published)));
		expect(clamped?.jobs).toEqual([{ owner: OWNER, jobId: 'j1' }]);
		const mirrorsB: Mirror[] = [];
		const root = mountWithMirror(mirrorsB, { restored: clamped });
		await settle();
		expect(isRestoring(root)).toBe(false);
		expect(rowsOf(root)).toHaveLength(1); // the SAME job, back as a row
		expect(rowsOf(root)[0].textContent).toContain('coverage j1');
		expect(openFollows()).toHaveLength(1);
		// and desk B publishes the very same entry onward
		expect(lastMirror(mirrorsB).jobs).toEqual([{ owner: OWNER, jobId: 'j1' }]);
	});

	it('D-h and D-j agree: a push frame for the SAME remembered job, held during the ladder, attaches nothing extra — ONE row, ONE stream', async () => {
		snapshotJobs = [job('j1', 'running', OWNER)];
		const root = mountRaw({ restored: remembered });
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('j-late', 'running', OWNER)])); // held while restoring
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		await settle();
		expect(rowsOf(root)).toHaveLength(2); // j1 once (the ladder), j-late once (the held frame)
		expect(rowsOf(root).map((r) => r.textContent)).toEqual([expect.stringContaining('coverage j1'), expect.stringContaining('coverage j-late')]);
		expect(openFollows()).toHaveLength(2);
	});

	it('a follow stream that REFUSES TO OPEN during the probe degrades to closed — the ladder still settles, the shells restore', async () => {
		failFollows = true;
		snapshotJobs = [job('j1', 'running', OWNER)];
		const root = mountRaw({ restored: remembered });
		await settle();
		expect(isRestoring(root)).toBe(false); // never wedged on the placeholder
		expect(tabCount(root)).toBe(2);
		expect(rowsOf(root)).toHaveLength(0);
	});
});
