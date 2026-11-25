/**
 * TerminalDesk JOB ROW tests (The Job Bridge, ADR-0081 — Task 3.1-T).
 * The row species: a read-only strip hosted on a tab beside its shells,
 * in the parallel `tab.jobRows` array (never `tab.rows` — PRD 4.1).
 *   - a live roster push attaches ONE row on the SELECTED tab + ONE follow stream
 *   - re-attaching the same key (a repeated frame, a roster click) selects,
 *     never duplicates (find-or-create on `owner|id`)
 *   - a `status` follow event settles the row
 *   - closing a LIVE row records a dismissal that STICKS across identical
 *     rosters (the replace-on-every-tick trap 1)
 *   - closing a SETTLED row records nothing — the job can attach again
 *   - the 25 s linger (JOB_ROW_CLOSE_DELAY_MS) under jobs.autoClose, ported
 *     to rows; manual mode takes no closing action
 *   - destroy closes every follow
 *   - `data-rows` on the split container = shell rows + job rows
 *
 * Harness (terminal-desk-job-tabs.test.ts shape): happy-dom, mount +
 * flushSync, a FakeEventSource double, a fetch stub. The shell panel is
 * the shared TerminalPanelStub double (no xterm — the DESK's logic is under
 * test). Instances are SELECTED BY URL: the desk opens its own roster-push
 * stream on mount, so a follow is never `instances[0]` by assumption.
 * Dismissal is observed BEHAVIOURALLY — no internals: a closed live row must
 * not come back when the same live roster is delivered again.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalDesk from '../../src/lib/components/terminal/TerminalDesk.svelte';
import { clearJobTab, openJobTab, __resetFollowClientForTests } from '$lib/services/jobs/follow-client.svelte';
import { __resetRosterPushForTests } from '$lib/services/jobs/roster-push-client.svelte';
import { appConfig, resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';
import type { DsiJobView } from '$lib/types';

/** Every mounted stub panel's exports (the shared stub exposes `exitShell`), in
 *  mount order — a test drives a shell's natural exit through the desk's real
 *  `onShellExit → removeRow → closeTab` path instead of poking internals. */
const stubPanels = vi.hoisted(() => [] as Array<{ exitShell?: () => void }>);
vi.mock('$lib/components/terminal/TerminalPanel.svelte', async () => {
	const stub = await import('./TerminalPanelStub.svelte');
	return {
		...stub,
		// the stub component, wrapped only to hand each mounted instance to the test
		default: new Proxy(stub.default, {
			apply(target, thisArg, args) {
				const instance = Reflect.apply(target, thisArg, args);
				stubPanels.push(instance as { exitShell?: () => void });
				return instance;
			}
		})
	};
});

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

function followSources(): FakeEventSource[] {
	return FakeEventSource.instances.filter((i) => i.url.includes('/api/dsh/jobs/follow'));
}

/** The follow streams still OPEN — a closed one stays in the registry with closed=true. */
function openFollows(): FakeEventSource[] {
	return followSources().filter((i) => !i.closed);
}

function followFor(jobId: string): FakeEventSource {
	const es = followSources().find((i) => i.url.includes('jobId=' + jobId));
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
let snapshotJobs: unknown[] | null = null;

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith('/api/config')) return jsonResponse({ ok: true });
			if (url.includes('/api/dsh/jobs')) {
				return jsonResponse(snapshotJobs === null ? {} : { ok: true, jobs: snapshotJobs });
			}
			if (url === '/api/terminal' && init) return jsonResponse({ sessionId: 'minted-1', token: 'tok', totalBytes: 0 });
			return jsonResponse({});
		})
	);
}

/** Let the mount's async work land: the config load (which releases held
 *  roster frames), a minted session, the roster's first refresh. The config
 *  chain alone costs ~8 microtask turns (promise assimilation per .then), so
 *  this spends 10 — after it, a roster frame attaches on emit + flushSync. */
async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

type Desk = ReturnType<typeof mount> & { applyAction: (a: 'new-tab' | 'split-down' | 'clear-tab') => void };
let mounted: Desk | null = null;
let target: HTMLElement | null = null;

async function mountDesk(): Promise<HTMLElement> {
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(TerminalDesk, { target, props: {} as never }) as Desk;
	await settle(); // onMount → the push stream; the config load settles
	return target;
}

const rowsOf = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-testid="terminal-job-row"]'));

function tabContainer(root: HTMLElement, index: number): HTMLElement {
	const el = root.querySelector<HTMLElement>('[data-testid="terminal-tab-container-' + index + '"]');
	if (!el) throw new Error('no tab container ' + index);
	return el;
}

const splitRows = (root: HTMLElement, index: number): string | null =>
	tabContainer(root, index).querySelector('[data-testid="terminal-split-container"]')?.getAttribute('data-rows') ?? null;

function selectedTabIndex(root: HTMLElement): number {
	return Array.from(root.querySelectorAll('[data-testid^="terminal-tab-button-"]')).findIndex((el) => el.getAttribute('data-selected') === 'true');
}

/** The RETIRED species mark — the Tn-J follower tab (Wave 4.1 removed it). Kept
 *  as a zero guard: must stay empty in every scenario of this file. */
const jobTabButtons = (root: HTMLElement): Element[] =>
	Array.from(root.querySelectorAll('[data-testid^="terminal-tab-button-"]')).filter((el) => (el.textContent ?? '').includes('-J'));

/** Every tab button — shell tabs only (a job row is no tab: The Job Bridge 4.1). */
const tabCount = (root: HTMLElement): number => root.querySelectorAll('[data-testid^="terminal-tab-button-"]').length;

function selectTab(root: HTMLElement, index: number): void {
	(root.querySelector('[data-testid="terminal-tab-button-' + index + '"]') as HTMLElement).click();
	flushSync();
}

/** The × on a tab button — the desk's closeTab. */
function closeTabButton(root: HTMLElement, index: number): void {
	(root.querySelector('[data-testid="terminal-tab-close-' + index + '"]') as HTMLElement).click();
	flushSync();
}

/** The header's clear control → its popover → one scope verb (the desk's clearScope). */
async function clearVerb(root: HTMLElement, scope: 'all' | 'jobs' | 'terminals'): Promise<void> {
	(root.querySelector('[data-testid="terminal-tabstrip-clear"]') as HTMLElement).click();
	flushSync();
	(root.querySelector('[data-testid="terminal-tabstrip-clear-' + scope + '"]') as HTMLElement).click();
	flushSync();
	await settle(); // 'terminals' | 'all' mint the fresh T1
}

beforeEach(() => {
	stubPanels.length = 0;
	snapshotJobs = null;
	installFetch();
	vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	if (mounted) {
		unmount(mounted as unknown as ReturnType<typeof mount>);
		mounted = null;
	}
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

describe('TerminalDesk — job rows: attach (The Job Bridge 3.1-T)', () => {
	it('a live job in a roster push attaches ONE row and ONE follow stream — on the selected tab, under its shell', async () => {
		const root = await mountDesk();
		expect(rowsOf(root)).toHaveLength(0);
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		const row = rowsOf(root);
		expect(row).toHaveLength(1);
		// hosted on the selected tab (T1, the only one here) — inside its split container
		expect(tabContainer(root, 0).querySelector('[data-testid="terminal-job-row"]')).not.toBeNull();
		expect(row[0].getAttribute('data-state')).toBe('live');
		expect(row[0].textContent).toContain('coverage j1');
		// exactly one follow, keyed on the job
		const follows = openFollows();
		expect(follows).toHaveLength(1);
		expect(follows[0].url).toContain('/api/dsh/jobs/follow?');
		expect(follows[0].url).toContain('jobId=j1');
		expect(follows[0].url).toContain('sessionId=' + OWNER);
		// one roster-push stream serves the desk
		expect(FakeEventSource.instances.filter((i) => i.url === '/api/dsh/jobs/stream')).toHaveLength(1);
	});

	it('a birth lands on the SELECTED tab and never steals the selection', async () => {
		const root = await mountDesk();
		mounted!.applyAction('new-tab'); // T2 becomes the selected tab
		await settle();
		expect(selectedTabIndex(root)).toBe(1);
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(tabContainer(root, 1).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(1);
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(0);
		expect(selectedTabIndex(root)).toBe(1);
	});

	it('re-attaching the same key SELECTS its row — a repeated frame or a roster click never duplicates it', async () => {
		const root = await mountDesk();
		mounted!.applyAction('new-tab');
		await settle(); // T2 selected
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		// the same roster arrives again (the replace-on-every-tick trap) — inert
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(openFollows()).toHaveLength(1);
		// the operator moves to T1, then clicks the roster row of the SAME job:
		// the row's tab is selected — no second surface (no duplicate row, no -J tab)
		(root.querySelector('[data-testid="terminal-tab-button-0"]') as HTMLElement).click();
		flushSync();
		expect(selectedTabIndex(root)).toBe(0);
		openJobTab(OWNER, 'j1', 'coverage j1');
		flushSync();
		expect(selectedTabIndex(root)).toBe(1);
		expect(rowsOf(root)).toHaveLength(1);
		expect(openFollows()).toHaveLength(1);
		expect(jobTabButtons(root)).toHaveLength(0);
	});

	it('two different jobs become two rows and two streams; an unowned job attaches too (key |id)', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('u1')])); // u1 has no owner
		flushSync();
		expect(rowsOf(root)).toHaveLength(2);
		expect(openFollows()).toHaveLength(2);
		expect(followFor('u1').url).toContain('/api/dsh/jobs/follow?jobId=u1');
		expect(followFor('u1').url.includes('sessionId')).toBe(false);
	});

	it('a `status` follow event settles the row (live → settled); the tail stays readable', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('live');
		expect(rowsOf(root)[0].querySelector('[data-testid="terminal-job-row-state"]')?.textContent).toBe('live');
		const follow = followFor('j1');
		follow.emit(JSON.stringify({ type: 'output', text: 'line 1\n', next: 7 }));
		follow.emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		const row = rowsOf(root)[0];
		expect(row.getAttribute('data-state')).toBe('settled');
		expect(row.querySelector('[data-testid="terminal-job-row-state"]')?.textContent).toBe('settled');
		// manual mode (autoClose is the default false): the row stays, the output painted
		expect(rowsOf(root)).toHaveLength(1);
		expect(row.querySelector('[data-testid="job-tail"]')?.textContent).toContain('line 1');
	});
});

describe('TerminalDesk — job rows: dismissal is sticky (trap 1)', () => {
	it('closing a LIVE row records a dismissal — the identical live roster does not bring it back', async () => {
		const root = await mountDesk();
		const live = frame(OWNER, [job('j1', 'running', OWNER)]);
		pushSource().emit(live);
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		const follow = followFor('j1');
		// the roster row's clear button (the command bus) closes the row
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
		// the same running job re-arrives — twice (every spine tick re-delivers it)
		pushSource().emit(live);
		flushSync();
		pushSource().emit(live);
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(0); // no stream re-opened for it
	});

	it('closing a SETTLED row records nothing — the job attaches again when a roster shows it running', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		followFor('j1').emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('settled');
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		// a settled job's key is NOT dismissed: running again → the row attaches again
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('live');
		expect(openFollows()).toHaveLength(1); // a fresh follow for the re-attached row
	});
});

describe('TerminalDesk — job rows: the 25 s linger (PRD 4.7)', () => {
	it('under jobs.autoClose a settled row lingers 25 s, then closes — its follow closes with it', async () => {
		vi.useFakeTimers();
		appConfig().jobs.autoClose = true;
		// the roster snapshot agrees: nothing live is left
		snapshotJobs = [job('j1', 'completed', OWNER)];
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		const follow = followFor('j1');
		follow.emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		await vi.advanceTimersByTimeAsync(24_999); // operator grace — time to read the tail
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
	});

	it('without jobs.autoClose (the default) a settled row STAYS — the desk takes no closing action', async () => {
		vi.useFakeTimers();
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		followFor('j1').emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		await vi.advanceTimersByTimeAsync(120_000);
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('settled');
		// the follow ended at its own status frame (the stream's rule, never a desk
		// action — live gate 2026-11-25); what the desk must NOT close is the ROW,
		// and it is still here.
		expect(followFor('j1').closed).toBe(true);
		// only the clear command (the roster row's button) removes it
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
	});
});

describe('TerminalDesk — job rows: geometry and destroy', () => {
	it('data-rows on the split container = shell rows + job rows', async () => {
		const root = await mountDesk();
		expect(splitRows(root, 0)).toBe('1'); // one shell, no job row yet
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('j2', 'running', OWNER)]));
		flushSync();
		expect(splitRows(root, 0)).toBe('3'); // 1 shell + 2 job rows
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-panel"]')).toHaveLength(1);
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(splitRows(root, 0)).toBe('2');
		mounted!.applyAction('new-tab');
		await settle();
		expect(splitRows(root, 1)).toBe('1'); // the new tab hosts no job row
		expect(splitRows(root, 0)).toBe('2');
	});

	it('destroy closes EVERY follow stream, and the desk\'s roster-push stream with them', async () => {
		const root = await mountDesk();
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER), job('j2', 'running', OWNER)]));
		pushSource().emit(frame('session-b', [job('j3', 'running', 'session-b')]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(3);
		const follows = followSources();
		expect(follows).toHaveLength(3);
		const push = pushSource();
		unmount(mounted as unknown as ReturnType<typeof mount>);
		mounted = null;
		flushSync();
		expect(follows.map((es) => es.closed)).toEqual([true, true, true]);
		expect(push.closed).toBe(true);
	});
});

describe('TerminalDesk — job rows: D-g′ — a tab that goes away never dismisses a job', () => {
	const LIVE = frame(OWNER, [job('j1', 'running', OWNER)]);

	/** Two tabs (T2 added through the new-tab action), T1 selected again, a live
	 *  row born on T1 that has already painted a line. */
	async function mountWithRowOnFirstTab(): Promise<{ root: HTMLElement; follow: FakeEventSource }> {
		const root = await mountDesk();
		mounted!.applyAction('new-tab'); // T2 — becomes the selected tab
		await settle();
		expect(tabCount(root)).toBe(2);
		selectTab(root, 0); // back on T1, the row's future host
		pushSource().emit(LIVE);
		flushSync();
		followFor('j1').emit(JSON.stringify({ type: 'output', text: 'painted before the move\n', next: 21 }));
		flushSync();
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(1);
		return { root, follow: followFor('j1') };
	}

	/** The one tab that is left (the neighbour, shifted to index 0) is selected and
	 *  hosts the SAME row: one follow stream — never closed and re-opened — and the
	 *  tail it painted before the move. */
	function expectRowMovedToTheNeighbour(root: HTMLElement, follow: FakeEventSource): void {
		expect(tabCount(root)).toBe(1);
		expect(selectedTabIndex(root)).toBe(0);
		expect(rowsOf(root)).toHaveLength(1);
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(1);
		expect(splitRows(root, 0)).toBe('2'); // the neighbour's shell + the moved row
		expect(follow.closed).toBe(false);
		expect(followFor('j1')).toBe(follow); // the SAME instance
		expect(openFollows()).toHaveLength(1);
		expect(rowsOf(root)[0].querySelector('[data-testid="job-tail"]')?.textContent).toContain('painted before the move');
	}

	it('closing the host tab with its × while the job is LIVE relocates the row to the newly selected neighbour — same follow, events intact, no dismissal', async () => {
		const { root, follow } = await mountWithRowOnFirstTab();
		closeTabButton(root, 0);
		expectRowMovedToTheNeighbour(root, follow);
		// the identical live frame arrives afterwards: nothing changes
		pushSource().emit(LIVE);
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(openFollows()).toHaveLength(1);
		// the strip's OWN ✕ is still what dismisses it: identical live frame → no row
		(rowsOf(root)[0].querySelector('[data-testid="terminal-job-row-close"]') as HTMLElement).click();
		flushSync();
		expect(follow.closed).toBe(true);
		pushSource().emit(LIVE);
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
	});

	it('a relocation and a last-tab release record NO dismissal — the live job attaches again on a fresh tab', async () => {
		const { root, follow } = await mountWithRowOnFirstTab();
		closeTabButton(root, 0); // T1 → the row moves to T2
		expect(follow.closed).toBe(false);
		// the remaining tab is the LAST one: its close has no neighbour — the row is
		// released without a dismissal (the desk is going away; here it stays mounted)
		closeTabButton(root, 0);
		flushSync();
		expect(follow.closed).toBe(true);
		expect(rowsOf(root)).toHaveLength(0);
		expect(tabCount(root)).toBe(0);
		// a fresh tab opens, the identical live frame arrives → neither step left a dismissal
		mounted!.applyAction('new-tab');
		await settle();
		pushSource().emit(LIVE);
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		expect(openFollows()).toHaveLength(1);
	});

	it('the last shell of a tab EXITING on its own relocates a live row the same way (onShellExit → removeRow → closeTab)', async () => {
		const { root, follow } = await mountWithRowOnFirstTab();
		// stubPanels[0] is T1's shell (mounted first): it reports its own exit — the tab
		// loses its last shell and closes through the desk's removeRow path
		expect(stubPanels[0]?.exitShell).toBeTypeOf('function');
		stubPanels[0].exitShell!();
		flushSync();
		expectRowMovedToTheNeighbour(root, follow);
		pushSource().emit(LIVE);
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
	});

	it("clearScope('terminals'): a live row SURVIVES on the fresh T1 — the SAME follow, its events intact", async () => {
		const root = await mountDesk();
		pushSource().emit(LIVE);
		flushSync();
		const follow = followFor('j1');
		follow.emit(JSON.stringify({ type: 'output', text: 'painted before the clear\n', next: 21 }));
		flushSync();
		await clearVerb(root, 'terminals');
		expect(tabCount(root)).toBe(1); // the fresh T1 — a NEW shell (minted-1), not the old self-open one
		expect(selectedTabIndex(root)).toBe(0);
		expect(tabContainer(root, 0).querySelector('[data-testid="terminal-panel"]')?.getAttribute('data-assigned')).toBe('minted-1');
		expect(rowsOf(root)).toHaveLength(1);
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-job-row"]')).toHaveLength(1);
		expect(follow.closed).toBe(false);
		expect(followFor('j1')).toBe(follow); // the SAME instance
		expect(openFollows()).toHaveLength(1);
		expect(rowsOf(root)[0].querySelector('[data-testid="job-tail"]')?.textContent).toContain('painted before the clear');
		// not dismissed: the identical live frame is inert, and the row's own ✕ still dismisses it
		pushSource().emit(LIVE);
		flushSync();
		expect(rowsOf(root)).toHaveLength(1);
		(rowsOf(root)[0].querySelector('[data-testid="terminal-job-row-close"]') as HTMLElement).click();
		flushSync();
		pushSource().emit(LIVE);
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
	});

	it("clearScope('jobs'): the row is DISMISSED — the identical live frame afterwards attaches nothing; the shell is untouched", async () => {
		const root = await mountDesk();
		pushSource().emit(LIVE);
		flushSync();
		const follow = followFor('j1');
		await clearVerb(root, 'jobs');
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
		expect(tabCount(root)).toBe(1);
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-panel"]')).toHaveLength(1);
		pushSource().emit(LIVE);
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(openFollows()).toHaveLength(0);
	});

	it("clearScope('all'): the row is DISMISSED and the fresh T1 is minted — the identical live frame attaches nothing", async () => {
		const root = await mountDesk();
		pushSource().emit(LIVE);
		flushSync();
		const follow = followFor('j1');
		await clearVerb(root, 'all');
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
		expect(tabCount(root)).toBe(1);
		expect(tabContainer(root, 0).querySelector('[data-testid="terminal-panel"]')?.getAttribute('data-assigned')).toBe('minted-1');
		pushSource().emit(LIVE);
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
	});
});
