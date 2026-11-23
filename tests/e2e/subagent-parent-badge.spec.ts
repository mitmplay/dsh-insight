/**
 * E2E: the Sub-Agent Parent Badge (ADR-0078, task 3.1) — same stub-host
 * setup as scheduled-badge.spec.ts / sidebar.spec.ts spec 19 (no live dsh
 * web needed). Contract:
 *   1. a seeded spine holding a 5-sub-agent parent (OFF the floor, spec-19
 *      posture — the vantage is a different session) — the pill shows "5";
 *   2. toggling the Bot/BotOff filter does NOT change it (the badge is
 *      precisely what survives the filter);
 *   3. a childless row shows no sidebar-sub-badge;
 *   4. child rows (filter off) show no badge (ADR-0078 D1).
 * Selectors read from component source (dsi-task Step 3.8):
 *   data-testid sidebar-session-card (RowSessionItem anchor),
 *   sidebar-sub-badge (WorkspaceRowItem pill),
 *   sidebar-spine-subagents (the header Bot toggle).
 * Spec: dev/specs/2026-11/2026-11-23 - Sub-Agent Parent Badge.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const SPAWNER_TITLE = 'E2E stub conversation';
const VANTAGE = 'e2e-subbadge-vantage';
const SUB_IDS = ['e2e-subbadge-a', 'e2e-subbadge-b', 'e2e-subbadge-c', 'e2e-subbadge-d', 'e2e-subbadge-e'];

/** Plant the 5-sub-agent family + the off-floor vantage (spec-19 posture:
 *  the head stays in the SPINE; the vantage carries the URL). */
async function plantFixtures(): Promise<void> {
	const turn = [
		{ event: { type: 'turn/start', seq: 21, time: 1787212000011, data: {} } },
		{ event: { type: 'turn/end', seq: 22, time: 1787212000012, data: {} } }
	];
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			lineageSessions: SUB_IDS.map((sessionId, i) => ({
				sessionId,
				parentSessionId: STUB_SESSION_ID,
				title: `Spawned helper ${i + 1}`,
				running: false,
				cwd: '/tmp'
			})),
			extraSessions: [
				{ sessionId: VANTAGE, title: 'Subbadge vantage', agentPreset: 'main', cwd: '/tmp', ledger: turn, ageMs: 90 * 60_000 }
			]
		})
	});
}

async function clearFixtures(): Promise<void> {
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ lineageSessions: [], extraSessions: [] })
	});
}

test.afterEach(async () => {
	await clearFixtures();
});

function spineCard(page: import('@playwright/test').Page, sessionId: string) {
	return page.locator(`[data-testid="sidebar-session-card"][href*="sessionKey=${sessionId}"]`);
}

/** The panel-group row (SidebarOpenPanelRows surface) for a session id. */
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

const SCH_ID = 'e2e-scheduled-subbadge-0001';

test('the spawner wears the Bot 5 pill; it survives the Bot filter; children show none', async ({ page }) => {
	await plantFixtures();
	await page.goto(`/?sessionKey=${VANTAGE}`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	// 1. The parent's spine card carries the pill with EXACT text "5".
	const spawner = spineCard(page, STUB_SESSION_ID);
	const badge = spawner.locator('[data-testid="sidebar-sub-badge"]');
	await expect(badge).toBeVisible();
	await expect(badge).toHaveText('5');

	// 2. Toggle the Bot filter ON — children vanish, the pill is unchanged.
	await page.getByTestId('sidebar-spine-subagents').click();
	await expect(page.getByTestId('sidebar-spine-subagents')).toHaveAttribute('aria-pressed', 'true');
	for (const id of SUB_IDS) {
		await expect(spineCard(page, id)).toHaveCount(0);
	}
	await expect(spawner.locator('[data-testid="sidebar-sub-badge"]')).toHaveText('5');

	// 3. Filter back OFF — child rows return and show NO badge (D1).
	await page.getByTestId('sidebar-spine-subagents').click();
	await expect(page.getByTestId('sidebar-spine-subagents')).toHaveAttribute('aria-pressed', 'false');
	await expect(spineCard(page, SUB_IDS[0])).toHaveCount(1);
	await expect(spineCard(page, SUB_IDS[0]).locator('[data-testid="sidebar-sub-badge"]')).toHaveCount(0);

	// 4. A childless row shows NO badge.
	await expect(spineCard(page, 'e2e-chat-session-0003').locator('[data-testid="sidebar-sub-badge"]')).toHaveCount(0);

	// D2: the parent's title string is untouched — the pill is separate DOM.
	await expect(spawner.locator('.label')).toHaveText(SPAWNER_TITLE);
});

test('the Focused group panel row wears Bot 5 — filter ON and OFF; ghosts bare; SCH panel unaffected', async ({ page }) => {
	const turn = [
		{ event: { type: 'turn/start', seq: 21, time: 1787212000011, data: {} } },
		{ event: { type: 'turn/end', seq: 22, time: 1787212000012, data: {} } }
	];
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			lineageSessions: SUB_IDS.map((sessionId, i) => ({
				sessionId,
				parentSessionId: STUB_SESSION_ID,
				title: `Spawned helper ${i + 1}`,
				running: false,
				cwd: '/tmp'
			})),
			extraSessions: [
				{ sessionId: VANTAGE, title: 'Subbadge vantage', agentPreset: 'main', cwd: '/tmp', ledger: turn, ageMs: 90 * 60_000 }
			],
			scheduledSessions: [{ sessionId: SCH_ID, title: 'Nightly DSI report', ageMs: 60_000 }]
		})
	});
	await page.goto(`/?sessionKey=${VANTAGE}`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();
	await openPanelGroup(page);

	// Open the spawner AND the scheduled session as panels (the spine
	// card's plain click verb) — the panel rows join the Focused group.
	await spineCard(page, STUB_SESSION_ID).click();
	await spineCard(page, SCH_ID).click();

	// The panel row carries the pill with EXACT text "5" (filter OFF).
	const panelRow = panelRowBySession(page, STUB_SESSION_ID);
	const badge = panelRow.locator('[data-testid="sidebar-sub-badge"]');
	await expect(badge).toHaveText('5');

	// Unfold the family so the ghost cluster shows, then assert ghosts bare.
	const fold = panelRow.locator('[data-testid="sidebar-panel-fold"]');
	if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
	const ghost = page.locator('[data-testid="sidebar-ghost-row"]').first();
	await expect(ghost).toBeVisible();
	await expect(ghost.locator('[data-testid="sidebar-sub-badge"]')).toHaveCount(0);

	// Toggle the group's Bot filter ON — ghost rows tuck away, the pill holds.
	await page.getByTestId('sidebar-open-panels-subagents').click();
	await expect(page.getByTestId('sidebar-open-panels-subagents')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('[data-testid="sidebar-ghost-row"]')).toHaveCount(0);
	await expect(panelRow.locator('[data-testid="sidebar-sub-badge"]')).toHaveText('5');

	// Filter OFF — ghosts return bare, the pill still reads 5.
	await page.getByTestId('sidebar-open-panels-subagents').click();
	await expect(page.getByTestId('sidebar-open-panels-subagents')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('[data-testid="sidebar-ghost-row"]').first()).toBeVisible();
	await expect(panelRow.locator('[data-testid="sidebar-sub-badge"]')).toHaveText('5');

	// The {SCH} panel row is unaffected: SCH pill intact, NO sub-badge.
	const schRow = panelRowBySession(page, SCH_ID);
	await expect(schRow.locator('[data-testid="sidebar-sch-badge"]')).toHaveAttribute('aria-label', 'SCH');
	await expect(schRow.locator('[data-testid="sidebar-sub-badge"]')).toHaveCount(0);
});
