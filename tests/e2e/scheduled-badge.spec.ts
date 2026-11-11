/**
 * E2E: the Scheduled Mark's SCH badge (task 2.3, ADR-0057) — same stub-host
 * setup as sidebar.spec.ts (no live dsh web needed). Contract:
 *   1. a fixture session whose session.list row carries origin 'scheduled'
 *      renders the muted clock+SCH pill on BOTH sidebar surfaces — the
 *      pinned-panel group (SidebarOpenPanels rows) and the recency spine
 *      (SidebarSessionList rows);
 *   2. a subagent fixture row and an ordinary row render NO pill;
 *   3. theme light + dark screenshot evidence into test-results.
 * Selectors are read from component source (dsi-task Step 3.8):
 *   data-testid sidebar-session-card (RowSessionItem anchor),
 *   sidebar-session-current / sidebar-panel-row (SidebarOpenPanelRows),
 *   sidebar-sch-badge (WorkspaceRowItem pill).
 * Spec: dev/specs/2026-11/2026-11-10 - The Scheduled Mark.
 */
import { expect, test } from '@playwright/test';
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

const SCH_ID = 'e2e-scheduled-session-0001';

/** Plant one scheduled fixture row + one subagent row (the negative).
 *  Byte-neutral hygiene matches sidebar.spec.ts afterEach. */
async function plantFixtures(): Promise<void> {
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			scheduledSessions: [{ sessionId: SCH_ID, title: 'Nightly DSI report', ageMs: 60_000 }],
			lineageSessions: [
				{ sessionId: 'e2e-sub-agent-sch', parentSessionId: STUB_SESSION_ID, title: 'Spawned helper', cwd: '/tmp' }
			]
		})
	});
}

async function clearFixtures(): Promise<void> {
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ scheduledSessions: [], lineageSessions: [] })
	});
}

test.afterEach(async () => {
	await clearFixtures();
});

/** The spine card (SidebarSessionList surface) for a session id. */
function spineCard(page: import('@playwright/test').Page, sessionId: string) {
	return page.locator(`[data-testid="sidebar-session-card"][href*="sessionKey=${sessionId}"]`);
}

/** The panel-group row (SidebarOpenPanels surface) for a session id. */
function panelRowBySession(page: import('@playwright/test').Page, sessionId: string) {
	return page.locator(
		`[data-session-id="${sessionId}"][data-testid="sidebar-panel-row"],` +
			`[data-session-id="${sessionId}"][data-testid="sidebar-session-current"]`
	);
}

async function openPanelGroup(page: import('@playwright/test').Page): Promise<void> {
	const toggle = page.getByTestId('sidebar-panel-group-toggle');
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

const THEMES: Array<'light' | 'dark'> = ['light', 'dark'];

for (const theme of THEMES) {
	test(`${theme}: SCH badge renders on both sidebar surfaces (scheduled row only)`, async ({ page }) => {
		await plantFixtures();
		await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
		// Theme is html[data-theme] (Three-State Lamp pre-paint, ADR-0023):
		// set the resolved choice directly — the same attr the tokens read.
		await page.evaluate((t) => {
			document.documentElement.dataset.theme = t;
		}, theme);
		await openPanelGroup(page);

		// SPINE surface: the fixture's recency card carries the pill.
		const spineBadge = spineCard(page, SCH_ID).locator('[data-testid="sidebar-sch-badge"]');
		await expect(spineBadge).toBeVisible();
		await expect(spineBadge).toHaveText('SCH');

		// Theme evidence into test-results (screenshots are generated
		// artifacts, never source) — taken BEFORE the panel-open click
		// (the click navigates, detaching this card's handle).
		const rail = page.getByTestId('app-sidebar');
		await rail.screenshot({ path: `test-results/scheduled-badge/${theme}-sidebar.png` });
		await spineCard(page, SCH_ID).first().screenshot({
			path: `test-results/scheduled-badge/${theme}-spine-row.png`
		});

		// PANEL surface: the pinned group lists OPEN panels — open the
		// scheduled session (the spine card's plain click verb, ADR-0006 R5)
		// and its panel row carries the pill too.
		await spineCard(page, SCH_ID).click();
		const panelBadge = panelRowBySession(page, SCH_ID).locator('[data-testid="sidebar-sch-badge"]');
		await expect(panelBadge).toBeVisible();
		await expect(panelBadge).toHaveText('SCH');
		await panelRowBySession(page, SCH_ID).screenshot({
			path: `test-results/scheduled-badge/${theme}-panel-row.png`
		});

		// Negatives: the subagent row (ghost + spine) and the ordinary
		// focused session carry NO pill — the badge is exact-match origin.
		await expect(page.locator('[data-testid="sidebar-ghost-row"]').locator('[data-testid="sidebar-sch-badge"]')).toHaveCount(0);
		await expect(spineCard(page, 'e2e-sub-agent-sch').locator('[data-testid="sidebar-sch-badge"]')).toHaveCount(0);
		await expect(panelRowBySession(page, STUB_SESSION_ID).locator('[data-testid="sidebar-sch-badge"]')).toHaveCount(0);

		// D2: the title string is untouched — the pill is separate DOM.
		await expect(panelRowBySession(page, SCH_ID).locator('.label')).toHaveText('Nightly DSI report');
	});
}
