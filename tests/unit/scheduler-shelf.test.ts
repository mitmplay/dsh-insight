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
import SidebarSessionScheduler, { armedCount, humanizeCountdown } from '../../src/lib/components/sidebar/session-scheduler/SidebarSessionScheduler.svelte';
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
		expect(h.host.querySelector('[data-testid="scheduler-shelf-count"]')?.textContent).toBe('0');
		// The lazy-fetch discipline: a quiet shelf is a silent one — mounting
		// the sidebar never adds wire traffic by itself (sessions-list suites
		// share this mount and count their own fetches strictly).
		expect(vi.mocked(fetch).mock.calls.length).toBe(0);
		teardown(h);
	});

	it('empty ledger: header count 0 and an honest empty line when expanded', async () => {
		const h = await expandedShelf([]);
		expect(h.host.querySelector('[data-testid="scheduler-shelf-count"]')?.textContent).toBe('0');
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
		// armed/active: 'armed', 'no-next', 'bare' (mkTask defaults active) = 3.
		expect(h.host.querySelector('[data-testid="scheduler-shelf-count"]')?.textContent).toBe('3');
		const rows = [...h.host.querySelectorAll('[data-testid="scheduler-shelf-row"]')];
		expect(rows.length).toBe(items.length);
		const byRow = (index: number): { dot: Element | null; title: string | null; chip: string | null; meta: string | null } => {
			const row = rows[index] as HTMLElement;
			return {
				dot: row.querySelector('.dot'),
				title: row.querySelector('.title')?.textContent ?? null,
				chip: row.querySelector('.chip')?.textContent ?? null,
				meta: row.querySelector('.meta')?.textContent ?? null
			};
		};
		// armed row: green dot + an 'in N…' countdown (shape, not value —
		// render-time Date.now() may have ticked past the fixture's now).
		expect(byRow(0).dot?.classList.contains('armed')).toBe(true);
		expect(byRow(0).meta ?? '').toMatch(/^in \d/);
		// absent scheduledAt on an active row → the em-dash, never invented.
		expect(byRow(1).meta).toBe('—');
		// paused → amber dot + em-dash meta.
		expect(byRow(2).dot?.classList.contains('paused')).toBe(true);
		expect(byRow(2).meta).toBe('—');
		// ended with a receipt → gray dot + 'delivered <date>'.
		expect(byRow(3).dot?.classList.contains('ended')).toBe(true);
		expect((byRow(3).meta ?? '').startsWith('delivered ')).toBe(true);
		// absent title/kind → em-dashes, never invented text.
		expect(byRow(4).title).toBe('—');
		expect(byRow(4).chip).toBe('—');
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
		// D3: persisted under the base key (no profile on this mount).
		expect(localStorage.getItem(SCHEDULER_PREFS_KEY)).toBe('{"collapsed":false}');
		// Every expand re-reads the ledger (exactly 1 read so far; no timer).
		await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(1));
		teardown(h);
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
