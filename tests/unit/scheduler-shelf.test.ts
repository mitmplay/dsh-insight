/**
 * Unit: SchedulerShelf (ADR-0058 W2 task 2.3-T) — the sidebar's
 * scheduler-ledger shelf. Pins: the armed-count pill equals the active
 * rows, the countdown humanizer's 'in 2h 5m' shape (and its em-dash
 * for absent/past/unparseable), the honest row rendering (dots, chips,
 * em-dashes, delivery receipt), the toggle's persist + refetch, and
 * the click gate — ONLY a row whose target carries a non-empty
 * sessionId opens a session; null / absent / 'new'-target rows never
 * call the opener. Direct mounts mirror the sidebar-sessions-list
 * precedent; fetch is stubbed per test (the setup's fetch-double is
 * replaced and restored).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
import SidebarSessionScheduler, {
	armedCount,
	collectShelfDates,
	deliveredCountOf,
	filterShelfTasks,
	humanizeCountdown,
	shelfDateStamp
} from '../../src/lib/components/sidebar/session-scheduler/SidebarSessionScheduler.svelte';
import { SCHEDULER_PREFS_KEY } from '$lib/utils/scheduler-prefs';
import type { DsiScheduledTask } from '$lib/types';

// The click-gate seam: the opener the shelf shares with the sidebar
// rows (RowSessionItem grammar) — mocked module-wide, asserted per test.
vi.mock('$lib/services/panels/panel-registry', () => ({
	addPanelFromSidebar: vi.fn(() => true)
}));

const NOW = Date.parse('2026-11-10T12:00:00Z');

const mkTask = (over: Partial<DsiScheduledTask> & { id: string }): DsiScheduledTask =>
	({
		title: 'Task ' + over.id,
		status: 'active',
		kind: 'at',
		scheduledAt: null,
		targetKind: 'session',
		targetSessionId: null,
		lastDelivery: null,
		...over
	} as DsiScheduledTask);

function installFetch(items: DsiScheduledTask[]): void {
	const fetchSpy = vi.fn(async () =>
		new Response(JSON.stringify({ items }), { status: 200, headers: { 'content-type': 'application/json' } })
	);
	vi.stubGlobal('fetch', fetchSpy);
}

interface ShelfHandle {
	host: HTMLElement;
	instance: Record<string, unknown>;
}

function mountShelf(): ShelfHandle {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const instance = mount(SidebarSessionScheduler, { target: host });
	flushSync();
	return { host, instance: instance as unknown as Record<string, unknown> };
}

async function expandedShelf(items: DsiScheduledTask[]): Promise<ShelfHandle> {
	// Pref-seed the expanded fold (D3): the shelf mounts expanded and the
	// mount fetch resolves into rows.
	localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":false}');
	installFetch(items);
	const h = mountShelf();
	await vi.waitFor(() => {
		expect(h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]').length).toBe(items.length);
	});
	return h;
}

function teardown(h: ShelfHandle): void {
	unmount(h.instance as never);
	h.host.remove();
}

describe('scheduler-shelf armed count (pure)', () => {
	it('counts only active rows', () => {
		expect(armedCount([])).toBe(0);
		expect(
			armedCount([
				mkTask({ id: 'a', status: 'active' }),
				mkTask({ id: 'p', status: 'paused' }),
				mkTask({ id: 'e', status: 'ended' }),
				mkTask({ id: 'b', status: 'active' })
			])
		).toBe(2);
	});
});

describe('scheduler-shelf countdown humanizer (pure)', () => {
	it('renders the in-Xh-Ym shape for a future date', () => {
		expect(humanizeCountdown(new Date(NOW + 125 * 60000).toISOString(), NOW)).toBe('in 2h 5m');
		expect(humanizeCountdown(new Date(NOW + 45 * 60000).toISOString(), NOW)).toBe('in 45m');
		expect(humanizeCountdown(new Date(NOW + 1500 * 60000).toISOString(), NOW)).toBe('in 1d 1h');
	});

	it('renders the em-dash for absent, past, and unparseable', () => {
		expect(humanizeCountdown(null, NOW)).toBe('—');
		expect(humanizeCountdown('', NOW)).toBe('—');
		expect(humanizeCountdown(new Date(NOW - 60000).toISOString(), NOW)).toBe('—');
		expect(humanizeCountdown('not-a-date', NOW)).toBe('—');
	});
});

describe('scheduler-shelf rendered rows', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it('mounts collapsed by default: no rows, count 0, aria-expanded false, ZERO fetches', async () => {
		installFetch([]);
		const h = mountShelf();
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect((h.host.querySelector('[data-testid="scheduler-shelf-toggle"]') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');
		expect(h.host.querySelector('[data-testid="scheduler-shelf-row"]')).toBeNull();
		expect(h.host.querySelector('[data-testid="scheduler-counts"]')?.textContent).toBe('(0/0)');
		// The lazy-fetch discipline: a quiet shelf is a silent one — mounting
		// the sidebar never adds wire traffic by itself (sessions-list suites
		// share this mount and count their own fetches strictly).
		expect(vi.mocked(fetch).mock.calls.length).toBe(0);
		teardown(h);
	});

	it('empty ledger: header count 0 and an honest empty line when expanded', async () => {
		const h = await expandedShelf([]);
		expect(h.host.querySelector('[data-testid="scheduler-counts"]')?.textContent).toBe('(0/0)');
		// Wait on the EMPTY LINE itself — a 0-row predicate is vacuously true
		// before the mount fetch resolves and `loaded` flips. The honest empty
		// line is the em-dash (nothing to show, said without copy).
		await vi.waitFor(() => expect(h.host.querySelector('.empty')?.textContent).toBe('—'));
		teardown(h);
	});

	it('rows render honest fields: countdown, receipt, em-dashes, dots, pill count', async () => {
		const items = [
			// clock-relative: the row humanizer renders against the real wall
			// clock, so a frozen NOW fixture goes stale (em-dash) once the
			// real clock passes it - pin the armed task 3h in the future.
			mkTask({ id: 'armed', scheduledAt: new Date(Date.now() + 3 * 3600000).toISOString() }),
			mkTask({ id: 'no-next', scheduledAt: null }),
			mkTask({ id: 'paused', status: 'paused' }),
			mkTask({
				id: 'done',
				status: 'ended',
				lastDelivery: { deliveredAt: '2026-11-09T08:30:00Z', targetSessionId: 's-born' }
			}),
			mkTask({ id: 'bare', title: '', kind: null })
		];
		const h = await expandedShelf(items);
		// Unfiltered view (D4): the pending pill counts surviving rows with
		// NO receipt (4 of 5); the delivered pill counts ended-with-receipt rows (1).
		expect(h.host.querySelector('[data-testid="scheduler-counts"]')?.textContent).toBe('(4/1)');
		const rows = [...h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]')];
		expect(rows.length).toBe(items.length);
		const byRow = (index: number): { dot: Element | null; title: string | null; kind: string | null; kindIcon: Element | null; icon: Element | null; meta: string | null } => {
			const row = rows[index] as HTMLElement;
			return {
				dot: row.querySelector('.dot'),
				title: row.querySelector('.title')?.textContent ?? null,
				kind: row.querySelector('.kind')?.textContent?.trim() ?? null,
				kindIcon: row.querySelector('.kind svg'),
				icon: row.querySelector('.meta svg'),
				meta: row.querySelector('.meta')?.textContent?.trim() ?? null
			};
		};
		// armed row: green dot + an 'in N…' countdown (shape, not value —
		// render-time Date.now() may have ticked past the fixture's now).
		expect(byRow(0).dot?.classList.contains('armed')).toBe(true);
		expect(byRow(0).meta ?? '').toMatch(/^in \d/);
		// the recurrence cell: wire kind + its glyph (operator 2026-11-11
		// [icon]{label} column, left-aligned fixed width).
		expect(byRow(0).kind).toBe('at');
		expect(byRow(0).kindIcon).not.toBeNull();
		// absent scheduledAt on an active row → the em-dash, never invented.
		expect(byRow(1).meta).toBe('—');
		// paused → amber dot + em-dash meta.
		expect(byRow(2).dot?.classList.contains('paused')).toBe(true);
		expect(byRow(2).meta).toBe('—');
		// ended with a receipt → gray dot + CheckCheck icon (last) +
		// relative age (operator 2026-11-11; exact date in the title).
		expect(byRow(3).dot?.classList.contains('ended')).toBe(true);
		expect(byRow(3).icon).not.toBeNull();
		expect(byRow(3).meta ?? '').toMatch(/^(just now|\ds ago|\dm ago|\dh ago|\dd ago|—)$/);
		// absent title/kind → em-dashes, never invented text (operator
		// 2026-11-11: the kind cell renders the dash with NO glyph when
		// the wire kind is unknown).
		expect(byRow(4).title).toBe('—');
		expect(byRow(4).kind).toBe('—');
		expect(byRow(4).kindIcon).toBeNull();
		teardown(h);
	});

	it('toggle persists the fold per profile key and refetches on expand', async () => {
		installFetch([]);
		const h = mountShelf();
		// Lazy mount: the collapsed shelf made no calls yet; the FIRST read is
		// the expand itself. No interval, no subscription — reads only here.
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect(vi.mocked(fetch).mock.calls.length).toBe(0);
		const toggle = h.host.querySelector('[data-testid="scheduler-shelf-toggle"]') as HTMLButtonElement;
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		toggle.click();
		flushSync();
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		// D3 + D5: the whole view blob persists under the base key (no
		// profile on this mount); an unfiltered shelf stores the defaults.
		expect(localStorage.getItem(SCHEDULER_PREFS_KEY)).toBe('{"collapsed":false,"nameFilter":"","dateFilter":"","viewMode":"all"}');
		// Every expand re-reads the ledger (exactly 1 read so far; no timer).
		await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(1));
		teardown(h);
	});
});

describe('scheduler-shelf filter pipeline (Filter Cluster 1.2-T)', () => {
	const T = (over: Partial<DsiScheduledTask> & { id: string }): DsiScheduledTask => mkTask(over);
	const receipt = { deliveredAt: '2026-11-09T08:30:00Z', targetSessionId: 's-1' };
	const ledger = [
		T({ id: 'armed-sched', status: 'active', title: 'Nightly report', scheduledAt: '2026-11-11T09:00:00Z' }),
		T({ id: 'paused-sched', status: 'paused', title: 'Digest', scheduledAt: '2026-11-12T09:00:00Z' }),
		T({ id: 'ended-receipt', status: 'ended', title: 'Ping', scheduledAt: '2026-11-14T09:00:00Z', lastDelivery: receipt }),
		T({ id: 'ended-bare', status: 'ended', title: 'Bare end', scheduledAt: null, lastDelivery: null }),
		T({ id: 'bad-date', status: 'active', title: 'Broken clock', scheduledAt: 'not-a-date' }),
		T({ id: 'other-day', status: 'active', title: 'report follower', scheduledAt: '2026-11-13T09:00:00Z' })
	];

	it('shelfDateStamp mirrors deliveryDate: YYYY-MM-DD or empty', () => {
		expect(shelfDateStamp('2026-11-11T09:00:00Z')).toBe('2026-11-11');
		expect(shelfDateStamp(null)).toBe('');
		expect(shelfDateStamp('')).toBe('');
		expect(shelfDateStamp('not-a-date')).toBe('');
	});

	it('collectShelfDates stamps only parseable scheduledAt days', () => {
		// insertion order — the delivered fixture row precedes other-day
		expect([...collectShelfDates(ledger)]).toEqual(['2026-11-11', '2026-11-12', '2026-11-14', '2026-11-13']);
		expect([...collectShelfDates([])]).toEqual([]);
	});

	it('deliveredCountOf counts only ended-with-receipt rows', () => {
		expect(deliveredCountOf(ledger)).toBe(1);
		expect(deliveredCountOf([])).toBe(0);
	});

	it('name stage: substring on title; empty title matches only the empty filter', () => {
		expect(filterShelfTasks(ledger, 'report', '', 'all').map((t) => t.id)).toEqual(['armed-sched', 'other-day']);
		expect(filterShelfTasks([T({ id: 'blank', title: '' })], '', '', 'all').length).toBe(1);
		expect(filterShelfTasks([T({ id: 'blank', title: '' })], 'report', '', 'all').length).toBe(0);
	});

	it('date stage: only rows scheduled on the picked day survive', () => {
		expect(filterShelfTasks(ledger, '', '2026-11-12', 'all').map((t) => t.id)).toEqual(['paused-sched']);
		// unparseable scheduledAt never matches a day
		expect(filterShelfTasks(ledger, '', '2026-11-11', 'all').map((t) => t.id)).toEqual(['armed-sched']);
	});

	it('view stage S (SC#1): pending delivery only — scheduledAt present, no receipt', () => {
		// armed + paused + other-day await fire; the DELIVERED row with a
		// scheduledAt (ended-receipt, 11-14) is excluded — it already fired.
		expect(filterShelfTasks(ledger, '', '', 'scheduled').map((t) => t.id)).toEqual(['armed-sched', 'paused-sched', 'other-day']);
		// unparseable scheduledAt is not a schedule
		expect(filterShelfTasks([T({ id: 'bad', status: 'active', scheduledAt: 'not-a-date' })], '', '', 'scheduled')).toEqual([]);
	});

	it('view stage D: only ended-with-receipt rows survive; zero receipts reads empty', () => {
		expect(filterShelfTasks(ledger, '', '', 'delivered').map((t) => t.id)).toEqual(['ended-receipt']);
		expect(filterShelfTasks([T({ id: 'bare', status: 'ended', lastDelivery: null })], '', '', 'delivered')).toEqual([]);
	});

	it('the pipeline composes name → date → view', () => {
		expect(filterShelfTasks(ledger, 'report', '2026-11-11', 'scheduled').map((t) => t.id)).toEqual(['armed-sched']);
		expect(filterShelfTasks([], '', '', 'delivered')).toEqual([]);
	});
});

describe('scheduler-shelf click gate', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.mocked(addPanelFromSidebar).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it('only a non-empty targetSessionId opens; null/absent/new-target rows never call', async () => {
		const items = [
			mkTask({ id: 'opens', targetSessionId: 's-9' }),
			mkTask({ id: 'null-target', targetSessionId: null }),
			mkTask({ id: 'new-kind', targetKind: 'new', targetSessionId: null }),
			mkTask({ id: 'empty-target', targetSessionId: '' })
		];
		const h = await expandedShelf(items);
		const opener = vi.mocked(addPanelFromSidebar);
		// The target-bearing row is the ANCHOR arm (href fallback); the
		// others render inert (no anchor, no navigation possible).
		const rows = [...h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]')];
		expect((rows[0] as HTMLElement).tagName).toBe('A');
		expect((rows[0] as HTMLAnchorElement).getAttribute('href')).toContain('sessionKey=s-9');
		for (let i = 1; i < rows.length; i++) expect((rows[i] as HTMLElement).tagName).not.toBe('A');
		for (const row of rows) (row as HTMLElement).click();
		flushSync();
		expect(opener).toHaveBeenCalledTimes(1);
		expect(opener).toHaveBeenCalledWith({ sessionId: 's-9', agentPreset: null });
		teardown(h);
	});
});

describe('scheduler-shelf host wiring (Filter Cluster 2.3-T)', () => {
	const items = [
		mkTask({ id: 'a', title: 'Nightly report', scheduledAt: '2026-11-11T09:00:00Z' }),
		mkTask({ id: 'b', title: 'Morning digest', scheduledAt: '2026-11-12T09:00:00Z' }),
		mkTask({ id: 'c', status: 'ended', title: 'One-shot ping', lastDelivery: { deliveredAt: '2026-11-09T08:30:00Z', targetSessionId: 's-1' } })
	];

	beforeEach(() => {
		localStorage.clear();
		vi.mocked(addPanelFromSidebar).mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		localStorage.clear();
	});

	it('typing in the filter shrinks rows and both pills; clearing restores', async () => {
		const h = await expandedShelf(items);
		const input = h.host.querySelector('[data-testid="sidebar-scheduler-filter"]') as HTMLInputElement;
		input.value = 'report';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]').length).toBe(1);
		expect(h.host.querySelector('[data-testid="scheduler-counts"]')?.textContent).toBe('(1/0)');
		input.value = '';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]').length).toBe(3);
		teardown(h);
	});

	it('a no-match filter renders the honest 0 + em-dash line', async () => {
		const h = await expandedShelf(items);
		const input = h.host.querySelector('[data-testid="sidebar-scheduler-filter"]') as HTMLInputElement;
		input.value = 'zzz-no-match';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(h.host.querySelector('[data-testid="scheduler-counts"]')?.textContent).toBe('(0/0)');
		expect(h.host.querySelector('.empty')?.textContent).toBe('—');
		teardown(h);
	});

	it('the D toggle keeps only receipt rows; re-click returns to all', async () => {
		const h = await expandedShelf(items);
		(h.host.querySelector('[data-testid="scheduler-view-toggle-d"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]').length).toBe(1);
		// D-mode honesty: the only visible row is delivered — the pill reads (0/1).
		expect(h.host.querySelector('[data-testid="scheduler-counts"]')?.textContent).toBe('(0/1)');
		(h.host.querySelector('[data-testid="scheduler-view-toggle-d"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]').length).toBe(3);
		teardown(h);
	});

	it('filter callbacks persist the prefs blob', async () => {
		const h = await expandedShelf(items);
		const input = h.host.querySelector('[data-testid="sidebar-scheduler-filter"]') as HTMLInputElement;
		input.value = 'digest';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		(h.host.querySelector('[data-testid="scheduler-view-toggle-s"]') as HTMLButtonElement).click();
		flushSync();
		expect(JSON.parse(localStorage.getItem(SCHEDULER_PREFS_KEY) ?? '{}')).toEqual({
			collapsed: false,
			nameFilter: 'digest',
			dateFilter: '',
			viewMode: 'scheduled'
		});
		teardown(h);
	});

	it('prefs seed the filters on mount (reloaded shelf reopens filtered)', async () => {
		localStorage.setItem(
			SCHEDULER_PREFS_KEY,
			'{"collapsed":false,"nameFilter":"digest","dateFilter":"","viewMode":"all"}'
		);
		installFetch(items);
		const h = mountShelf();
		await vi.waitFor(() => {
			expect(h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]').length).toBe(1);
		});
		expect((h.host.querySelector('[data-testid="sidebar-scheduler-filter"]') as HTMLInputElement).value).toBe('digest');
		teardown(h);
	});

	it('click-through is unaffected by filters (the filtered row still opens)', async () => {
		const h = await expandedShelf([mkTask({ id: 'opens', title: 'Nightly report', targetSessionId: 's-9' })]);
		const input = h.host.querySelector('[data-testid="sidebar-scheduler-filter"]') as HTMLInputElement;
		input.value = 'Nightly';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		(h.host.querySelector('[data-testid="scheduler-shelf-row"]') as HTMLElement).click();
		flushSync();
		expect(vi.mocked(addPanelFromSidebar)).toHaveBeenCalledWith({ sessionId: 's-9', agentPreset: null });
		teardown(h);
	});
});
