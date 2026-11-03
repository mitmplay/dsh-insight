/**
 * E2E: DSI Panel Floor (Panel Floor W3 task 3.4-T, ADR-0006).
 *
 * Specs 01–17 pin the floor + sidebar panel controls against the stub DSH host:
 *   01 seed resets + strips the URL to /
 *   02 refresh restores N panels + selection (localStorage truth)
 *   03 BC-1 network proof with N panels polling (spec 07 pattern)
 *   04 panel 404 → honest error card + close, siblings unaffected
 *   05 replace remounts ONLY the selected panel (sibling scroll unchanged)
 *   06 add via spine click → second live panel (dedupe→select covered in unit)
 *   07 panel list renders + click selects (W4 4.1)
 *   08 panel-list close removes only its panel; spine row returns (W4 4.1/4.3)
 *   09 Shift+click replaces the SELECTED panel only — sibling unchanged (W4)
 *   10 paneled sessions excluded from the spine (W4 4.3)
 *   20 paste-replace (Rplc) swaps the ACTIVE panel — count + slot survive
 *   16 header chevrons move a panel; the ACTIVE panel follows (order persists)
 *   17 sidebar move up/down reorder the floor; edges hide their buttons
 *   22 panel group caps at half the body column; rows scroll internally
 *   23 selecting an off-viewport panel scrolls it into view (selection follow)
 *   24 a move reshuffle re-reveals the focused panel (move up/down)
 *
 * Stub seam (spec-check GAP-5): state.extraSessions — extra session.list
 * rows each carrying their OWN ledger, so two sessions with content coexist.
 */

import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { DshStubHost, STUB_SESSION_ID, STUB_USER_HELLO } from './dsh-stub';

const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

/** The GAP-5 second session — its own ledger with distinct text. */
const SECOND_SESSION_ID = 'e2e-panel-session-0002';
const SECOND_TEXT = 'Second panel says hi';

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

/** Panel-group open state (2026-09-18): the sidebar's pinned-panel
 *  group ships EXPANDED; the suites that exercise the ROW list only
 *  open it when a stored choice folded it (per-desk, reload-persistent). */
async function openPanelGroup(page: import('@playwright/test').Page): Promise<void> {
	const toggle = page.getByTestId('sidebar-panel-group-toggle');
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

/** Stub state write (POST /__e2e/state merges). */
async function stubSet(patch: Record<string, unknown>): Promise<void> {
	const res = await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(patch)
	});
	if (!res.ok) throw new Error(`stub state POST failed: ${res.status}`);
}

/** Seed the GAP-5 second session with a one-turn ledger. */
async function addSecondSession(): Promise<void> {
	await stubSet({
		extraSessions: [
			{
				sessionId: SECOND_SESSION_ID,
				title: 'Second panel conversation',
				agentPreset: 'research',
				cwd: '/tmp',
				ledger: [
					{
						event: {
							type: 'user/message',
							seq: 2,
							time: Date.now(),
							data: { content: [{ type: 'text', text: SECOND_TEXT }], id: 'u2', role: 'user' }
						}
					}
				]
			}
		]
	});
}

/** The GAP-5 third session — the REPLACE target for specs 05/09 (W4: the
 *  paneled sessions' spine rows are excluded, so the replace source must be
 *  a session with its OWN ledger that no panel holds yet; the canonical
 *  'Chat side session' row carries none — replacing onto it would 404). */
const THIRD_SESSION_ID = 'e2e-panel-session-0003';
const THIRD_TEXT = 'Third panel says hi';

async function addThirdSession(): Promise<void> {
	const res = await fetch(stubCtl);
	const state = (await res.json()) as {
		extraSessions: Array<{ sessionId: string; title: string; agentPreset: string | null; cwd: string; ledger: unknown[] }>;
	};
	const second = state.extraSessions.find((r) => r.sessionId === SECOND_SESSION_ID);
	await stubSet({
		extraSessions: [
			...(second ? [second] : []),
			{
				sessionId: THIRD_SESSION_ID,
				title: 'Third panel conversation',
				agentPreset: null,
				cwd: '/tmp',
				ledger: [
					{
						event: {
							type: 'user/message',
							seq: 2,
							time: Date.now(),
							data: { content: [{ type: 'text', text: THIRD_TEXT }], id: 'u3', role: 'user' }
						}
					}
				]
			}
		]
	});
}

test.beforeEach(async () => {
	// Fresh workspace per spec: clear dsi-panels (the workspace truth).
	await stubSet({ extraSessions: [] });
});

test('01 · seed resets the workspace and strips the URL', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toContainText(STUB_USER_HELLO);
	// One panel; the address bar no longer names the session.
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	await expect(page).toHaveURL(/\/$/);
});

test('02 · refresh restores N panels + selection', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	// Plain-click the second session's spine row → second panel. Add
	// joins BEFORE THE FOCUSED PANEL (2026-08-31): the focused seed sits
	// at the head, so the new panel lands at nth(0).
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(SECOND_TEXT);

	// Refresh: both panels + selection survive (localStorage truth).
	await page.reload();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await expect(page).toHaveURL(/\/$/);
	// Selection restored: the added (front) column carries the selected class.
	await expect(page.getByTestId('panel-column').nth(0)).toHaveClass(/selected/);

	// Overlap fix (2026-08-25): the selection ring draws OUTSIDE the
	// column and never paints over the panel chrome. 2026-09-04
	// (5497393): the flat outline became a masked ::after band — same
	// outside geometry, rounded; this pin follows the band (exists,
	// floats, never intercepts pointers), replacing the outlineOffset
	// read the restyle retired.
	const ring = await page
		.getByTestId('panel-column')
		.nth(0)
		.evaluate((el) => {
			const s = getComputedStyle(el, '::after');
			return { content: s.content, position: s.position, pointerEvents: s.pointerEvents };
		});
	expect(ring.content).toBe('""');
	expect(ring.position).toBe('absolute');
	expect(ring.pointerEvents).toBe('none');

	// Focus tint (2026-08-28): the focused panel's composer footer tints
	// oldlace; an unfocused panel's stays white — with N conversations
	// side by side, the tinted composer is the one that receives input.
	const focusedFooter = page.getByTestId('panel-column').nth(0).getByTestId('conversation-footer');
	await expect(focusedFooter).toBeVisible();
	expect(await focusedFooter.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
		'rgb(253, 245, 230)'
	); // oldlace
	const unfocusedFooter = page
		.getByTestId('panel-column')
		.nth(1)
		.getByTestId('conversation-footer');
	expect(await unfocusedFooter.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
		'rgb(255, 255, 255)'
	);
});

test('03 · BC-1 — N panels polling never talk to the host directly', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	const forbidden: string[] = [];
	page.on('request', (req) => {
		const u = req.url();
		if (u.includes(':3080') || u.includes(':4590')) forbidden.push(u);
	});
	await page.waitForTimeout(2_500); // one idle poll per panel + margin
	expect(forbidden).toEqual([]);
});

test('04 · stored-dead session → honest error card + close, sibling unaffected', async ({ page }) => {
	await addSecondSession();
	// Open two live panels first.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// Kill the second session on the host, then refresh: its panel (the
	// front one — the add joined before the focused seed) cold-loads into
	// an error state (session-not-found), the sibling stays whole.
	await stubSet({ extraSessions: [] });
	await page.reload();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	const dead = page.getByTestId('panel-column').nth(0);
	await expect(dead).toContainText(/not found|unavailable|error/i, { timeout: 10_000 });
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(STUB_USER_HELLO);

	// Close removes the dead panel; the sibling survives. (Use the error
	// card's own close button — the sibling's floating-anchor FAB can
	// overlap the panel header at default widths.)
	await dead.getByTestId('panel-error-close').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(STUB_USER_HELLO);
});

test('05 · replace remounts only the selected panel (sibling scroll unchanged)', async ({ page }) => {
	await addSecondSession();
	await addThirdSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// Sibling-scroll locality (commitment 6): record the SEED panel's
	// transcript geometry + content fingerprint (the added panel joined
	// before the focused seed — the front — and is the selected one; the
	// seed rides nth(1)). The
	// stub transcript does not overflow (content tracks viewport height),
	// so scrollTop stays 0 — the honest observable is that a
	// replace-selected remount of the OTHER panel leaves THIS one
	// byte-identical (scroll metrics + content).
	const siblingScroll = page.getByTestId('transcript').nth(1);
	const fingerprint = await siblingScroll.evaluate((el) => ({
		st: el.scrollTop,
		sh: el.scrollHeight,
		ch: el.clientHeight,
		len: el.innerHTML.length
	}));

	// Shift+click the THIRD session's spine row (W4: paneled sessions are
	// excluded from the spine, so the replace source is a never-paneled
	// session with its own ledger — the canonical Chat-side row carries
	// none): replace-selected swaps the SELECTED panel only — the URL stays
	// / and the sibling keeps its transcript.
	const thirdRow = page.locator(
		`[data-testid="sidebar-session-card"][href*="${THIRD_SESSION_ID}"]`
	);
	await expect(thirdRow).toBeVisible({ timeout: 10_000 });
	await thirdRow.click({ modifiers: ['Shift'] });
	await expect(page).toHaveURL(/\/$/);
	// The swapped panel (the FRONT one — it was the selected add) now
	// shows the THIRD session's transcript…
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(THIRD_TEXT, {
		timeout: 10_000
	});
	// …and the sibling's geometry + content are byte-identical (remount
	// locality — a remount would reset scroll metrics and rebuild the DOM).
	const after = await siblingScroll.evaluate((el) => ({
		st: el.scrollTop,
		sh: el.scrollHeight,
		ch: el.clientHeight,
		len: el.innerHTML.length
	}));
	expect(after).toEqual(fingerprint);
});

test('06 · spine click adds; already-paneled session dedupes (W4 surface)', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await openPanelGroup(page);

	// Dedupe (W4 surface): the paneled session's spine row is EXCLUDED from
	// the spine (spec 10 pins that), so the add-dedupe observable here is
	// the PANEL LIST — selecting panel 1 via its list row, then plain
	// click the second session's... also excluded. The spine-level dedupe
	// (plain click on an already-paneled row) is exercised in unit at the
	// owner boundary (workspace-route.test.ts: dedupe-add selects the
	// existing panel, no duplicate) — on the floor the honest e2e leg is:
	// the selected row moves via the panel list and the count never grows.
	const panelRows = page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]');
	await expect(panelRows).toHaveCount(2);
	await panelRows.nth(0).click();
	await expect(page.getByTestId('panel-column').nth(0)).toHaveClass(/selected/);
	// A second add-click of the SAME (still-visible-because-unpaneled third
	// leg is spec 09's) — here pin the invariant: two panels, selection
	// moved, no navigation (URL stays /).
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await expect(page).toHaveURL(/\/$/);
});

test('07 · panel list renders one row per panel; click selects (W4 4.1/4.3-T)', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await openPanelGroup(page);

	// The panel list (above the filter pills, 2026-08-26) mirrors the
	// floor: two rows, ids bound to the panels, the selected one carrying
	// the pinned styling + aria-current.
	const panelRows = page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]');
	await expect(panelRows).toHaveCount(2);
	await expect(panelRows.nth(0)).toHaveAttribute('data-session-id', SECOND_SESSION_ID);
	await expect(panelRows.nth(0)).toHaveAttribute('aria-current', 'page');

	// Click row 1 — selection moves to the SEED panel (no remount: both
	// transcripts stay, only the highlight flips).
	await panelRows.nth(1).click();
	await expect(panelRows.nth(1)).toHaveAttribute('aria-current', 'page');
	await expect(panelRows.nth(0)).not.toHaveAttribute('aria-current', 'page');
	await expect(page.getByTestId('panel-column').nth(1)).toHaveClass(/selected/);
	// Both panels still show their transcripts (select ≠ remount).
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(SECOND_TEXT);
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(STUB_USER_HELLO);
});

test('08 · panel-list close removes only its panel; spine row returns (W4 4.1/4.3-T)', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await openPanelGroup(page);
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(2);

	// Closing panel 2 from the LIST: only that panel goes — sibling keeps
	// its transcript, the selection falls to the remaining panel, and the
	// session reappears in the spine (exclusion is paneled-set-driven).
	await page
		.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')
		.filter({ has: page.getByText('Second panel conversation') })
		.getByTestId('sidebar-panel-close')
		.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(1);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(STUB_USER_HELLO);
	await expect(
		page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]').nth(0)
	).toHaveAttribute('aria-current', 'page');
	const back = page.locator(
		`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`
	);
	await expect(back).toBeVisible({ timeout: 6_000 });
});

test('09 · Shift+click replaces the SELECTED panel only — sibling scroll unchanged (W4 4.3-T)', async ({ page }) => {
	await addSecondSession();
	await addThirdSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await openPanelGroup(page);

	// Select the SEED panel (the list's SECOND row — the added panel
	// joined at the head, before the focused seed) via the panel list —
	// the replace below must
	// then target the seed panel, not the last-clicked added panel.
	await page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]').nth(1).click();
	await expect(page.getByTestId('panel-column').nth(1)).toHaveClass(/selected/);

	// Replace source: the THIRD session's spine row (own ledger; the
	// paneled sessions' rows are spine-excluded in W4).
	const thirdRow = page.locator(
		`[data-testid="sidebar-session-card"][href*="${THIRD_SESSION_ID}"]`
	);
	await expect(thirdRow).toBeVisible({ timeout: 6_000 });

	// Sibling fingerprint (remount locality, commitment 6): the ADDED
	// panel's transcript geometry + content must not move when the seed
	// panel is replaced.
	const sibling = page.getByTestId('transcript').nth(0);
	const fingerprint = await sibling.evaluate((el) => ({
		st: el.scrollTop,
		sh: el.scrollHeight,
		ch: el.clientHeight,
		len: el.innerHTML.length
	}));

	// Shift+click the third row: the SELECTED panel (the seed, nth(1))
	// swaps its session; the sibling (the added panel, nth(0)) is untouched.
	await thirdRow.click({ modifiers: ['Shift'] });
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(THIRD_TEXT, {
		timeout: 10_000
	});
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(SECOND_TEXT);
	const after = await sibling.evaluate((el) => ({
		st: el.scrollTop,
		sh: el.scrollHeight,
		ch: el.clientHeight,
		len: el.innerHTML.length
	}));
	expect(after).toEqual(fingerprint);
});

test('10 · paneled sessions are excluded from the spine (W4 4.3/4.3-T)', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	await openPanelGroup(page);

	// Before: both the stub's own blank row and the second session sit in
	// the spine (the seeded panel's session is paneled → already hidden;
	// panel list carries it instead).
	await expect(
		page.locator(`[data-testid="sidebar-session-card"][href*="${STUB_SESSION_ID}"]`)
	).toHaveCount(0);
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(1);
	await expect(
		page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]').nth(0)
	).toHaveAttribute('data-session-id', STUB_SESSION_ID);

	// Plain-click the second session → its spine row leaves the spine and
	// its panel row joins the list.
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(2);
	await expect(
		page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`)
	).toHaveCount(0);

	// The list follows removes too: close panel 2 → its row returns to the
	// spine, panel count drops to 1.
	await page
		.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')
		.filter({ has: page.getByText('Second panel conversation') })
		.getByTestId('sidebar-panel-close')
		.click();
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(1);
	await expect(
		page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`)
	).toBeVisible({ timeout: 6_000 });
});

// ── Panel-group collapse (2026-08-26): default, title, persistence ──

test('19 · panel group ships expanded; title tracks selection; the choice survives reload', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	// Default: EXPANDED (2026-09-18; collapsed before) — rows visible,
	// honest aria; the title carries the floor's focus (the seed session
	// is the selected panel).
	const toggle = page.getByTestId('sidebar-panel-group-toggle');
	await expect(toggle).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(1);
	await expect(page.getByTestId('sidebar-panel-group-title')).toHaveText('Focused - E2E stub conversation');

	// Collapse → header-only, and the title STILL tracks the focus.
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(0);
	await expect(page.getByTestId('sidebar-panel-group-title')).toHaveText('Focused - E2E stub conversation');

	// Re-expand, then plain-click the second session → the new panel is
	// SELECTED → the title follows the focused panel.
	await toggle.click();
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(1);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await expect(page.getByTestId('sidebar-panel-group-title')).toHaveText('Focused - Second panel conversation');

	// Collapse again → header-only, title still tracking.
	await toggle.click();
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(0);
	await expect(page.getByTestId('sidebar-panel-group-title')).toHaveText('Focused - Second panel conversation');

	// Re-expand, then HARD RELOAD — the desk's choice (expanded), the
	// restored panels + selection, and the title all survive together.
	await toggle.click();
	await page.reload();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]')).toHaveCount(2);
	await expect(page.getByTestId('sidebar-panel-group-title')).toHaveText('Focused - Second panel conversation');
});

// ── FloatingAnchor per-panel anchoring (2026-08-24 fix, OCI parity) ──

test('15 · N panels → N FloatingAnchors, one at each panel\'s own right-middle', async ({ page }) => {
	await addSecondSession();
	await addThirdSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	// Open two more panels: three columns on the floor.
	const secondRow = page.locator(
		`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`
	);
	await expect(secondRow).toBeVisible({ timeout: 10_000 });
	await secondRow.click();
	const thirdRow = page.locator(
		`[data-testid="sidebar-session-card"][href*="${THIRD_SESSION_ID}"]`
	);
	await expect(thirdRow).toBeVisible({ timeout: 10_000 });
	await thirdRow.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(3);

	// The bug: every panel's stack was `fixed right-2 top-1/2` — all three
	// piled onto the VIEWPORT's right-middle (identical rects, over the
	// rightmost panel). The fix (OCI Floating Host): each panel's stack is
	// absolute inside its own `relative` panel root — right-middle of EACH
	// panel column.
	await expect(page.getByTestId('floating-anchor')).toHaveCount(3);

	const columns = page.getByTestId('panel-column');
	const boxes: Array<{ col: { x: number; y: number; width: number; height: number }; anchor: { x: number; y: number; width: number; height: number } }> = [];
	for (let i = 0; i < 3; i++) {
		const colBox = (await columns.nth(i).boundingBox())!;
		// The anchor INSIDE this column (scoped locator, not the global one).
		const anchorBox = (await columns.nth(i).getByTestId('floating-anchor').boundingBox())!;
		boxes.push({ col: colBox, anchor: anchorBox });
	}

	for (const { col, anchor } of boxes) {
		// Horizontally inside the column, hugging ITS right edge.
		expect(anchor.x).toBeGreaterThanOrEqual(col.x);
		expect(anchor.x + anchor.width).toBeLessThanOrEqual(col.x + col.width + 1);
		expect(col.x + col.width - (anchor.x + anchor.width)).toBeLessThan(40);
		// Vertically centered on the panel root (column center ± half a
		// header height — the panel root sits under the PanelHeader).
		const anchorMid = anchor.y + anchor.height / 2;
		const colMid = col.y + col.height / 2;
		expect(Math.abs(anchorMid - colMid)).toBeLessThan(40);
	}

	// Distinct, non-overlapping: the three stacks must not share a pixel
	// column (the bug rendered all three at one identical viewport spot).
	for (let a = 0; a < boxes.length; a++) {
		for (let b = a + 1; b < boxes.length; b++) {
			const A = boxes[a].anchor;
			const B = boxes[b].anchor;
			const overlap =
				A.x < B.x + B.width && B.x < A.x + A.width && A.y < B.y + B.height && B.y < A.y + A.height;
			expect(overlap).toBe(false);
		}
	}
});

// ── W5 task 5.3-T — ControlBar, resize math, zoom frame (specs 11–14) ──

/** Read a column's committed width (style.width, the floor's own truth). */
async function columnWidth(loc: import('@playwright/test').Locator): Promise<number> {
	const raw = await loc.evaluate((el) => (el as HTMLElement).style.width);
	return Number(raw.replace('px', '')) || 0;
}

/** Open the ControlBar tray (click the gear) and wait for the tray body. */
async function openTray(page: import('@playwright/test').Page): Promise<void> {
	await page.getByTestId('controlbar-trigger').click();
	await page.getByTestId('controlbar-tray').waitFor({ state: 'visible' });
}

test('11 · gutter drag resizes ONLY its own panel — the neighbor keeps its width (2026-08-28)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const columns = page.getByTestId('panel-column');
	await expect(columns).toHaveCount(1);

	// Two panels: seed + plain-click the second session.
	await addSecondSession();
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(columns).toHaveCount(2);

	// Grab the two columns' committed widths, then drag panel 0's gutter
	// +60px: panel 0 grows by the drag; panel 1 KEEPS its width
	// (individual resize — one panel's value never moves another's).
	const c0 = columns.nth(0);
	const c1 = columns.nth(1);
	const w0 = await columnWidth(c0);
	const w1 = await columnWidth(c1);
	const gutter = page.getByTestId('panel-gutter-0');
	const box = await gutter.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.mouse.down();
	await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2, { steps: 6 });
	await page.mouse.up();

	const n0 = await columnWidth(c0);
	const n1 = await columnWidth(c1);
	// The dragged panel grew the full drag; the neighbor is UNCHANGED.
	expect(n0 - w0).toBe(60);
	expect(n1).toBe(w1);
	// Persists (refresh keeps the dragged geometry).
	await page.reload();
	await expect(columns).toHaveCount(2);
	expect(await columnWidth(page.getByTestId('panel-column').nth(0))).toBe(n0);
	expect(await columnWidth(page.getByTestId('panel-column').nth(1))).toBe(n1);
});

test('12 · width slider sets ALL panels + the preset (W5 5.3-T)', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	await openTray(page);
	const slider = page.getByTestId('controlbar-slider-width-input');
	// Commit a uniform 600px row via the slider (fill fires input — the
	// realtime commit channel, no release needed).
	await slider.fill('600');
	await expect(page.getByTestId('controlbar-slider-width-value')).toHaveText('600px');
	const columns = page.getByTestId('panel-column');
	expect(await columnWidth(columns.nth(0))).toBe(600);
	expect(await columnWidth(columns.nth(1))).toBe(600);
	// The preset persisted — a NEW panel is born at the slider's width.
	const third = page.locator(
		`[data-testid="sidebar-session-card"][href*="${THIRD_SESSION_ID}"]`
	);
	await addThirdSession();
	await expect(third).toBeVisible({ timeout: 10_000 });
	await third.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(3);
	expect(await columnWidth(page.getByTestId('panel-column').nth(2))).toBe(600);
});

test('13 · zoom 0.9 shows no phantom scrollbar (W5 5.3-T)', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	await openTray(page);
	// A row that VISUALLY fits at 0.9: two 500px columns ≈ 1006px natural
	// → ~905px visual. Under the 400px-default sidebar the viewport is
	// only ~880 — below the slider's own 480px-per-panel MINIMUM (2×480
	// = 980 natural → 882 > 880) — so the row can never honestly fit
	// beside an expanded rail. The spec's premise is the FRAME math, not
	// the rail: collapse the sidebar and the ~1246px viewport makes the
	// 905px visual row an honest fit (W0 net fix 2026-10-09).
	await page.getByRole('button', { name: 'Collapse sidebar' }).click();
	const widthSlider = page.getByTestId('controlbar-slider-width-input');
	await widthSlider.fill('500'); // fill fires input — the realtime commit
	const slider = page.getByTestId('controlbar-slider-zoom-input');
	await slider.fill('0.9');
	// Give the measure rAF a beat, then assert the two-layer frame contract:
	// frame layout width = row natural width × zoom, so a row that VISUALLY
	// fits reports a fitting layout width — no phantom h-scrollbar.
	await page.waitForTimeout(250);
	const metrics = await page.getByTestId('panels-viewport').evaluate((el) => {
		const vp = el as HTMLElement;
		const frame = vp.querySelector('[data-testid="panels-zoom-frame"]') as HTMLElement | null;
		const row = vp.querySelector('[data-testid="panels-row"]') as HTMLElement | null;
		return {
			clientWidth: vp.clientWidth,
			scrollWidth: vp.scrollWidth,
			frameWidth: frame?.offsetWidth ?? -1,
			rowNatural: row?.scrollWidth ?? -1,
			hasHScrollbar: vp.scrollWidth > vp.clientWidth
		};
	});
	expect(metrics.frameWidth).toBeGreaterThan(0);
	expect(Math.abs(metrics.frameWidth - Math.round(metrics.rowNatural * 0.9))).toBeLessThanOrEqual(2);
	// Phantom-scrollbar contract: visually fitting ⇒ no h-scrollbar. (The
	// raw unscaled rowNatural > clientWidth would phantom without the frame.)
	expect(metrics.rowNatural * 0.9).toBeLessThanOrEqual(metrics.clientWidth);
	expect(metrics.hasHScrollbar).toBe(false);
	await expect(page.getByTestId('controlbar-slider-zoom-value')).toHaveText('90%');
	// Zoom persisted.
	await page.reload();
	await page.getByTestId('controlbar-trigger').click();
	await page.getByTestId('controlbar-tray').waitFor({ state: 'visible' });
	await expect(page.getByTestId('controlbar-slider-zoom-value')).toHaveText('90%');
});

test('14 · paste-add adds + selects (W5 5.3-T)', async ({ page }) => {
	await addSecondSession();
	await addThirdSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	await openTray(page);
	await page.getByTestId('controlbar-add-input').fill(SECOND_SESSION_ID);
	await page.getByTestId('controlbar-add-submit').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	// Added → selected, joining before the focused seed (the front — the
	// new panel carries the selected ring at nth(0)).
	await expect(page.getByTestId('panel-column').nth(0)).toHaveClass(/selected/);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(SECOND_TEXT, {
		timeout: 10_000
	});
	// Whitespace-trimmed paste still lands: '  id  ' → added + selected.
	await page.getByTestId('controlbar-add-input').fill(`  ${THIRD_SESSION_ID}  `);
	await page.getByTestId('controlbar-add-submit').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(3);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(THIRD_TEXT, {
		timeout: 10_000
	});
	// Paste-add of a session the host does NOT know: the panel opens and
	// renders the honest error card (commitment 7 — never a silent no-op).
	await page.getByTestId('controlbar-add-input').fill('no-such-session-on-host');
	await page.getByTestId('controlbar-add-submit').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(4);
	await expect(page.getByTestId('panel-column').nth(0).getByTestId('panel-error')).toBeVisible({
		timeout: 10_000
	});
});

test('20 · paste-replace (Rplc) swaps the ACTIVE panel — count and slot survive', async ({
	page
}) => {
	await addSecondSession();
	await addThirdSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	await openTray(page);
	// Paste-add the second session → two panels; the newcomer auto-selects,
	// so it is the ACTIVE panel the Rplc below addresses.
	await page.getByTestId('controlbar-add-input').fill(SECOND_SESSION_ID);
	await page.getByTestId('controlbar-add-submit').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// Whitespace-only Rplc is a no-op — no swap, no count change.
	await page.getByTestId('controlbar-add-input').fill('   ');
	await page.getByTestId('controlbar-replace-submit').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// The swap: the ACTIVE panel (nth(0)) becomes the third session IN
	// PLACE — count stays 2 and the sibling (nth(1), the seed stub) is
	// untouched; the newcomer takes the selection.
	await page.getByTestId('controlbar-add-input').fill(THIRD_SESSION_ID);
	await page.getByTestId('controlbar-replace-submit').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(THIRD_TEXT, {
		timeout: 10_000
	});
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(STUB_USER_HELLO, {
		timeout: 10_000
	});
	await expect(page.getByTestId('panel-column').nth(0)).toHaveClass(/selected/);
});

/** Three live panels on the floor: [third, second, stub] (consecutive
 *  adds stack at the focus slot — each add selects the fresh panel),
 *  stub selected. */
async function openThreePanels(page: import('@playwright/test').Page): Promise<void> {
	await addSecondSession();
	await addThirdSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	for (const sessionId of [SECOND_SESSION_ID, THIRD_SESSION_ID]) {
		const row = page.locator(`[data-testid="sidebar-session-card"][href*="${sessionId}"]`);
		await expect(row).toBeVisible({ timeout: 10_000 });
		await row.click();
	}
	await expect(page.getByTestId('panel-column')).toHaveCount(3);
	await openPanelGroup(page);
	// Select the SEED panel (the list's LAST row — the adds stacked
	// newest-first at the head) via its sidebar row — the move below must
	// carry THIS
	// panel, not the last-added one.
	const rows = page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]');
	await rows.nth(2).click();
	await expect(page.getByTestId('panel-column').nth(2)).toHaveClass(/selected/);
}

test('16 · header chevrons move a panel; the ACTIVE panel follows (order persists)', async ({ page }) => {
	await openThreePanels(page);
	// Runtime-added panels heal their workspace chip from the spine — the
	// dual fetch carries no session row (workspace chip fix, 2026-08-25).
	// The seed rides the TAIL (consecutive adds stack newest-first at the
	// head).
	const wsChip = page.getByTestId('panel-column').nth(2).getByTestId('session-workspace');
	await expect(wsChip).toBeVisible();
	await expect(wsChip).toHaveAttribute('title', '/tmp');
	// Edge gating: first column has no left chevron, last none right.
	await expect(page.getByTestId('panel-column').nth(0).getByTestId('panel-move-left')).toHaveCount(0);
	await expect(page.getByTestId('panel-column').nth(2).getByTestId('panel-move-right')).toHaveCount(0);

	// [third, second, stub], stub active (right) → move stub LEFT:
	// [third, stub, second], stub active (middle) — the mirrored example.
	await page.getByTestId('panel-column').nth(2).getByTestId('panel-move-left').click();
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(THIRD_TEXT);
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(STUB_USER_HELLO);
	await expect(page.getByTestId('panel-column').nth(2)).toContainText(SECOND_TEXT);
	// The ACTIVE panel followed the move — selected ring on the middle column.
	await expect(page.getByTestId('panel-column').nth(1)).toHaveClass(/selected/);

	// Sidebar rows mirror the floor order (the list IS the floor order).
	const rows = page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]');
	await expect(rows.nth(0)).toHaveAttribute('data-session-id', THIRD_SESSION_ID);
	await expect(rows.nth(1)).toHaveAttribute('data-session-id', STUB_SESSION_ID);
	await expect(rows.nth(2)).toHaveAttribute('data-session-id', SECOND_SESSION_ID);

	// The moved order + selection persist across a refresh (localStorage truth).
	await page.reload();
	await expect(page.getByTestId('panel-column')).toHaveCount(3);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(THIRD_TEXT);
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(STUB_USER_HELLO);
	await expect(page.getByTestId('panel-column').nth(1)).toHaveClass(/selected/);
});

test('17 · sidebar move up/down reorder the floor; edges hide their buttons', async ({ page }) => {
	await openThreePanels(page);
	const rows = page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]');

	// Edge gating: first row has no up, last none down; the middle has both.
	await expect(rows.nth(0).getByTestId('sidebar-panel-move-up')).toHaveCount(0);
	await expect(rows.nth(2).getByTestId('sidebar-panel-move-down')).toHaveCount(0);
	await expect(rows.nth(1).getByTestId('sidebar-panel-move-up')).toHaveCount(1);

	// Last row (stub) moves UP: [third, stub, second] on the floor.
	await rows.nth(2).getByTestId('sidebar-panel-move-up').click();
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(THIRD_TEXT);
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(STUB_USER_HELLO);
	await expect(page.getByTestId('panel-column').nth(2)).toContainText(SECOND_TEXT);

	// First row (third) moves DOWN: [stub, third, second] — and the ACTIVE
	// panel (stub, selected in openThreePanels) is still selected, now first.
	await rows.nth(0).getByTestId('sidebar-panel-move-down').click();
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(STUB_USER_HELLO);
	await expect(page.getByTestId('panel-column').nth(0)).toHaveClass(/selected/);
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(THIRD_TEXT);
	await expect(page.getByTestId('panel-column').nth(2)).toContainText(SECOND_TEXT);
	// The sidebar's current highlight follows the same row.
	await expect(rows.nth(0)).toHaveAttribute('data-session-id', STUB_SESSION_ID);
	await expect(rows.nth(0)).toHaveAttribute('aria-current', 'page');
});

test('18 · interacting with a conversation selects its panel (sidebar follows)', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await openPanelGroup(page);

	// Add selects the NEW panel — it joined before the focused seed, so
	// the FRONT one. Baseline: its row is current.
	const panelRows = page.locator('[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"]');
	await expect(panelRows.nth(0)).toHaveAttribute('aria-current', 'page');
	await expect(page.getByTestId('panel-column').nth(0)).toHaveClass(/selected/);

	// Click INTO the SEED panel's prompt (nth(1) — a conversation
	// interaction, not a sidebar/list click) — selection moves to it, the
	// sidebar row highlight follows, and nothing remounts (both
	// transcripts stay).
	await page.getByTestId('prompt-textarea').nth(1).click();
	await expect(panelRows.nth(1)).toHaveAttribute('aria-current', 'page');
	await expect(panelRows.nth(0)).not.toHaveAttribute('aria-current', 'page');
	await expect(page.getByTestId('panel-column').nth(1)).toHaveClass(/selected/);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(SECOND_TEXT);
	await expect(page.getByTestId('panel-column').nth(1)).toContainText(STUB_USER_HELLO);

	// Keyboard focus lands in the ADDED panel's textarea (nth(0)) —
	// focusin selects it too (tab-only interaction, no pointer at all).
	await page.getByTestId('prompt-textarea').nth(0).focus();
	await expect(panelRows.nth(0)).toHaveAttribute('aria-current', 'page');
	await expect(page.getByTestId('panel-column').nth(0)).toHaveClass(/selected/);
});

test('19 · gutter drag shows live width badges on the changed panels; Shift+drag badges ALL; afterglow fades (2026-08-28)', async ({ page }) => {
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	const columns = page.getByTestId('panel-column');
	await expect(columns).toHaveCount(2);
	// A THIRD panel: its width stays untouched by a plain gutter-0 drag —
	// the badge's changed-from-snapshot membership keeps it clean.
	await addThirdSession();
	const third = page.locator(`[data-testid="sidebar-session-card"][href*="${THIRD_SESSION_ID}"]`);
	await expect(third).toBeVisible({ timeout: 10_000 });
	await third.click();
	await expect(columns).toHaveCount(3);

	// ── Plain drag on panel 0's gutter: ONLY panel 0 changes → it alone
	//    badges, live, with the honest current width as text.
	const gutter = page.getByTestId('panel-gutter-0');
	const box = await gutter.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await page.mouse.down();
	await page.mouse.move(box!.x + box!.width / 2 - 60, box!.y + box!.height / 2, { steps: 6 });
	const b0 = columns.nth(0).locator('[data-testid="panel-width-badge"]');
	const b1 = columns.nth(1).locator('[data-testid="panel-width-badge"]');
	await expect(b0).toHaveAttribute('data-badge-phase', 'live');
	// Individual resize: the neighbors keep their values — no badge.
	await expect(b1).toHaveCount(0);
	await expect(columns.nth(2).locator('[data-testid="panel-width-badge"]')).toHaveCount(0);
	// Badge text = the column's committed width (self-consistent readout;
	// rounded — Shift-drag's proportional math carries fractional px).
	expect(await b0.textContent()).toBe(`${Math.round(await columnWidth(columns.nth(0)))}px`);

	// ── Release: afterglow — the badge STAYS (fading phase), never vanishes at mouseup.
	await page.mouse.up();
	await expect(b0).toHaveAttribute('data-badge-phase', 'fading');
	await expect(b1).toHaveCount(0);
	await expect(b0).toBeVisible();

	// ── Shift+drag: proportional scaling moves EVERY panel → every
	//    column carries a live badge (the operator's Shift+drag ask).
	const box2 = await gutter.boundingBox();
	await page.keyboard.down('Shift');
	await page.mouse.move(box2!.x + box2!.width / 2, box2!.y + box2!.height / 2);
	await page.mouse.down();
	await page.mouse.move(box2!.x + box2!.width / 2 + 40, box2!.y + box2!.height / 2, { steps: 4 });
	await page.keyboard.up('Shift');
	// ALL THREE columns badged live (membership = width left the snapshot).
	const b2 = columns.nth(2).locator('[data-testid="panel-width-badge"]');
	await expect(b0).toHaveAttribute('data-badge-phase', 'live');
	await expect(b1).toHaveAttribute('data-badge-phase', 'live');
	await expect(b2).toHaveAttribute('data-badge-phase', 'live');
	expect(await b0.textContent()).toBe(`${Math.round(await columnWidth(columns.nth(0)))}px`);
	expect(await b1.textContent()).toBe(`${Math.round(await columnWidth(columns.nth(1)))}px`);
	expect(await b2.textContent()).toBe(`${Math.round(await columnWidth(columns.nth(2)))}px`);
	await page.mouse.up();
	await expect(b0).toHaveAttribute('data-badge-phase', 'fading');
});

// ── Tray buttons row (2026-09-02): the tray's action-buttons container ──

test('21 · tray buttons row mounts the floor canvas-capture button', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openTray(page);
	const row = page.getByTestId('controlbar-tray-buttons');
	await expect(row).toBeVisible();
	// The floor capture: the copy target is the floor (PanelsZoom's slot),
	// not the whole page — the title is the user-facing contract.
	await expect(row.getByTestId('canvas-copy-button')).toHaveAttribute(
		'title',
		'Copy panel floor as image (Shift+Click to save)'
	);
	// The capture button hugs the row's right edge (2026-09-07).
	const rowBox = await row.boundingBox();
	const btnBox = await row.getByTestId('canvas-copy-button').boundingBox();
	expect(
		Math.abs((rowBox!.x + rowBox!.width) - (btnBox!.x + btnBox!.width))
	).toBeLessThanOrEqual(2);
});

test('22 · panel group caps at half the body column; the rows scroll internally', async ({
	page
}) => {
	// The 2026-09-02 extraction moved the HALF-COLUMN cap onto the rows
	// wrapper — whose ancestors are all content-sized, so the percentage
	// max-height computed to `none`: the group grew unbounded and nothing
	// scrolled. The honest geometry with enough rows to overflow half the
	// column: the PANE obeys the cap, .panel-container is the scroll
	// container, and the group header stays pinned above it.
	const extras = Array.from({ length: 14 }, (_, i) => ({
		sessionId: `e2e-panel-session-overflow-${String(i + 1).padStart(2, '0')}`,
		title: `Overflow session ${i + 1}`,
		agentPreset: null,
		cwd: '/tmp',
		ledger: [
			{
				event: {
					type: 'user/message',
					seq: 2,
					time: Date.now(),
					data: {
						content: [{ type: 'text', text: `Overflow session ${i + 1} says hi` }],
						id: `u-overflow-${i + 1}`,
						role: 'user'
					}
				}
			}
		]
	}));
	await stubSet({ extraSessions: extras });
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toContainText(STUB_USER_HELLO);

	// The group's rows are the OPEN panels — put every overflow session on
	// the floor (spine click adds, W4) so the expanded group overflows.
	for (const extra of extras) {
		await page
			.locator(`[data-testid="sidebar-session-card"][href*="${extra.sessionId}"]`)
			.click();
	}
	await openPanelGroup(page);

	// The pane never exceeds half the session body column (+1px rounding).
	const paneBox = await page.getByTestId('sidebar-panel-pane').boundingBox();
	const columnBox = await page.getByTestId('sidebar-sessions').boundingBox();
	expect(paneBox?.height ?? Infinity).toBeLessThanOrEqual((columnBox?.height ?? 0) / 2 + 1);

	// The rows container IS the scroll container: content taller than the
	// box, and a programmatic scroll actually moves.
	const scroll = page.getByTestId('sidebar-panel-rows-scroll');
	const geom = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
	expect(geom.sh).toBeGreaterThan(geom.ch);
	const top = await scroll.evaluate((el) => {
		el.scrollTop = 99999;
		return el.scrollTop;
	});
	expect(top).toBeGreaterThan(0);

	// The pinned header keeps its row above the scrolling rows.
	await expect(page.getByTestId('sidebar-panel-group-toggle')).toBeVisible();
});

test('23 · selecting an off-viewport panel scrolls it into view (selection follow)', async ({
	page
}) => {
	// The floor can be several viewports wide; a selection made from the
	// sidebar (always visible) must bring the focused column into view —
	// the ring sitting off-screen behind the scroll edge is the bug.
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toContainText(STUB_USER_HELLO);
	const row = page.locator(
		`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`
	);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// Widen the row past the viewport: 2 × 860px ≈ double-wide floor
	// (860 is the slider's PANEL_MAX_WIDTH clamp).
	await openTray(page);
	await page.getByTestId('controlbar-slider-width-input').fill('860');
	await expect(page.getByTestId('controlbar-slider-width-value')).toHaveText('860px');
	const vp = page.getByTestId('panels-viewport');
	await expect
		.poll(() => vp.evaluate((el) => el.scrollWidth - el.clientWidth))
		.toBeGreaterThan(400);

	// The sidebar's panel group ships COLLAPSED — the selection rows only
	// exist once the group is expanded.
	await openPanelGroup(page);

	// The added panel sits at the FRONT (visible, selected). Select the
	// SEED panel — column 1, past the right edge — from its sidebar row.
	const seedCol = page.getByTestId('panel-column').nth(1);
	await page
		.locator(`[data-testid="sidebar-panel-pane"] [data-session-id="${STUB_SESSION_ID}"]`)
		.click();
	await expect.poll(() => vp.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
	// The focused column lands fully inside the viewport (+ the 4px ring)
	// — polled through the glide's animation frames.
	await expect
		.poll(() =>
			seedCol.evaluate((col) => {
				const vpr = document
					.querySelector('[data-testid="panels-viewport"]')!
					.getBoundingClientRect();
				const cr = col.getBoundingClientRect();
				return cr.left >= vpr.left - 1 && cr.right <= vpr.right + 9;
			})
		)
		.toBe(true);

	// And back: selecting the front panel reveals to the left, clamped at 0.
	await page
		.locator(`[data-testid="sidebar-panel-pane"] [data-session-id="${SECOND_SESSION_ID}"]`)
		.click();
	await expect.poll(() => vp.evaluate((el) => el.scrollLeft)).toBe(0);
});

test('24 · a move reshuffle re-reveals the focused panel (move up/down)', async ({ page }) => {
	// The move chevrons reorder the floor WITHOUT changing the selection —
	// and a reshuffle can push the focused column past a viewport edge.
	// After the move, the floor must bring focus back into view.
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toContainText(STUB_USER_HELLO);
	const row = page.locator(
		`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`
	);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// Double-wide floor (860 is the slider's PANEL_MAX_WIDTH clamp).
	await openTray(page);
	await page.getByTestId('controlbar-slider-width-input').fill('860');
	await expect(page.getByTestId('controlbar-slider-width-value')).toHaveText('860px');

	// Ensure the panel group is open (expanded by default) and select the SEED panel —
	// column 1, past the right edge. The follow glides it into view.
	await openPanelGroup(page);
	const vp = page.getByTestId('panels-viewport');
	await expect
		.poll(() => vp.evaluate((el) => el.scrollWidth - el.clientWidth))
		.toBeGreaterThan(400);
	await page
		.locator(`[data-testid="sidebar-panel-pane"] [data-session-id="${STUB_SESSION_ID}"]`)
		.click();
	await expect.poll(() => vp.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

	// Move the FOCUSED panel one slot up (its sidebar row's chevron): the
	// reshuffle lands it at the front, off-view LEFT. The follow must
	// return to it — scrollLeft collapses back to the row start.
	await page
		.locator(`[data-testid="sidebar-panel-pane"] [data-session-id="${STUB_SESSION_ID}"]`)
		.getByTestId('sidebar-panel-move-up')
		.click();
	await expect.poll(() => vp.evaluate((el) => el.scrollLeft)).toBe(0);
	// The focused column is fully inside the viewport again (+ the 4px
	// ring), polled through the glide.
	await expect
		.poll(() =>
			page
				.locator(`[data-testid="panel-column"][data-session-id="${STUB_SESSION_ID}"]`)
				.evaluate((col) => {
					const vpr = document
						.querySelector('[data-testid="panels-viewport"]')!
						.getBoundingClientRect();
					const cr = col.getBoundingClientRect();
					return cr.left >= vpr.left - 1 && cr.right <= vpr.right + 9;
				})
		)
		.toBe(true);
});

// ── The Panel Loupe (2026-09-04, ADR D1–D8; modifier + kind scope
//    widened by The Loupe for Every Panel, 2026-09-08): Alt+Click reads
//    one panel at full size; the floor never changes. ──

/** Zoom the floor to its 25% floor via the honest slider (tray opened
 *  and dismissed again — the tray must not intercept the column clicks).
 *  The tray is a HOVER surface (the gear reveals, leaving hides after a
 *  250ms grace): moving the pointer away is the close gesture. */
async function zoomToFloorMinimum(page: import('@playwright/test').Page): Promise<void> {
	await openTray(page);
	await page.getByTestId('controlbar-slider-zoom-input').fill('0.25');
	await expect(page.getByTestId('controlbar-slider-zoom-value')).toHaveText('25%');
	await page.mouse.move(10, 300); // leave the tray — the grace elapses
	await page.getByTestId('controlbar-tray').waitFor({ state: 'hidden' });
}

/** The floor fingerprint the journey pins bit-identical: row scale,
 *  column order + count, and the selected column. */
async function floorFingerprint(page: import('@playwright/test').Page): Promise<{
	scale: string;
	order: Array<string | null>;
	selected: string | null;
}> {
	return page.evaluate(() => {
		const row = document.querySelector('[data-testid="panels-row"]');
		const scale = getComputedStyle(row as Element).transform;
		const columns = [...document.querySelectorAll('[data-testid="panel-column"]')];
		return {
			scale,
			order: columns.map((c) => c.getAttribute('data-session-id')),
			selected: columns.find((c) => c.classList.contains('selected'))?.getAttribute('data-session-id') ?? null
		};
	});
}

test('25 · Alt+Click at the zoom floor opens the loupe; Escape restores the floor bit-identical', async ({
	page
}) => {
	await openThreePanels(page); // [third, second, stub] — stub selected
	await zoomToFloorMinimum(page);
	const before = await floorFingerprint(page);
	expect(before.scale).toContain('0.25'); // the reading problem is real here

	// Alt+Click panel 3's TRANSCRIPT (never a control — the header's
	// Shift+Click keeps its close-only verb, ADR D1). The pointerdown
	// activation selects; the click release opens the lens.
	await page
		.getByTestId('panel-column')
		.nth(2)
		.getByTestId('transcript')
		.click({ modifiers: ['Alt'] });

	const dialog = page.getByTestId('panel-loupe');
	await expect(dialog).toBeVisible();
	// D2: a child of <body>, outside the transformed row — never shrunk.
	// (The comparisons run in the BROWSER — the Node process has no document.)
	expect(await dialog.evaluate((el) => el.parentElement === document.body)).toBe(true);
	expect(await dialog.evaluate((el) => el.closest('[data-testid="panels-row"]') === null)).toBe(
		true
	);
	expect(await dialog.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
	// The lens is a reading surface: the seed transcript renders UNSCALED.
	await expect(dialog.getByTestId('transcript')).toContainText(STUB_USER_HELLO);
	// D6: the same gesture activated the column first — ring stays on it.
	await expect(page.getByTestId('panel-column').nth(2)).toHaveClass(/selected/);
	// The floor kept its zoom through the open.
	expect(await floorFingerprint(page)).toEqual(before);

	// D8: the floor-identity verbs render WHOLE but inert inside the lens.
	await expect(dialog.getByTestId('prompt-sync-check')).toBeVisible();
	await expect(dialog.getByTestId('prompt-sync-check')).toBeDisabled();
	await expect(dialog.getByTestId('fork-button')).toBeVisible();
	await expect(dialog.getByTestId('fork-button')).toBeDisabled();
	await expect(dialog.getByTestId('panel-move-left')).toBeVisible();
	await expect(dialog.getByTestId('panel-move-left')).toBeDisabled();
	await expect(dialog.getByTestId('panel-move-right')).toBeVisible();
	await expect(dialog.getByTestId('panel-move-right')).toBeDisabled();
	await expect(dialog.getByTestId('panel-close')).toBeVisible();
	await expect(dialog.getByTestId('panel-close')).toBeDisabled();
	// The surface verbs stay live: copy-id and the lens's own ×.
	await expect(dialog.getByTestId('panel-header-copy-id')).toBeEnabled();
	await expect(dialog.getByTestId('panel-loupe-close')).toBeEnabled();
	// The FLOOR column's close stays live — the disable is lens-scoped.
	await expect(page.getByTestId('panel-column').nth(2).getByTestId('panel-close')).toBeEnabled();

	// Escape closes; the floor comes back bit-identical (zoom + 3 panels
	// + order + selection).
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	expect(await floorFingerprint(page)).toEqual(before);
	await expect(page.getByTestId('panel-column')).toHaveCount(3);
});

test('26 · the mask closes the lens; the next Alt+Click points it at another panel (the modal repoint path)', async ({
	page
}) => {
	// Reality note (the probe in the completion notes): the loupe is a
	// MODAL — the sheet and mask cover the floor, so a floor Alt+Click
	// while open cannot reach a column. The user-visible repoint is
	// mask-close (D2) then Alt+Click (D1) on the next panel; the
	// while-open state swap itself is route logic, pinned at the unit
	// layer (panel-loupe-wiring.test.ts).
	await openThreePanels(page);
	await zoomToFloorMinimum(page);

	await page
		.getByTestId('panel-column')
		.nth(2)
		.getByTestId('transcript')
		.click({ modifiers: ['Alt'] });
	await expect(page.getByTestId('panel-loupe')).toHaveAttribute(
		'data-session-id',
		STUB_SESSION_ID
	);

	// A press on the mask dismisses the lens (the D2 close path). The
	// sheet covers the mask's center — the press lands on the exposed
	// border margin (the p-10 inset).
	await page.getByTestId('panel-loupe-mask').click({ position: { x: 12, y: 12 } });
	await expect(page.getByTestId('panel-loupe')).toHaveCount(0);

	// Alt+Click panel 2: the lens opens on THAT panel — one at a time.
	await page
		.getByTestId('panel-column')
		.nth(1)
		.getByTestId('transcript')
		.click({ modifiers: ['Alt'] });
	await expect(page.getByTestId('panel-loupe')).toHaveCount(1);
	await expect(page.getByTestId('panel-loupe')).toHaveAttribute(
		'data-session-id',
		SECOND_SESSION_ID
	);
	await expect(page.getByTestId('panel-loupe').getByTestId('transcript')).toContainText(
		SECOND_TEXT
	);
});

test('27 · the lens tracks its panel honestly: closing the louvered panel from inside the lens closes it', async ({
	page
}) => {
	// The modal covers the floor, so the floor's own close is unreachable
	// by pointer while reading. The USER-reachable removal of the
	// louvered panel happens inside the lens: a dead session's error card
	// (the shared ladder) carries its own live Close — and removing the
	// panel the lens reads must close the lens (a lens of nothing renders
	// nothing, the route's clearLoupeIfGone edge).
	await addSecondSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${SECOND_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// Kill the second session on the host, refresh: its panel (the front
	// one) cold-loads into the honest error card (spec 04's machinery).
	await stubSet({ extraSessions: [] });
	await page.reload();
	const dead = page.getByTestId('panel-column').nth(0);
	await expect(dead).toContainText(/not found|unavailable|error/i, { timeout: 10_000 });

	// Zoom to the floor and read the DEAD panel through the lens. (The
	// dead column has no transcript — the error card replaces it — so the
	// trigger is the column itself; the card is not a control.)
	await zoomToFloorMinimum(page);
	await dead.click({ modifiers: ['Alt'] });
	const dialog = page.getByTestId('panel-loupe');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('panel-error')).toBeVisible(); // same card, shared ladder

	// The card's Close (live inside the lens) removes the panel the lens
	// reads → the lens closes with it; the sibling stays on the floor.
	await dialog.getByTestId('panel-error-close').click();
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);
	await expect(page.getByTestId('panel-column').nth(0)).toContainText(STUB_USER_HELLO);
});

// ── The loupe's reading geometry (headed-verified 2026-09-04): the
//    sheet is D2's fixed near-viewport surface, the content FILLS it,
//    the transcript SCROLLS (the body row is the panel's flex parent),
//    and the × hugs the sheet's corner instead of the viewport's. ──

const LONG_SESSION_ID = 'e2e-panel-session-long';
const LONG_MESSAGES = 40;

async function addLongSession(): Promise<void> {
	const ledger = Array.from({ length: LONG_MESSAGES }, (_, i) => ({
		event: {
			type: 'user/message',
			seq: i + 2,
			time: Date.now(),
			data: {
				content: [{ type: 'text', text: `Message ${i + 1} of the long ledger` }],
				id: `u-long-${i + 1}`,
				role: 'user'
			}
		}
	}));
	await stubSet({
		extraSessions: [
			{
				sessionId: LONG_SESSION_ID,
				title: 'Long ledger conversation',
				agentPreset: null,
				cwd: '/tmp',
				ledger
			}
		]
	});
}

test('28 · the loupe reads: content fills the sheet, the transcript scrolls, the × hugs the sheet corner', async ({
	page
}) => {
	await addLongSession();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const row = page.locator(`[data-testid="sidebar-session-card"][href*="${LONG_SESSION_ID}"]`);
	await expect(row).toBeVisible({ timeout: 10_000 });
	await row.click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);
	await zoomToFloorMinimum(page);

	await page
		.getByTestId('panel-column')
		.nth(0)
		.getByTestId('transcript')
		.click({ modifiers: ['Alt'] });
	const dialog = page.getByTestId('panel-loupe');
	await expect(dialog).toBeVisible();

	const sheet = dialog.getByTestId('panel-loupe-sheet');
	const sheetBox = (await sheet.boundingBox())!;
	const closeBox = (await dialog.getByTestId('panel-loupe-close').boundingBox())!;

	// WIDTH: D2's fixed reading sheet — min(100% − 4rem, 850px) at the
	// 1280×720 default viewport → 850 × min(95vh, 100vh − 5rem) = 640
	// (the height caps at the p-10 grid's content box). The content must
	// FILL it: the transcript spans the sheet (no shrink-wrapped dialog,
	// no dead half-empty band — the panel is flex-1 in a flex parent).
	expect(Math.abs(sheetBox.width - 850)).toBeLessThanOrEqual(2);
	expect(Math.abs(sheetBox.height - (720 - 80))).toBeLessThanOrEqual(2);

	// CENTERED: the sheet rides the viewport's center on both axes — a
	// sheet taller than the padded content box start-pins in the p-10
	// grid and stops centering (the 2026-09-07 centering fix).
	expect(Math.abs(sheetBox.x + sheetBox.width / 2 - 640)).toBeLessThanOrEqual(2);
	expect(Math.abs(sheetBox.y + sheetBox.height / 2 - 360)).toBeLessThanOrEqual(2);
	const transcriptBox = (await dialog.getByTestId('transcript').boundingBox())!;
	expect(transcriptBox.width).toBeGreaterThanOrEqual(sheetBox.width - 32);

	// The × hugs the SHEET's corner (−top-3 −right-3), never the
	// viewport's: it stays within a glyph's width of the content on any
	// monitor, instead of drifting to the screen edge.
	expect(Math.abs(closeBox.x + closeBox.width - (sheetBox.x + sheetBox.width))).toBeLessThanOrEqual(24);
	expect(Math.abs(closeBox.y - sheetBox.y)).toBeLessThanOrEqual(24);

	// SCROLLING: 40 messages overflow the sheet; the transcript is
	// the scroll surface (its flex parent bounds it), a real wheel over
	// the content moves it, and the bottom lands in view.
	const transcript = dialog.getByTestId('transcript');
	await expect
		.poll(async () => {
			const box = (await transcript.boundingBox())!;
			return box.height;
		})
		.toBeLessThan(640); // the sheet (640 here) bounds the transcript — no clipping spill
	const geom = await transcript.evaluate((el) => ({
		sh: el.scrollHeight,
		ch: el.clientHeight
	}));
	expect(geom.sh).toBeGreaterThan(geom.ch + 100);
	const tbox = (await transcript.boundingBox())!;
	await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
	await page.mouse.wheel(0, 20_000);
	await expect
		.poll(() => transcript.evaluate((el) => el.scrollTop))
		.toBeGreaterThan(0);
	// The LAST message is on screen: its box sits inside the transcript's.
	const last = dialog.getByText(`Message ${LONG_MESSAGES} of the long ledger`);
	await expect
		.poll(async () => {
			const lr = (await last.boundingBox())!;
			return lr.y + lr.height <= tbox.y + tbox.height + 4 && lr.y >= tbox.y - 4;
		})
		.toBe(true);
});

// ── The Explorer Layout (ADR 2026-09-17 D3, Task 3.2): the floor NEVER
// hosts a workspace-file panel from an explorer-tree click in 'explorer'
// layout. Appended last — the run's disposable DSI_CONFIG_PATH is the
// knob (readers never cache; a rewrite + reload re-seeds), restored to
// the honest 'panels' default at the end.
test('25 · explorer layout never produces a workspace-file floor entry', async ({ page }) => {
	writeFileSync(process.env.DSI_CONFIG_PATH!, 'workspace:\n  layout: explorer\n', 'utf-8');
	try {
		await page.goto('/?sessionKey=' + STUB_SESSION_ID);
		await expect(page.getByTestId('session-workspace').first()).toBeVisible();
		await page.getByTestId('session-workspace').first().click();
		await expect(page.getByTestId('workspace-explorer')).toBeVisible();
		const columnsBefore = await page.getByTestId('panel-column').count();
		await page.getByTestId('tree-file').filter({ hasText: 'README.md' }).click();
		// the file arrives as a TAB inside the explorer…
		await expect(page.getByTestId('workspace-file-tab-README.md')).toBeVisible();
		// …and the floor column count is UNCHANGED — no file slot exists.
		expect(await page.getByTestId('panel-column').count()).toBe(columnsBefore);
	} finally {
		writeFileSync(process.env.DSI_CONFIG_PATH!, 'workspace:\n  layout: panels\n', 'utf-8');
	}
});

// ── The Chord Palette (ADR-0006a amendment, 2026-10-31) ────────────────
// Spec 30 pins the capture-first grammar on the REAL surface: Alt+S in the
// composer arms (no sharp-s lands), the palette shows, the armed next key
// is consumed from the composer, and the toggle verb opens a panel.
test('30 · Alt+S arms from the composer: palette shows, nothing typed, armed next key consumed', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toContainText(STUB_USER_HELLO);
	const box = page.getByTestId('prompt-textarea');
	await box.click();

	// D12: the Alt+S keydown is preventDefaulted — no sharp-s in the draft.
	await page.keyboard.press('Alt+s');
	await expect(page.getByTestId('chord-palette')).toBeVisible();
	await expect(box).toHaveValue('');

	// D13/D15: the armed p toggles the prompt-manager right out of the composer.
	await page.keyboard.press('p');
	await expect(page.getByTestId('chord-palette')).toBeHidden();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// Old AC4 survives: an UN-ARMED digit in the composer just types.
	await box.click();
	await page.keyboard.type('1');
	await expect(box).toHaveValue('1');

	// D14/D15: b with zero glass panels is a silent no-op (palette disarms).
	await page.keyboard.press('Alt+s');
	await expect(page.getByTestId('chord-palette')).toBeVisible();
	await page.keyboard.press('b');
	await expect(page.getByTestId('chord-palette')).toBeHidden();
});

// Spec 31 (round 2, ADR-0006a extension 2): D17 capture phase + D18 decay.
test('31 · capture-phase chord beats a swallowing leaf; palette centered with decay clock', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toContainText(STUB_USER_HELLO);
	const box = page.getByTestId('prompt-textarea');
	await box.click();

	// A leaf that stops propagation — the xterm class of surface (D17).
	await page.evaluate(() => {
		const thief = document.createElement('input');
		thief.id = 'chord-key-thief';
		thief.style.position = 'fixed';
		thief.style.top = '10px';
		thief.style.left = '10px';
		thief.style.zIndex = '9999';
		thief.addEventListener('keydown', (e) => e.stopPropagation());
		document.body.appendChild(thief);
	});
	await page.locator('#chord-key-thief').click();

	// Alt+S arms; the human 1s pause; then t — the leaf must NOT eat it.
	await page.keyboard.press('Alt+s');
	await expect(page.getByTestId('chord-palette')).toBeVisible();
	await page.waitForTimeout(1000);
	await page.keyboard.press('p'); // toggle verb: opens the prompt-manager
	await expect(page.getByTestId('chord-palette')).toBeHidden();
	await expect(page.getByTestId('panel-column')).toHaveCount(2);

	// D16 revision: the palette renders CENTERED on the viewport.
	await box.click();
	await page.keyboard.press('Alt+s');
	const pal = page.getByTestId('chord-palette');
	await expect(pal).toBeVisible();
	const centered = await pal.evaluate((el) => {
		const r = el.getBoundingClientRect();
		return {
			dx: Math.abs(r.left + r.width / 2 - window.innerWidth / 2),
			dy: Math.abs(r.top + r.height / 2 - window.innerHeight / 2)
		};
	});
	expect(centered.dx).toBeLessThan(2);
	expect(centered.dy).toBeLessThan(2);

	// D18: the decay bar starts in the action phase (pastel-green).
	await expect(pal.getByTestId('chord-palette-progress')).toHaveAttribute('data-chord-phase', 'action');
	await page.keyboard.press('Escape'); // any non-verb key disarms cleanly
	await expect(pal).toBeHidden();
});

// Spec 32 (round 3, ADR-0006a extension 3): D19 sidebar toggle + D20 sibling spawn.
test('32 · chord s toggles the sidebar; chord n spawns a sibling session below the focused panel', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toContainText(STUB_USER_HELLO);
	const box = page.getByTestId('prompt-textarea');
	await box.click();

	// D19: s flips the sidebar and the palette lists it always. Collapse
	// UNMOUNTS the rail (the house toggle), so absence IS the collapsed proof.
	await expect(page.getByTestId('app-sidebar')).toBeVisible();
	await page.keyboard.press('Alt+s');
	await expect(page.getByTestId('chord-palette')).toBeVisible();
	await page.keyboard.press('s');
	await expect(page.getByTestId('chord-palette')).toBeHidden();
	await expect(page.getByTestId('app-sidebar')).toBeHidden();

	// D20: n spawns a sibling session BELOW the focused panel.
	await box.click();
	await page.keyboard.press('Alt+s');
	await expect(page.getByTestId('chord-palette')).toBeVisible();
	// No presets in the stub → lanes are p t n s; n is live (conversation focused).
	await expect(page.getByTestId('chord-palette').getByTestId('chord-palette-row')).toHaveCount(4);
	await expect(
		page.getByTestId('chord-palette').locator('[data-chord-key="n"]')
	).toBeVisible();
	await page.keyboard.press('n');
	await expect(page.getByTestId('panel-column')).toHaveCount(2, { timeout: 15000 });
});
