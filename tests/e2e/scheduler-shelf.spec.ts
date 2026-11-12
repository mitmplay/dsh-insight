/**
 * E2E: the Scheduler Shelf (ADR-0058, W3 task 3.1) — same stub-host setup
 * as sidebar.spec.ts (no live dsh web needed). Contract:
 *   1. the shelf mounts between the pinned-panel group and the filter row,
 *      COLLAPSED by default with an empty localStorage (D2/D3);
 *   2. expand → fixture ledger rows render honest data: armed green dot +
 *      countdown, paused amber dot + em-dash, ended gray dot + delivery
 *      receipt, kind chip, and the 'new'-target row as INERT text;
 *   3. click-through opens the target session on the floor — only for the
 *      row carrying a sessionId;
 *   4. the fold state persists per profile (localStorage dsi-scheduler);
 *   5. light + dark screenshot evidence into test-results.
 * Selectors are read from component source (dsi-task Step 3.8):
 *   data-testid scheduler-shelf / scheduler-shelf-toggle /
 *   scheduler-shelf-row / scheduler-counts (SchedulerShelf.svelte).
 * Spec: dev/specs/2026-11/2026-11-10 - The Scheduler Shelf.
 */
import { expect, test, type Page } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

// The config's webServer points DSH_BASE_URL at THIS port — every spec
// shares the one stub (workers: 1), like sidebar.spec.ts.
const STUB_PORT = 4590;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

/** Target sessions the fixture ledger points at. */
const TARGET_SESSION = 'e2e-schedule-target-0001';
/** The reserved id a new_once task minted at create time (click-through target). */
const ONCE_SESSION = 'e2e-schedule-once-0002';
const SCHED_ID = 'schedule-e2e-active-0001';

/** Host-shaped ScheduleCatalogEntry fixtures (stub state is verbatim wire
 *  data — DSI's normalizer consumes these shapes). FLAT, per the real
 *  ScheduleCatalogEntry = ScheduleRecord & { target, status, ... }
 *  (host packages/schedule/schedule/src/types.ts 460): kind/title/scheduledAt
 *  ride at the entry's top level, NOT nested under `record` — the earlier
 *  nested fixtures were storage-shaped and let the shelf render em-dash
 *  titles green against a wrong stub (fixed 2026-11-10). scheduledAt rides
 *  2h ahead so the countdown is stable ('in 1h 59m'..'in 2h 0m' window). */
function ledgerFixtures(): Record<string, unknown>[] {
	const in2h = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
	return [
		{
			// armed: green dot + countdown + click-through to its target
			id: SCHED_ID,
			kind: 'every',
			title: 'Nightly DSI report',
			prompt: 'write the report',
			everySeconds: 86_400,
			scheduledAt: in2h,
			target: { kind: 'session', sessionId: TARGET_SESSION },
			involvedSessionIds: [TARGET_SESSION],
			status: 'active',
			createdAt: new Date(Date.now() - 86_400_000).toISOString(),
			updatedAt: new Date(Date.now() - 3_600_000).toISOString()
		},
		{
			// paused with no next occurrence: amber dot + em-dash meta
			id: 'schedule-e2e-paused-0002',
			kind: 'daily',
			title: 'Morning digest',
			prompt: 'digest',
			time: '08:00',
			timeZone: 'UTC',
			target: { kind: 'new_once', sessionId: ONCE_SESSION, create: {} },
			involvedSessionIds: [ONCE_SESSION],
			status: 'paused',
			updatedAt: new Date(Date.now() - 7_200_000).toISOString()
		},
		{
			// ended one-shot: gray dot + delivery receipt (never a countdown)
			id: 'schedule-e2e-ended-0003',
			kind: 'after',
			title: 'One-shot ping',
			prompt: 'ping',
			afterSeconds: 60,
			scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
			target: { kind: 'new_once', sessionId: ONCE_SESSION, create: {} },
			involvedSessionIds: [ONCE_SESSION],
			status: 'ended',
			lastDelivery: {
				scheduledAt: new Date(Date.now() - 90_000_000).toISOString(),
				deliveredAt: new Date(Date.now() - 86_400_000).toISOString(),
				messageId: 'e2e-delivery-1',
				targetSessionId: ONCE_SESSION
			}
		},
		{
			// 'new'-kind target reserves NO session: the row is inert text
			id: 'schedule-e2e-new-0004',
			kind: 'rrule',
			title: 'Fresh session brief',
			prompt: 'brief',
			rrule: 'DTSTART;TZID=UTC:20261110T090000\nRRULE:FREQ=DAILY;COUNT=1',
			target: { kind: 'new', create: {} },
			involvedSessionIds: [],
			status: 'active'
		}
	];
}

async function plantLedger(): Promise<void> {
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ scheduleTasks: ledgerFixtures() })
	});
}

async function clearLedger(): Promise<void> {
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ scheduleTasks: [] })
	});
}

test.afterEach(async () => {
	await clearLedger();
});

async function expandShelf(page: Page): Promise<void> {
	const toggle = page.getByTestId('scheduler-shelf-toggle');
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
	await expect(page.getByTestId('scheduler-shelf-toggle')).toHaveAttribute('aria-expanded', 'true');
}

/** The pinned-panel row for an opened session (the floor's sidebar truth). */
function panelRow(page: Page, sessionId: string) {
	return page.locator(
		`[data-session-id="${sessionId}"][data-testid="sidebar-panel-row"],` +
			`[data-session-id="${sessionId}"][data-testid="sidebar-session-current"]`
	);
}

test('01 · collapsed by default on a clean profile — no fetch, honest header', async ({ page }) => {
	await plantLedger();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('scheduler-shelf')).toBeVisible();
	await expect(page.getByTestId('scheduler-shelf-toggle')).toHaveAttribute('aria-expanded', 'false');
	// collapsed → no rows region rendered at all
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(0);
	// the count pill reads (0/0) until the first expand (a collapsed shelf is silent)
	await expect(page.getByTestId('scheduler-counts')).toHaveText('(0/0)');
});

test('02 · expanded rows render honest ledger data', async ({ page }) => {
	await plantLedger();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandShelf(page);

	const rows = page.getByTestId('scheduler-shelf-row');
	await expect(rows).toHaveCount(4);

	// Unfiltered view (Filter Cluster D4): the pending pill counts rows
	// with NO receipt (3 of 4); the delivered pill counts receipt rows (1).
	await expect(page.getByTestId('scheduler-counts')).toHaveText('(3/1)');

	const armed = rows.filter({ hasText: 'Nightly DSI report' });
	await expect(armed.locator('.dot')).toHaveClass(/armed/);
	await expect(armed.locator('.meta')).toHaveText(/^in \d+h \d+m$/);

	const paused = rows.filter({ hasText: 'Morning digest' });
	await expect(paused.locator('.dot')).toHaveClass(/paused/);
	await expect(paused.locator('.meta')).toHaveText('—');

	const ended = rows.filter({ hasText: 'One-shot ping' });
	await expect(ended.locator('.dot')).toHaveClass(/ended/);
	// operator 2026-11-11: CheckCheck icon (last) + relative age; the
	// exact date moved into the title.
	await expect(ended.locator('.meta svg')).toHaveCount(1);
	await expect(ended.locator('.meta')).toHaveText(/(ago|just now)$/);
	await expect(ended.locator('.meta')).not.toHaveText(/delivered/);

	// the 'new'-kind row is inert text (no anchor to follow)
	const fresh = rows.filter({ hasText: 'Fresh session brief' });
	await expect(fresh).not.toHaveAttribute('href', /.+/);
	await expect(fresh.locator('.dot')).toHaveClass(/armed/);
});

test('03 · click-through opens the target session; the inert row stays put', async ({ page }) => {
	await plantLedger();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandShelf(page);

	const armed = page.getByTestId('scheduler-shelf-row').filter({ hasText: 'Nightly DSI report' });
	await armed.click();
	// the target session joins the floor — the sidebar's panel group lists it
	await expect(panelRow(page, TARGET_SESSION)).toBeVisible();

	// the inert row never navigates: its click leaves the floor untouched
	const fresh = page.getByTestId('scheduler-shelf-row').filter({ hasText: 'Fresh session brief' });
	await fresh.click({ force: true });
	await expect(panelRow(page, TARGET_SESSION)).toBeVisible();
});

test('04 · fold state persists per profile across reload', async ({ page }) => {
	await plantLedger();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandShelf(page);
	// collapse again → stored collapsed:true
	await page.getByTestId('scheduler-shelf-toggle').click();
	await expect(page.getByTestId('scheduler-shelf-toggle')).toHaveAttribute('aria-expanded', 'false');
	const stored = await page.evaluate(() => localStorage.getItem('dsi-scheduler'));
	expect(JSON.parse(stored ?? '{}')).toEqual({ collapsed: true, nameFilter: '', dateFilter: '', viewMode: 'all' });

	// a reload re-reads the stored fold (still collapsed), re-expanding persists false
	await page.reload();
	await expect(page.getByTestId('scheduler-shelf-toggle')).toHaveAttribute('aria-expanded', 'false');
	await expandShelf(page);
	const storedOpen = await page.evaluate(() => localStorage.getItem('dsi-scheduler'));
	expect(JSON.parse(storedOpen ?? '{}')).toEqual({ collapsed: false, nameFilter: '', dateFilter: '', viewMode: 'all' });
});

/** The shelf's filter row controls (selectors read from component
 *  source — Filter Cluster D7 testids + FilterDateButton's badge). */
function shelfFilter(page: Page) {
	return page.getByTestId('sidebar-scheduler-filter');
}

async function pressView(page: Page, seg: 's' | 'd'): Promise<void> {
	await page.getByTestId(`scheduler-view-toggle-${seg}`).click();
}

test('05 · typing in the name filter shrinks rows AND both pills', async ({ page }) => {
	await plantLedger();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandShelf(page);
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(4);
	await expect(page.getByTestId('scheduler-counts')).toHaveText('(3/1)');

	await shelfFilter(page).fill('One-shot');
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(1);
	await expect(page.getByTestId('scheduler-shelf-row')).toContainText('One-shot ping');
	// the count pill re-reflects the filtered slice (D4 honest counts):
	// the surviving row is the delivered one — the pill reads (0/1).
	await expect(page.getByTestId('scheduler-counts')).toHaveText('(0/1)');

	// clearing restores the full view
	await shelfFilter(page).fill('');
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(4);
});

test('06 · picking a date keeps only that day\'s scheduled rows', async ({ page }) => {
	await plantLedger();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandShelf(page);
	// The One-shot ping's scheduledAt is one day ago — its local day stamp.
	const day = new Date(Date.now() - 86_400_000);
	const dd = String(day.getDate()).padStart(2, '0');

	// open the shelf's calendar (FilterDateButton inside the shelf) and pick that day
	await page.getByTestId('scheduler-shelf').locator('.badge .trigger').click();
	await page.getByTestId('scheduler-shelf').locator('.cal-day', { hasText: dd }).first().click();

	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(1);
	await expect(page.getByTestId('scheduler-shelf-row')).toContainText('One-shot ping');
	// the day's only row is the delivered one — the pill reads (0/1)
	await expect(page.getByTestId('scheduler-counts')).toHaveText('(0/1)');
});

test('07 · pressing D keeps only the receipt rows', async ({ page }) => {
	await plantLedger();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandShelf(page);
	await pressView(page, 'd');
	await expect(page.getByTestId('scheduler-view-toggle-d')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(1);
	await expect(page.getByTestId('scheduler-shelf-row')).toContainText('One-shot ping');
	await expect(page.getByTestId('scheduler-counts')).toHaveText('(0/1)');

	// re-press returns to all (tri-state, D2)
	await pressView(page, 'd');
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(4);

	// S = pending delivery (SC#1 2026-11-11): the armed row awaits fire;
	// the paused row (no scheduledAt) and the delivered row are excluded.
	await pressView(page, 's');
	await expect(page.getByTestId('scheduler-view-toggle-s')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(1);
	await expect(page.getByTestId('scheduler-shelf-row')).toContainText('Nightly DSI report');
	await expect(page.getByTestId('scheduler-counts')).toHaveText('(1/0)');

	// back to all
	await pressView(page, 's');
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(4);
});

test('08 · reload restores the filters from prefs (D5)', async ({ page }) => {
	await plantLedger();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandShelf(page);
	await shelfFilter(page).fill('One-shot');
	await pressView(page, 'd');
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(1);

	await page.reload();
	await expandShelf(page);
	await expect(shelfFilter(page)).toHaveValue('One-shot');
	await expect(page.getByTestId('scheduler-view-toggle-d')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(1);
	await expect(page.getByTestId('scheduler-shelf-row')).toContainText('One-shot ping');
});

const THEMES: Array<'light' | 'dark'> = ['light', 'dark'];

for (const theme of THEMES) {
	test(`${theme}: shelf evidence screenshot`, async ({ page }) => {
		await plantLedger();
		await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
		// Theme is html[data-theme] (Three-State Lamp pre-paint, ADR-0023).
		await page.evaluate((t) => {
			document.documentElement.dataset.theme = t;
		}, theme);
		await expandShelf(page);
		await expect(page.getByTestId('scheduler-shelf-row')).toHaveCount(4);
		await page.getByTestId('scheduler-shelf').screenshot({
			path: `test-results/scheduler-shelf/${theme}-shelf.png`
		});
	});
}
