/**
 * TerminalDesk JOB ROW ADOPTION tests (The Job Bridge, ADR-0081 — Task 3.2-T).
 * Two birth stages, ONE predicate (job-adoption.ts): the roster PUSH
 * (primary — one frame after birth) and the spine-tick SNAPSHOT (fallback).
 *   - a live job in a push frame attaches with NO click (the inverse of probe G1)
 *   - jobs.autoAttach:false → nothing attaches, from either stage
 *   - a dismissed job is not re-adopted when the same roster is delivered twice (trap 1)
 *   - a settled job arriving is ignored; `stopping` counts as live (edge case 2.4)
 *   - an unowned job attaches (key `|id`)
 *   - a push-delivered job and a snapshot-delivered job with the same key → ONE row
 *   - the snapshot fallback catches a birth the push never delivered, once the desk
 *     knows the owner (a watch per attached row/tab — task 3.2)
 *   - ONE attached set: a click attaches a ROW and a birth never duplicates it (The
 *     Job Bridge 4.1 retired the Tn-J tab species on 2026-11-25 — the D-i
 *     coexistence pins below were re-pointed to the row species, same intent)
 *   - D-h: a frame that arrives during the rebuild ladder / the config load is held,
 *     never lost (and never judged before consent is known — karpathy 2.6)
 *   - PRD 4.7: roster-driven settle, and when a dismissal is forgotten
 *
 * Harness: terminal-desk-job-rows.test.ts shape (happy-dom, mount + flushSync, a
 * FakeEventSource double, a fetch double, the shared TerminalPanelStub). Streams are
 * selected BY URL. The roster SNAPSHOT is driven through the real store: the fetch
 * double answers /api/dsh/jobs, and jobsRoster.refreshWatched() is the spine tick.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalDesk from '../../src/lib/components/terminal/TerminalDesk.svelte';
import { clearJobTab, openJobTab, __resetFollowClientForTests } from '$lib/services/jobs/follow-client.svelte';
import { __resetRosterPushForTests } from '$lib/services/jobs/roster-push-client.svelte';
import { jobsRoster } from '$lib/services/jobs/roster-store.svelte';
import { appConfig, resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';
import { refreshSpineFeed, resetSpineFeedForTests } from '../../src/lib/services/conversation/spine-feed.svelte';
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

function pushSource(): FakeEventSource {
	const es = FakeEventSource.instances.find((i) => i.url === '/api/dsh/jobs/stream');
	if (!es) throw new Error('no roster push stream open');
	return es;
}

const openFollows = (): FakeEventSource[] =>
	FakeEventSource.instances.filter((i) => i.url.includes('/api/dsh/jobs/follow') && !i.closed);

/** A fetch double's Response — `ok`/`status`/`json()` only, microtask-bound: everything
 *  the desk awaits settles inside settle(), under real AND fake timers (happy-dom's real
 *  Response.json() costs far more microtask turns than a microtask loop spends). */
function jsonResponse(body: unknown): Response {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** Tunable per test. `snapshotJobs === null` → the roster answers an unknown body
 *  (nothing applied — the mirror is DARK): the push is the only signal unless said
 *  otherwise. */
let snapshotJobs: DsiJobView[] | null = null;
let configBody: Record<string, unknown> = {};
/** The page's session list (`/api/dsh/sessions`, the spine feed): the fallback's owner source. */
let spineSessions: Array<{ sessionId: string }> | null = null;

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith('/api/config')) return jsonResponse({ ok: true, ...configBody });
			if (url.startsWith('/api/dsh/sessions')) return jsonResponse({ ok: true, sessions: spineSessions ?? [] });
			if (url.includes('/api/dsh/jobs')) {
				if (snapshotJobs === null) return jsonResponse({});
				if (url.includes('sessionIds=')) {
					// the spine tick's BATCH snapshot: one roster per watched session
					const ids = (new URL(url, 'http://x').searchParams.get('sessionIds') ?? '').split(',');
					const rosters = Object.fromEntries(ids.map((id) => [id, { jobs: snapshotJobs }]));
					return jsonResponse({ ok: true, rosters });
				}
				return jsonResponse({ ok: true, jobs: snapshotJobs }); // the first watch's singular load
			}
			if (url.includes('/reattach')) return jsonResponse({ token: 'tok' });
			if (url === '/api/terminal' && !init) {
				return jsonResponse({ enabled: true, sessions: [{ id: 's1', exited: false, deskIntent: 'new-tab' }] });
			}
			if (url === '/api/terminal' && init) return jsonResponse({ sessionId: 'minted-1', token: 'tok', totalBytes: 0 });
			return jsonResponse({});
		})
	);
}

/** Let async work land: the config load (which releases held roster frames), a
 *  minted session, the rebuild ladder, the roster's refresh. The config chain alone
 *  costs ~8 microtask turns (promise assimilation per .then), so this spends 10 —
 *  after it, a roster frame attaches on emit + flushSync. */
async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** One spine tick: the batch roster snapshot lands, the effects re-run. */
async function tick(): Promise<void> {
	jobsRoster.refreshWatched();
	await settle();
}

let mounted: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

/** Mount and let everything settle: the desk can adopt (config landed). */
async function mountDesk(props: Record<string, unknown> = {}): Promise<HTMLElement> {
	const root = mountRaw(props);
	await settle();
	return root;
}

/** Mount WITHOUT awaiting: the config load and the rebuild ladder are still in
 *  flight — only onMount has run (the push stream is open). */
function mountRaw(props: Record<string, unknown> = {}): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(TerminalDesk, { target, props: props as never }) as unknown as Record<string, unknown>;
	flushSync();
	return target;
}

const rowsOf = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-testid="terminal-job-row"]'));

/** The RETIRED species mark — the Tn-J follower tab (Wave 4.1 removed it). Kept
 *  as a zero guard: must stay empty in every scenario of this file. */
const jobTabButtons = (root: HTMLElement): Element[] =>
	Array.from(root.querySelectorAll('[data-testid^="terminal-tab-button-"]')).filter((el) => (el.textContent ?? '').includes('-J'));

function tabContainer(root: HTMLElement, index: number): HTMLElement {
	const el = root.querySelector<HTMLElement>('[data-testid="terminal-tab-container-' + index + '"]');
	if (!el) throw new Error('no tab container ' + index);
	return el;
}

beforeEach(() => {
	snapshotJobs = null;
	configBody = {};
	spineSessions = null;
	installFetch();
	vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	if (mounted) {
		unmount(mounted);
		mounted = null;
	}
	target?.remove();
	target = null;
	__resetFollowClientForTests();
	__resetRosterPushForTests();
	resetStreamHubForTests();
	resetAppConfigForTests();
	resetSpineFeedForTests();
	jobsRoster.unwatch(OWNER);
	FakeEventSource.instances = [];
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('TerminalDesk — a job that PREDATES the desk (karpathy 2.4: a desk mounted mid-job catches it on the next tick)', () => {
	it('is adopted from the page\'s own session rows on the spine tick — with NO push frame (the live gate, 2026-11-25)', async () => {
		// the job was running long before the desk mounted: no birth frame will ever
		// arrive for it, so only the SNAPSHOT fallback can paint it — and only if the
		// desk knows its owner. It learns the owner from the spine's session list.
		snapshotJobs = [job('early')];
		spineSessions = [{ sessionId: OWNER }];
		const root = await mountDesk();
		expect(rowsOf(root)).toHaveLength(0); // mounted blind: nothing yet
		jobsRoster.watch(OWNER); // what the heartbeat scope does for a session on screen
		await refreshSpineFeed(); // one spine tick: the session list lands, then the batch roster
		await settle();
		const rows = rowsOf(root);
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).toContain('coverage early');
		expect(rows[0].getAttribute('data-state')).toBe('live');
	});
});

describe('TerminalDesk — job row adoption: the PUSH stage (The Job Bridge 3.2-T)', () => {
	it('a live job in a push frame attaches a row with NO click (the inverse of probe G1)', async () => {
		const root = await mountDesk();
		expect(openFollows()).toHaveLength(0); // probe G1\'s starting point: zero follows, no click
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(openFollows()).toHaveLength(1);
		expect(jobTabButtons(root)).toHaveLength(0); // a row, not a -J tab
	});

	it('jobs.autoAttach:false → NOTHING attaches — from the push or the snapshot', async () => {
		appConfig().jobs.autoAttach = false;
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('u1')]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		// the operator CLICKED one job — consent by click: its ROW attaches, and the
		// desk now holds a watch on the owner, so the snapshot re-delivers the other
		// live jobs every tick. Still nothing attaches for THEM.
		openJobTab(OWNER, 'j0', 'clicked');
		snapshotJobs = [job('j0', 'running', OWNER), job('j1', 'running', OWNER), job('u1')];
		await tick();
		await tick();
		expect(rowsOf(root)).toHaveLength(1); // exactly the clicked row — no auto row
		expect(rowsOf(root)[0].textContent).toContain('clicked');
		expect(jobTabButtons(root)).toHaveLength(0); // a row, never a -J tab (Wave 4.1)
	});

	it('a frame that arrives BEFORE the config settles is held, then judged against the real setting (karpathy 2.6)', async () => {
		configBody = { jobs: { autoAttach: false } };
		const root = mountRaw();
		expect(appConfig().jobs.autoAttach).toBe(true); // the default — the setting is not known yet
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0); // held — never guessed on the default
		await settle();
		expect(appConfig().jobs.autoAttach).toBe(false);
		expect(rowsOf(root)).toHaveLength(0); // released against consent: nothing attaches
		expect(openFollows()).toHaveLength(0);
	});

	it('…and the same held frame DOES attach once the config lands with autoAttach on — never lost', async () => {
		configBody = { jobs: { autoAttach: true } };
		const root = mountRaw();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0); // held while the setting is unknown
		await settle();
		expect(rowsOf(root)).toHaveLength(1);
	});
});

describe('TerminalDesk — job row adoption: what the predicate vetoes', () => {
	it('a settled job arriving is ignored; `stopping` counts as live', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('done', 'completed', OWNER), job('failed', 'failed', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		pushSource().emit(frame(OWNER, [job('stopping', 'stopping', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1); // isLiveJob: running | stopping
	});

	it('an unowned job attaches (key |id) — no owner to watch, the push is its only signal', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('u1')])); // no owner field
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		const follow = openFollows()[0];
		expect(follow.url).toContain('/api/dsh/jobs/follow?jobId=u1');
		expect(follow.url.includes('sessionId')).toBe(false);
	});
});

describe('TerminalDesk — job row adoption: dismissal is sticky (trap 1)', () => {
	it('a dismissed job is not re-adopted when the same roster is delivered twice — by push AND by snapshot', async () => {
		const root = await mountDesk();
		const roster = [job('j1', 'running', OWNER), job('j2', 'running', OWNER)];
		pushSource().emit(frame(OWNER, roster));
		flushSync();
		expect(rowsOf(root)).toHaveLength(2);
		// the operator closes j1 while it is still live
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		// twice by push…
		pushSource().emit(frame(OWNER, roster));
		flushSync();
		pushSource().emit(frame(OWNER, roster));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		// …and twice by the spine-tick snapshot. j2 still holds a watch on the owner,
		// so this roster is really current — the job is PRESENT and live: the
		// dismissal stays (PRD 4.7 releases it only when the job settles or leaves)
		snapshotJobs = roster;
		await tick();
		await tick();
		expect(rowsOf(root)).toHaveLength(1);
	});

	it('a DARK roster (the mirror still pending) never reads as "left" — the dismissal stays', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('j2', 'running', OWNER)]));
		flushSync();
		clearJobTab(OWNER, 'j1');
		flushSync();
		// the owner is still watched (j2) but the snapshot is dark: [] — indistinguishable
		// from an empty roster, so absence is no evidence
		await tick();
		await tick();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('j2', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
	});

	it('PRD 4.7 — a dismissal is forgotten once the job SETTLES: the key is eligible again', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		clearJobTab(OWNER, 'j1');
		flushSync();
		// the roster shows the job finished → the key is released
		pushSource().emit(frame(OWNER, [job('j1', 'completed', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0); // not live: never adoptable
		// the same key runs again (a future job) → eligible
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
	});

	it('PRD 4.7, amended by the live gate (2026-11-25) — a snapshot that PREDATES the job\'s birth must not read as "left": a row dismissed within one tick of its birth stays dismissed', async () => {
		const root = await mountDesk();
		// the owner is watched through a live sibling, and the desk\'s snapshot of it
		// does not list j-new YET: no spine tick has run since the birth
		snapshotJobs = [job('old', 'running', OWNER)];
		pushSource().emit(frame(OWNER, [job('old', 'running', OWNER), job('j-new', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(2);
		// the operator closes j-new about a second after its birth, while it is live
		clearJobTab(OWNER, 'j-new');
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		// a tick: the desk-refreshed roster is non-empty (old) and ABSENT of j-new — because
		// it predates the birth, not because the job left. The lane floor did exactly this.
		await tick();
		// the next frame re-delivers j-new live
		pushSource().emit(frame(OWNER, [job('old', 'running', OWNER), job('j-new', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1); // still dismissed: absence released nothing
		expect(rowsOf(root).some((r) => (r.textContent || '').includes('j-new'))).toBe(false);
	});

	it('PRD 4.7 — a dismissal is forgotten ONLY when the job is SHOWN SETTLED, never by absence (ids are never reused: an unreleased key costs nothing)', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('j2', 'running', OWNER)]));
		flushSync();
		clearJobTab(OWNER, 'j1');
		flushSync();
		// j2 keeps the owner watched; the tick\'s roster no longer lists j1 …
		snapshotJobs = [job('j2', 'running', OWNER)];
		await tick();
		// … but absence is no evidence: a later frame lists j1 live again → still dismissed
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('j2', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		// SHOWN SETTLED → the key is released, and the same key is eligible again
		pushSource().emit(frame(OWNER, [job('j1', 'completed', OWNER), job('j2', 'running', OWNER)]));
		flushSync();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('j2', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(2);
	});
});

describe('TerminalDesk — job row adoption: the two stages agree', () => {
	it('a push-delivered job and a snapshot-delivered job with the same key produce ONE row (and ONE stream)', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		snapshotJobs = [job('j1', 'running', OWNER)];
		await tick();
		await tick();
		expect(rowsOf(root)).toHaveLength(1);
		expect(openFollows()).toHaveLength(1);
	});

	it('the SNAPSHOT fallback catches a birth the push never delivered, once the desk knows the owner', async () => {
		const root = await mountDesk();
		// the operator clicked one job (its ROW) — the desk now holds a watch on the owner
		openJobTab(OWNER, 'j0', 'clicked');
		flushSync();
		expect(rowsOf(root)).toHaveLength(1); // the clicked row
		// a second job is born, but its push frame never reaches this desk; the
		// snapshot of the spine tick carries it
		snapshotJobs = [job('j0', 'running', OWNER), job('j-late', 'running', OWNER)];
		await tick();
		expect(rowsOf(root)).toHaveLength(2); // the clicked row + j-late, attached from the snapshot, no click
		expect(rowsOf(root).map((r) => r.textContent)).toEqual([expect.stringContaining('clicked'), expect.stringContaining('coverage j-late')]);
		expect(tabContainer(root, 0).querySelector('[data-testid="terminal-job-row"]')).not.toBeNull();
		expect(jobTabButtons(root)).toHaveLength(0); // j0 is a row like j-late — ONE species (Wave 4.1)
	});

	it('ONE attached set — a job with a clicked ROW gets no second surface; the one stream of its row stays (the D-i pin, re-pointed)', async () => {
		const root = await mountDesk();
		openJobTab(OWNER, 'j1', 'clicked');
		flushSync();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1); // the clicked row IS the surface — never a second one
		expect(rowsOf(root)[0].textContent).toContain('clicked'); // still the clicked label: nothing re-attached
		expect(jobTabButtons(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(1);
	});
});

describe('TerminalDesk — job row adoption: D-h and PRD 4.7 edge cases', () => {
	it('D-h — a frame that arrives DURING the rebuild ladder is held and adopted once the tree settles', async () => {
		// a restored desk starts EMPTY: the ladder probes /api/terminal and re-attaches
		const root = mountRaw({ restored: { tabs: [{ sessionIds: ['s1'] }], selectedTab: 0 } });
		expect(root.querySelector('[data-testid="terminal-desk-restoring"]')).not.toBeNull();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0); // held: no tab to host on yet
		await settle(); // the ladder settles
		expect(root.querySelector('[data-testid="terminal-desk-restoring"]')).toBeNull();
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(1); // never lost
		expect(openFollows()).toHaveLength(1);
	});

	it('PRD 4.7 — a roster showing the row\'s job no longer live settles the row (no status event needed)', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('live');
		// the status frame never arrives; the spine tick\'s roster shows it completed
		snapshotJobs = [job('j1', 'completed', OWNER)];
		await tick();
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('settled');
	});
});
