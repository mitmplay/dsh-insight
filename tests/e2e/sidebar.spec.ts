/**
 * E2E: the conversation page's app sidebar (OCI ControlRail port,
 * 2026-08-23) — same stub-host setup as conversation.spec.ts, no live
 * dsh web needed.
 *
 * Contract under test:
 *   1. sidebar renders with the "Deepseek Insight" title and the sessions
 *      list from the stubbed wire (current session highlighted)
 *   2. the Home anchor is retired (Root-is-the-Floor ADR, 2026-09-02) —
 *      neither the expanded rail nor the collapsed stub carries one, and
 *      the old "← Sessions" header anchor stays gone
 *   3. collapse → 34px stub → expand round-trip, persisted across reload
 *   4. drag-resize via the gutter, clamped to [200, 500]
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID, STUB_USER_HELLO } from './dsh-stub';
import { STUB_BLANK_CWD, STUB_BLANK_SESSION_ID, STUB_ADOPT_DIR } from './dsh-stub';

const STUB_PORT = 4590;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

async function railWidth(page: import('@playwright/test').Page): Promise<number> {
	const box = await page.getByTestId('app-sidebar').boundingBox();
	return Math.round(box?.width ?? -1);
}

/** Ensure the filter pills are visible (2026-09-18): expanded is the
 *  load default — click the toggle only when the row ships folded. */
async function expandFilters(page: import('@playwright/test').Page): Promise<void> {
	const toggle = page.getByTestId('filter-toggle');
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
	await expect(page.getByTestId('filter-all')).toBeVisible();
}

/** Ensure the pinned-panel group is open (2026-09-18): expanded is the
 *  load default — the rows (including the selected row carrying the
 *  legacy `sidebar-session-current` testid) render unconditionally;
 *  click the toggle only when the group ships folded. */
async function openPanelGroup(page: import('@playwright/test').Page): Promise<void> {
	const toggle = page.getByTestId('sidebar-panel-group-toggle');
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

/** Default FOLDED (2026-08-28): children ship hidden — unfold the root
 *  family (the lineage specs' single-root standard prelude). */
async function revealChildren(page: import('@playwright/test').Page): Promise<void> {
	await page.getByTestId('sidebar-panel-fold').first().click();
}

test('01 · sidebar renders with title and sessions — the Home anchor is retired', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);

	const rail = page.getByTestId('app-sidebar');
	await expect(rail).toBeVisible();
	await expect(page.getByTestId('sidebar-title')).toHaveText('Deepseek Insight');

	// The version chip rides the footer's create row (2026-09-07): the
	// running edition reads where new chats start. ONE chip, TWO lines
	// (RCA 2026-09-14): DSI's own edition above the pinned DSH web
	// release it speaks — each line semver-shaped.
	const SEMVER = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
	const versionLines = await page.getByTestId('sidebar-footer-version').locator('span').allTextContents();
	expect(versionLines).toHaveLength(2);
	for (const line of versionLines) expect(line).toMatch(SEMVER);

	// Sessions list loads from the stubbed wire; the open session is the
	// highlighted current row (non-link — clicking where you already are).
	// The row lives in the pinned-panel group — open on load since 2026-09-18.
	await openPanelGroup(page);
	await expect(page.getByTestId('sidebar-session-current')).toBeVisible();
	await expect(page.getByTestId('sidebar-session-current')).toHaveAttribute('aria-current', 'page');
	await expect(page.getByTestId('sidebar-session-current')).toContainText('E2E stub conversation');

	// The Home anchor retired with the homepage (Root-is-the-Floor ADR,
	// 2026-09-02): the spine IS the session list, and `/` is the floor
	// itself — no separate door to point back at.
	await expect(page.getByTestId('back-to-sessions')).toHaveCount(0);

	// The old header anchor stays gone — no "← Sessions" text anywhere.
	await expect(page.getByText('← Sessions')).toHaveCount(0);
});

test('02 · collapse → stub → expand round-trip, persisted across reload', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	// Collapse: expanded rail unmounts, the 34px stub mounts.
	await page.locator('button[title="Collapse sidebar"]').click();
	await expect(page.getByTestId('app-sidebar-collapsed')).toBeVisible();
	await expect(page.getByTestId('app-sidebar')).toHaveCount(0);

	// The stub carries no Home anchor either (retired with the homepage).
	await expect(
		page.getByTestId('app-sidebar-collapsed').getByTestId('back-to-sessions')
	).toHaveCount(0);

	// Persisted: a reload restores the collapsed stub.
	await page.reload();
	await expect(page.getByTestId('app-sidebar-collapsed')).toBeVisible();

	// Expand from the stub: the rail returns with its title.
	await page.locator('button[title="Expand sidebar"]').click();
	await expect(page.getByTestId('app-sidebar')).toBeVisible();
	await expect(page.getByTestId('sidebar-title')).toHaveText('Deepseek Insight');

	// Expanded state persists too.
	await page.reload();
	await expect(page.getByTestId('app-sidebar')).toBeVisible();
});

test('03 · gutter drag resizes within the clamp', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	const before = await railWidth(page);
	expect(before).toBeGreaterThanOrEqual(200);
	expect(before).toBeLessThanOrEqual(500);

	// Widen by 120px — the wrapper width follows the pointer. The drag
	// starts at the gutter's CENTER, so the end x is start + 120.
	const gutter = page.getByTestId('sidebar-gutter');
	const gbox = await gutter.boundingBox();
	const startX = gbox!.x + gbox!.width / 2;
	await page.mouse.move(startX, gbox!.y + 100);
	await page.mouse.down();
	await page.mouse.move(startX + 120, gbox!.y + 100, { steps: 4 });
	await page.mouse.up();
	// The clamp caps at 500 (SIDEBAR_MAX_WIDTH): 400 + 120 lands ON the
	// cap, not past it — the drag follows the pointer only within the
	// clamp (W0 net fix 2026-10-09; the old +120 assertion predates the
	// 500px cap and demanded an impossible width).
	expect(await railWidth(page)).toBe(Math.min(before + 120, 500));

	// Drag far past the left edge — the clamp holds the 200px minimum.
	const gbox2 = await gutter.boundingBox();
	await page.mouse.move(gbox2!.x + gbox2!.width / 2, gbox2!.y + 100);
	await page.mouse.down();
	await page.mouse.move(0, gbox2!.y + 100, { steps: 4 });
	await page.mouse.up();
	expect(await railWidth(page)).toBe(200);

	// The resized width survives a reload.
	await page.reload();
	await expect(page.getByTestId('app-sidebar')).toBeVisible();
	expect(await railWidth(page)).toBe(200);
});

test('03b · the width badge rides the drag: live px chip, fading afterglow', async ({ page }) => {
	// Movable Rail ADR amendment (2026-10-30): the sidebar answers its
	// drag with the same chip the floor gutters show — live during the
	// move, 'fading' at mouseup (the 10s afterglow is the floor's).
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	const gutter = page.getByTestId('sidebar-gutter');
	const gbox = await gutter.boundingBox();
	const startX = gbox!.x + gbox!.width / 2;
	await page.mouse.move(startX, gbox!.y + 100);
	await page.mouse.down();
	await page.mouse.move(startX - 60, gbox!.y + 100, { steps: 4 });

	// LIVE mid-drag: the chip is visible, phase live, text in whole px.
	const badge = page.getByTestId('sidebar-width-badge');
	await expect(badge).toBeVisible();
	await expect(badge).toHaveAttribute('data-badge-phase', 'live');
	await expect(badge).toHaveText(/^\d+px$/);

	await page.mouse.up();
	// FADING at mouseup — the afterglow freeze.
	await expect(badge).toHaveAttribute('data-badge-phase', 'fading');
});

test('05 · cross-session click swaps the conversation panel', async ({ page }) => {
	// Regression (2026-08-23): SvelteKit reuses the page component when only
	// [sessionId] changes, so the init-captured store kept rendering the OLD
	// session while the URL moved. Each panel column keys its
	// ConversationPanel by sessionId (the former route-group layout key
	// retired with the 2026-09-02 root move) — the panel must follow the URL.
	const NEW_SESSION = 'e2e-created-9001';
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toContainText(STUB_USER_HELLO);

	// Point the stub's single-row session.list at a blank created session —
	// the sidebar's ≤5s cadence then renders it as a link (not current).
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ listSessionId: NEW_SESSION, createdSessions: [NEW_SESSION] })
	});
	const link = page.locator(`[data-testid="sidebar-session-card"][href*="${NEW_SESSION}"]`);
	await expect(link).toBeVisible({ timeout: 10_000 });

	await link.click({ modifiers: ['Shift'] });
	// Panel Floor W3 (task 3.4, GAP-3 assertion flip; verbs reversed
	// 2026-08-28): the Shift+click spine verb is replace-selected — the
	// URL STAYS / and no longer contains the new session id
	// (the panel swap assertions below carry the visible-outcome proof).
	await expect(page).toHaveURL(/\/$/);
	await expect(page).not.toHaveURL(new RegExp(NEW_SESSION));

	// The panel shows the NEW session: blank transcript, header id, and none
	// of the previous session's content.
	await expect(page.getByTestId('transcript-empty')).toBeVisible();
	await expect(page.getByTestId('session-id-and-name')).toHaveAttribute('data-session-id', NEW_SESSION);
	await expect(page.getByTestId('transcript')).not.toContainText(STUB_USER_HELLO);
});

test('06 · workspace attributes: chips, pills, hide-empty, and inheritance', async ({ page }) => {
	// Spec 05 repointed the stub's list — restore the canonical rows.
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ listSessionId: STUB_SESSION_ID })
	});

	// The stub lists TWO rows: the current session (cwd /tmp, titled) and a
	// blank session in the harness workspace (cwd STUB_BLANK_CWD).
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);
	await expect(page.getByTestId('sidebar-session-current')).toBeVisible();

	// Uniqueness (2026-08-24 duplication scare): the pinned current row
	// renders EXACTLY once — SidebarOpenPanels is mounted only by
	// SessionsList (above the filter pills, 2026-08-26), never also
	// inside SidebarSessionsList.
	await expect(page.getByTestId('sidebar-session-current')).toHaveCount(1);
	await expect(
		page.getByTestId('sidebar-session-current').getByTestId('sidebar-workspace-chip')
	).toHaveCount(1);

	// Cues (hybrid model): every cwd gets a chip; /tmp is in NO registry
	// workspace → GHOST chip (grey, data-registered=false). The stub's
	// registry carries harness + deepseek-chat, so those pills are
	// registered (blue) while tmp is a ghost (grey).
	const curChip = page.locator('[data-testid="sidebar-session-current"] .ws');
	await expect(curChip).toContainText('tmp');
	await expect(curChip).toHaveAttribute('data-registered', 'false');

	// Pills derive from session cwd (existence), annotated by the registry
	// (status): tmp ghost, harness registered. Collapsed by default — open.
	await expandFilters(page);
	const harnessPill = page.getByTestId('filter-workspace-deepseek-harness');
	await expect(harnessPill).toBeVisible();
	await expect(harnessPill).toContainText('1');
	await expect(harnessPill).toHaveAttribute('data-registered', 'true');
	// (A ghost PILL needs a non-current ghost row — the stub's only /tmp row
	// IS the current session, excluded from pill derivation; ghost pills are
	// covered by the workspaceOptions unit tests.)

	// Blank sessions hide by default — the harness workspace's only row is
	// blank, so filtering to it shows the no-match hint…
	await harnessPill.click();
	await expect(page.getByTestId('sidebar-sessions-empty')).toBeVisible();

	// The workspace column STAYS under an active workspace filter
	// (2026-08-24 revision): the pinned current session is exempt from
	// filtering and lives in /tmp — a DIFFERENT workspace than the filter.
	// Its chip is the one cue saying where the active chat runs; hiding it
	// left the current row with no workspace info at all.
	const currentChip = page
		.getByTestId('sidebar-session-current')
		.getByTestId('sidebar-workspace-chip');
	await expect(currentChip).toBeVisible();
	await expect(currentChip).toContainText('tmp');
	// Matched rows keep their chip too (revealed below) — column, not noise.
	await page.getByTestId('filter-blank-empty').click();
	const blankCard = page.getByTestId('sidebar-session-card');
	await expect(blankCard).toHaveCount(1);
	await expect(blankCard.first()).toContainText('untitled');
	// Panel Floor W4 (task 4.2): the spine tooltip now EXTENDS the cwd cue
	// with the floor affordance (verbs reversed 2026-08-28: plain click
	// adds, Shift+click replaces); same locator, extended value
	// (commitment 5).
	await expect(blankCard.first()).toHaveAttribute(
		'title',
		`${STUB_BLANK_CWD} — Shift+click to replace panel`
	);
	// …and its workspace chip renders under the active filter (the column
	// rule above) with the harness label.
	await expect(blankCard.first().getByTestId('sidebar-workspace-chip')).toContainText('harness');
	await expect(blankCard.first()).toHaveAttribute(
		'href',
		`/?sessionKey=${STUB_BLANK_SESSION_ID}`
	);

	// Inheritance → SELECTION (2026-08-24): the pills arm + New chat. Clear
	// the filters, pick a listed agent pill (research — the stub host
	// rejects presets it does not list) and the harness workspace pill,
	// click — the create carries BOTH over the wire.
	await page.getByTestId('filter-all').click();
	await page.getByTestId('filter-preset-research').click();
	await page.getByTestId('filter-workspace-deepseek-harness').click();
	// The footer's verb toggle (2026-08-31): it renders beside the button
	// and defaults to Add — the button reads + New chat with no touch.
	const toggle = page.getByTestId('chat-mode-toggle');
	await expect(toggle).toBeVisible();
	await expect(page.getByTestId('chat-mode-add')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('chat-mode-replace')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByTestId('new-chat-button')).toHaveText(/\+ New chat/);
	await page.getByTestId('new-chat-button').click();
	// Add-to-floor (2026-08-31): the create joins the open desk as a NEW
	// panel — no navigation, no seed reset. The floor grows 1 → 2.
	await expect(page.getByTestId('panel-column')).toHaveCount(2, { timeout: 5_000 });
	expect(page.url()).not.toContain('e2e-created-');
	const created = (await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json())
		.createCalls.at(-1);
	expect(created?.agentPreset).toBe('research');
	expect(created?.cwd).toBe(STUB_BLANK_CWD);
	// The newcomer's column carries the fresh session id, beside the
	// SURVIVING seed panel (the old behavior wiped the desk to one panel).
	const createdId = (
		(await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json())
			.createdSessions as string[]
	).at(-1);
	await expect(
		page.locator(`[data-testid="panel-column"][data-session-id="${createdId}"]`)
	).toBeVisible();
	await expect(
		page.locator(`[data-testid="panel-column"][data-session-id="${STUB_SESSION_ID}"]`)
	).toBeVisible();
	// The sidebar panel group lists it too (the add takes selection — the
	// row carries the current testid; the pane scope covers both shapes).
	await expect(
		page.locator(`[data-testid="sidebar-panel-pane"] [data-session-id="${createdId}"]`)
	).toBeVisible();
});

test('06b · Replace chat swaps the FOCUSED panel; the rest of the desk survives', async ({
	page
}) => {
	// Canonical list (previous specs may repoint it).
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ listSessionId: STUB_SESSION_ID })
	});

	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);
	await expect(page.getByTestId('panel-column')).toHaveCount(1);

	// Arm the pills and ADD one chat — floor [seed, add1], the add takes
	// focus (so the replace below has an unambiguous focused panel).
	await expandFilters(page);
	await page.getByTestId('filter-preset-research').click();
	await page.getByTestId('filter-workspace-deepseek-harness').click();
	await page.getByTestId('new-chat-button').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2, { timeout: 5_000 });
	const add1 = (
		(await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json())
			.createdSessions as string[]
	).at(-1);

	// REPLACE chat: flip the verb toggle (the segmented control beside the
	// button) — the button relabels — then click. The focused panel (add1)
	// swaps onto a fresh session: [seed, add1] becomes [seed, add2]. Count
	// holds, the slot is kept.
	await page.getByTestId('chat-mode-replace').click();
	await expect(page.getByTestId('chat-mode-replace')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('new-chat-button')).toHaveText(/Replace chat/);
	await page.getByTestId('new-chat-button').click();
	await expect(page.getByTestId('panel-column')).toHaveCount(2, { timeout: 5_000 });
	expect(page.url()).not.toContain('sessionKey=');
	const add2 = (
		(await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json())
			.createdSessions as string[]
	).at(-1);
	expect(add2).toBeTruthy();
	expect(add2).not.toBe(add1);
	await expect(
		page.locator(`[data-testid="panel-column"][data-session-id="${add2}"]`)
	).toBeVisible();
	await expect(page.locator(`[data-testid="panel-column"][data-session-id="${add1}"]`)).toHaveCount(
		0
	);
	// The seed panel — NOT focused — was never touched.
	await expect(
		page.locator(`[data-testid="panel-column"][data-session-id="${STUB_SESSION_ID}"]`)
	).toBeVisible();
});

test('07 · blank-mode preference survives a hard reload; All clears it', async ({ page }) => {
	// Persistence (2026-08-23): blankMode is a standing noise preference —
	// set [0] in the filter row's toggle, hard-reload, the selection AND its
	// filtering effect must still be there.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandFilters(page);
	const empty = page.getByTestId('filter-blank-empty');
	const nonempty = page.getByTestId('filter-blank-nonempty');
	await expect(nonempty).toHaveAttribute('aria-pressed', 'true'); // default [!0]

	await empty.click();
	await expect(empty).toHaveAttribute('aria-pressed', 'true');

	await page.reload();
	await expect(page.getByTestId('app-sidebar')).toBeVisible();
	// The row re-collapses on every load — open it again to read the pills.
	await expandFilters(page);
	await expect(page.getByTestId('filter-blank-empty')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('filter-blank-nonempty')).toHaveAttribute('aria-pressed', 'false');
	// The persisted mode still filters: only the stub's ONE blank session
	// remains as a card (the chat-side session is gone).
	const cards = page.getByTestId('sidebar-session-card');
	await expect(cards).toHaveCount(1);
	await expect(cards.first()).toContainText('untitled');

	// All clears every dimension (2026-08-24): the toggle unselects — back
	// to 'any', NOT the [!0] default — and rows from BOTH sides of the
	// count filter return: the blank untitled row and the titled chat row
	// (exact totals stay loose — earlier specs leave created stub
	// sessions behind in the shared stub state).
	await page.getByTestId('filter-all').click();
	await expect(page.getByTestId('filter-blank-empty')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByTestId('filter-blank-nonempty')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByTestId('filter-all')).toHaveAttribute('aria-pressed', 'true');
	await expect(cards.filter({ hasText: 'untitled' })).toHaveCount(1);
	await expect(cards.filter({ hasText: 'Chat side session' })).toHaveCount(1);
});

test('08 · attribute pills survive a hard reload (with their filtering)', async ({ page }) => {
	// SessionFilterRow persistence (2026-08-23): the whole filter state —
	// pills AND toggle — survives a reload. Stub rows: current (main, /tmp,
	// titled), blank (app-dev, harness), chat (main, deepseek-chat).
	// State restore: spec 06's New chat repointed the stub list at its
	// created session (the list follows the create) — put the canonical
	// rows back so this spec's page HAS a current session.
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ listSessionId: STUB_SESSION_ID })
	});
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expandFilters(page);

	const harness = page.getByTestId('filter-workspace-deepseek-harness');
	const appdev = page.getByTestId('filter-preset-app-dev');
	await harness.click();
	await expect(harness).toHaveAttribute('aria-pressed', 'true');
	// Chip-under-filter regression pinned in spec 06 (canonical fixture
	// there); here the same rule holds through the reload below.
	await appdev.click();
	await expect(appdev).toHaveAttribute('aria-pressed', 'true');
	// harness ∩ app-dev → only the blank session, hidden by default → no-match.
	await expect(page.getByTestId('sidebar-sessions-empty')).toBeVisible();

	// Hard reload: pills stay pressed AND still filter.
	await page.reload();
	await expect(page.getByTestId('app-sidebar')).toBeVisible();
	await expandFilters(page);
	await openPanelGroup(page);
	await expect(page.getByTestId('filter-workspace-deepseek-harness')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByTestId('filter-preset-app-dev')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('sidebar-sessions-empty')).toBeVisible();
	// The workspace column survives the reload under the active filter:
	// the pinned current (/tmp, outside the filtered workspace) still
	// carries its chip.
	await expect(
		page.getByTestId('sidebar-session-current').getByTestId('sidebar-workspace-chip')
	).toBeVisible();
});

test('09 · Add workspace: browse to a directory, adopt it, chat in it', async ({ page }) => {
	// DSH-parity header button (2026-08-23): aria-label="Add workspace".
	// 2026-08-24: a real folder picker, not a path form — the panel browses
	// host.listDirectory levels (home → agentic-ai → openclaw-insight), and
	// confirm runs adopt + session.create {cwd} with NO preset step (the
	// host default agent; spec pins agentPreset absent on the wire).
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	const addBtn = page.getByTestId('add-workspace-button');
	await expect(addBtn).toHaveAttribute('aria-label', 'Add workspace');

	// Placement: the header carries Add workspace + collapse; the
	// conversation-count toggle lives INSIDE the filter row, immediately
	// after All (2026-08-24 move out of the header). The pills only exist
	// expanded — open the row first.
	await expandFilters(page);
	const place = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="add-workspace-button"]');
		const row = document.querySelector('[data-testid="session-filter-row"]');
		const all = document.querySelector('[data-testid="filter-all"]');
		const toggle = document.querySelector('[data-testid="filter-blank-toggle"]');
		const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
		if (!btn || !row || !all || !toggle) {
			return { inRow: false, afterAll: false, afterToggle: false };
		}
		return {
			inRow: !!btn.closest('[data-testid="session-filter-row"]'),
			afterAll: before(all, toggle),
			afterToggle: before(toggle, btn)
		};
	});
	// 2026-09-12 move: Add workspace lives in the filter row's META postfix
	// (last control, after All + the count toggle) — the header cluster
	// holds canvas-copy and collapse only (W0 net fix; the header
	// assertions predate the move).
	expect(place.inRow).toBe(true);
	expect(place.afterAll).toBe(true);
	expect(place.afterToggle).toBe(true);

	// Open the browser: the home level loads (breadcrumbs root at Home).
	await addBtn.click();
	const panel = page.getByTestId('add-workspace-panel');
	await expect(panel).toBeVisible();
	const entry = (name: string) => page.locator(`[data-testid="add-workspace-entry"][data-name="${name}"]`);
	await expect(entry('agentic-ai')).toBeVisible({ timeout: 5_000 });

	// Walk: descend into agentic-ai, then openclaw-insight (a leaf level).
	await entry('agentic-ai').click();
	await expect(entry('deepseek-harness')).toBeVisible();

	// Hidden rows stay hidden until the toggle flips (dot-folder fixture).
	await expect(entry('.config')).toHaveCount(0);
	await page.getByTestId('add-workspace-hidden-toggle').click();
	await expect(entry('.config')).toBeVisible();
	await page.getByTestId('add-workspace-hidden-toggle').click();
	await expect(entry('.config')).toHaveCount(0);

	await entry('openclaw-insight').click();
	await expect(page.getByTestId('add-workspace-empty')).toBeVisible();
	await expect(page.getByTestId('add-workspace-target')).toHaveText(
		'/Users/wharsojo/agentic-ai/openclaw-insight'
	);

	// Breadcrumb jump works: Home returns to the home level, then walk back.
	await page.locator('[data-testid="add-workspace-crumb"][data-path="/Users/wharsojo"]').click();
	await expect(entry('agentic-ai')).toBeVisible();
	await entry('agentic-ai').click();
	await entry('openclaw-insight').click();
	await expect(page.getByTestId('add-workspace-target')).toHaveText(
		'/Users/wharsojo/agentic-ai/openclaw-insight'
	);

	// One click — adopt + fresh session, no preset picker anywhere.
	await expect(page.getByTestId('preset-picker')).toHaveCount(0);
	await page.getByTestId('add-workspace-confirm').click();
	// 2026-08-31 revision: the fresh session JOINS THE FLOOR as a new
	// panel — no navigation, no desk reset (the seed URL is the off-floor
	// fallback only). Wait for the panel, not the URL (W0 net fix).
	await expect(
		page.locator('[data-testid="panel-column"][data-session-id^="e2e-created-"]')
	).toBeVisible({ timeout: 5_000 });

	// Wire truth: the browse walk happened, adoption adopted the LISTED
	// folder, and session.create carries the cwd with NO agentPreset.
	const state = await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json();
	expect(state.workspaceCreateCalls.at(-1)).toBe('/Users/wharsojo/agentic-ai/openclaw-insight');
	expect(state.createCalls.at(-1)?.cwd).toBe('/Users/wharsojo/agentic-ai/openclaw-insight');
	expect(state.createCalls.at(-1)?.agentPreset).toBeNull();
	// The browse started at home (null) and only moved through real levels.
	expect(state.listDirectoryCalls[0]).toBeNull();
	expect(state.listDirectoryCalls.at(-1)).toBe('/Users/wharsojo/agentic-ai/openclaw-insight');
});

test('10 · selected pills keep contrast under hover (fg ≠ bg)', async ({ page }) => {
	// Regression (2026-08-23): a hover rule at higher specificity than the
	// selected rule once rendered a selected preset as purple text on a
	// purple background. Rest/hover styles now carry :not(.on) guards; this
	// spec pins the invariant — hover a selected pill, foreground must
	// differ from background — for all three pill kinds, plus the
	// yellowgreen count-only All state (2026-08-24).
	// Deterministic rows: point the stub's list at a CREATED session (cwd
	// /tmp — in no registry entry → the ghost pill) beside the canonical
	// blank (harness, registered) and chat (deepseek-chat, registered).
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			listSessionId: 'e2e-created-9001',
			createdSessions: ['e2e-created-9001']
		})
	});
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('session-filter-row')).toBeVisible();
	await expandFilters(page);

	const read = () =>
		page.evaluate(() => {
			const el = document.querySelector('[aria-pressed="true"]');
			if (!el) return null;
			const cs = getComputedStyle(el);
			return { fg: cs.color, bg: cs.backgroundColor };
		});

	for (const testid of ['filter-preset-main', 'filter-workspace-deepseek-chat', 'filter-workspace-tmp']) {
		const pill = page.getByTestId(testid);
		await pill.click();
		await expect(pill).toHaveAttribute('aria-pressed', 'true');
		await pill.hover();
		await page.waitForTimeout(150);
		const st = await read();
		expect(st, testid).not.toBeNull();
		expect(st!.fg, `${testid}: fg must differ from bg under hover`).not.toBe(st!.bg);
		await pill.click(); // unselect for the next kind
		await page.waitForTimeout(150);
	}

	// Fourth state (2026-08-24): the count toggle as the ONLY active filter
	// paints All yellowgreen (the once-invisible [0] trap). The paint must
	// survive hover with fg ≠ bg, like every selected state.
	const all = page.getByTestId('filter-all');
	await page.getByTestId('filter-blank-empty').click();
	await expect(all).toHaveClass(/count-only/);
	const restSt = await page.evaluate(() => {
		const cs = getComputedStyle(document.querySelector('[data-testid="filter-all"]')!);
		return { fg: cs.color, bg: cs.backgroundColor };
	});
	expect(restSt.bg).toBe('rgb(154, 205, 50)'); // yellowgreen at rest
	await all.hover();
	await page.waitForTimeout(150);
	const hoverSt = await page.evaluate(() => {
		const cs = getComputedStyle(document.querySelector('[data-testid="filter-all"]')!);
		return { fg: cs.color, bg: cs.backgroundColor };
	});
	expect(hoverSt.bg).toBe('rgb(131, 174, 43)'); // darkened hover paint
	expect(hoverSt.fg, 'count-only All: fg must differ from bg under hover').not.toBe(hoverSt.bg);

	// Cleanup: All clears every dimension — neutral storage for other specs.
	await all.click();
	await expect(page.getByTestId('filter-blank-empty')).toHaveAttribute('aria-pressed', 'false');
});

test('11 · Add workspace: native host → system dialog drives adopt+chat', async ({ page }) => {
	// The local-machine case (2026-08-24 bug): DSH's auto backend mounts
	// the NATIVE picker on a loopback darwin host — host.listDirectory
	// refuses directory-picker/unavailable {capability:'native'} and DSH's
	// own UI drives host.pickDirectory (the OS dialog). DSI adapts the same
	// way: no in-app listing, the dialog RPC carries the pick, and the
	// returned path runs adopt + session.create {cwd, no preset}.
	// A cancelled dialog (null path) closes the panel quietly.
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ pickerCapability: 'native', pickDirectoryResult: null, pickDirectoryDelayMs: 400 })
	});
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	// Cancelled dialog: the panel appears in native mode, then closes
	// itself — nothing adopted, nothing created, one dialog RPC.
	// (Baselines: earlier specs in this worker already grew the call logs.)
	const before = await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json();
	await page.getByTestId('add-workspace-button').click();
	await expect(page.getByTestId('add-workspace-native')).toBeVisible({ timeout: 5_000 });
	await expect(page.getByTestId('add-workspace-panel')).toHaveCount(0, { timeout: 5_000 });
	let state = await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json();
	expect(state.pickDirectoryCalls).toBe(1);
	expect(state.workspaceCreateCalls).toHaveLength(before.workspaceCreateCalls.length);
	expect(state.createCalls).toHaveLength(before.createCalls.length);

	// Picked dialog: the scripted path runs the whole payoff. The 400ms
	// dialog latency holds the native panel observably open before the
	// navigation lands.
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ pickDirectoryResult: STUB_ADOPT_DIR })
	});
	await page.getByTestId('add-workspace-button').click();
	await expect(page.getByTestId('add-workspace-native')).toBeVisible({ timeout: 5_000 });
	// Floor join, not navigation (2026-08-31 revision; W0 net fix).
	await expect(
		page.locator('[data-testid="panel-column"][data-session-id^="e2e-created-"]')
	).toBeVisible({ timeout: 5_000 });

	// Wire truth: the browse method was refused (one probe call), the OS
	// dialog carried the pick, adoption + create used the picked path with
	// NO agentPreset.
	state = await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json();
	expect(state.pickDirectoryCalls).toBe(2);
	expect(state.workspaceCreateCalls.at(-1)).toBe(STUB_ADOPT_DIR);
	expect(state.createCalls.at(-1)?.cwd).toBe(STUB_ADOPT_DIR);
	expect(state.createCalls.at(-1)?.agentPreset).toBeNull();

	// Restore the browse host for later specs.
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ pickerCapability: 'browse', pickDirectoryDelayMs: 0 })
	});
});

test('12 · filter row expands by default: summary, fold state, sibling resize', async ({ page }) => {
	// 2026-09-18 (was collapsed 2026-08-26): the pills render openly under
	// the header on EVERY load — `Filter by - {workspace} + {agent}`,
	// a chip per selected dimension, the muted `Workspace + Agent`
	// placeholder when nothing filters, the count toggle disclosed only in
	// the tooltip. The fold is not persisted: reload expands it again.
	// Sibling resize is the structural payoff: folding hands the pill
	// rows' height back to the spine below (SidebarSessionContainer,
	// flex:1 + internal scroll).
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ listSessionId: STUB_SESSION_ID })
	});
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	const toggle = page.getByTestId('filter-toggle');
	const summary = page.getByTestId('filter-summary');

	// Expanded by default: pills in the DOM, chevron open.
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(summary).toHaveText('Filter by - Workspace + Agent');
	await expect(page.getByTestId('filter-all')).toBeVisible();
	// The tooltip carries what the summary omits — the standing [!0].
	await expect(toggle).toHaveAttribute('title', 'Workspace: All · Agent: All · Count: !0');

	// Pick workspace + agent — the summary reads BOTH segments,
	// workspace first.
	await page.getByTestId('filter-preset-main').click();
	await page.getByTestId('filter-workspace-deepseek-harness').click();
	await expect(summary).toHaveText('Filter by - deepseek-harness + Main');

	// Fold — pills gone, summary keeps reporting the live selection, and
	// the tooltip now carries both segments. Click the CHEVRON (left edge):
	// once pills are picked, the summary chips occupy the button's center
	// and a chip click opens its menu instead of folding (ADR D1 — the
	// registered chip's click stops propagation; W0 net fix 2026-10-09).
	const tbox = await toggle.boundingBox();
	await page.mouse.click(tbox!.x + 10, tbox!.y + tbox!.height / 2);
	// The fold hides only the dimension pills (2026-09-04): the All clear
	// moved into the always-visible meta header — it must SURVIVE the fold.
	await expect(page.locator('#filter-pills')).toHaveCount(0);
	await expect(page.getByTestId('filter-all')).toHaveCount(1);
	await expect(summary).toHaveText('Filter by - deepseek-harness + Main');
	await expect(toggle).toHaveAttribute(
		'title',
		'Workspace: deepseek-harness · Agent: Main · Count: !0'
	);

	// The fold is NOT persisted: a reload restores the expanded default
	// (selection itself still persists — the summary re-reports it).
	await page.reload();
	await expect(page.getByTestId('app-sidebar')).toBeVisible();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(summary).toHaveText('Filter by - deepseek-harness + Main');

	// Sibling resize proof: the row SHRINKS when folded — the pill-wrap
	// lines hand their height back to the flex column (the spine list
	// below absorbs them; with a one-session stub the list is content-
	// sized, so the ROW's own height is the deterministic signal — W0
	// net fix 2026-10-09; the old spine-height assertion needed a tall
	// list the stub never provides).
	const row = page.getByTestId('session-filter-row');
	const expandedRowHeight = (await row.boundingBox())!.height;
	const tbox2 = await toggle.boundingBox();
	await page.mouse.click(tbox2!.x + 10, tbox2!.y + tbox2!.height / 2);
	const foldedRowHeight = (await row.boundingBox())!.height;
	expect(foldedRowHeight).toBeLessThan(expandedRowHeight);

	// Neutral storage for later specs: All clears every dimension.
	await expandFilters(page);
	await page.getByTestId('filter-all').click();
	await expect(page.getByTestId('filter-blank-nonempty')).toHaveAttribute('aria-pressed', 'false');
});

// ── Lineage sidebar W5 (task 5.1, 2026-08-27) — ADR "The Lineage Pin" ────
// Four journey pins over stub lineage fixtures: ghost under an open parent
// (within one spine tick, never in the spine), adopt-pins-below, the
// family-block swap (the ADR worked example), and close-re-homes.

/** Plant lineage fixture rows on the stub host (children of STUB_SESSION_ID). */
async function plantLineage(
	children: Array<{ sessionId: string; title: string; running?: boolean; ageMs?: number }>
): Promise<void> {
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			lineageSessions: children.map((c) => ({
				sessionId: c.sessionId,
				parentSessionId: STUB_SESSION_ID,
				title: c.title,
				running: c.running ?? false,
				cwd: '/tmp',
				...(c.ageMs !== undefined ? { ageMs: c.ageMs } : {})
			}))
		})
	});
}

async function panelGroupSessionIds(page: import('@playwright/test').Page): Promise<string[]> {
	const rows = page.locator(
		'[data-testid="sidebar-panel-row"], [data-testid="sidebar-session-current"], [data-testid="sidebar-ghost-row"]'
	);
	const n = await rows.count();
	const ids: string[] = [];
	for (let i = 0; i < n; i++) ids.push((await rows.nth(i).getAttribute('data-session-id')) ?? '');
	return ids;
}

/** One floor row by session id — panel rows AND the selected row (the
 *  selected panel carries the LEGACY `sidebar-session-current` testid). */
function panelRow(page: import('@playwright/test').Page, sessionId: string) {
	return page.locator(
		`[data-session-id="${sessionId}"][data-testid="sidebar-panel-row"],` +
			`[data-session-id="${sessionId}"][data-testid="sidebar-session-current"]`
	);
}

/** One SPINE row by session id — spine cards carry no data-session-id
 *  (identity is the href sessionKey; probing proved the attr absent). */
function spineCard(page: import('@playwright/test').Page, sessionId: string) {
	return page.locator(`[data-testid="sidebar-session-card"][href*="sessionKey=${sessionId}"]`);
}

test.afterEach(async () => {
	// Byte-neutral hygiene: lineage + extra-session fixtures never leak
	// into later specs (spec 18's stranger/vantage ride extraSessions —
	// a later spec's spine must not see them).
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ lineageSessions: [], extraSessions: [] })
	});
});

test('13 · lineage: spawned child appears as a GHOST under its open parent — never in the spine', async ({ page }) => {
	await plantLineage([{ sessionId: 'e2e-sub-agent-0001', title: 'Spawned helper', running: true }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);
	await revealChildren(page);

	// The ghost renders under the parent within one spine tick.
	const ghost = page.getByTestId('sidebar-ghost-row');
	await expect(ghost).toBeVisible();
	await expect(ghost).toHaveAttribute('data-session-id', 'e2e-sub-agent-0001');
	await expect(ghost).toHaveAttribute('data-depth', '1');
	await expect(ghost).toContainText('Spawned helper');

	// Order contract (I1/I2): parent row FIRST, ghost directly below.
	expect(await panelGroupSessionIds(page)).toEqual([STUB_SESSION_ID, 'e2e-sub-agent-0001']);

	// No double-listing: the child never renders as a spine row (href-
	// keyed locator — cards carry no data-session-id; the first version of
	// this assertion was VACUOUS and is repaired here).
	await expect(spineCard(page, 'e2e-sub-agent-0001')).toHaveCount(0);
	// And the spine still shows its own sessions (the locator discriminates).
	await expect(spineCard(page, 'e2e-chat-session-0003')).toHaveCount(1);
});

test('14 · lineage: the parent glyph shows live delegation (red bullet, ×1) while the child runs', async ({ page }) => {
	await plantLineage([{ sessionId: 'e2e-sub-agent-0002', title: 'Working child', running: true }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);

	// Parent row (the current panel row): idle self + live delegation →
	// the four-state glyph's red-bullet label with the count.
	const parentRow = page.getByTestId('sidebar-session-current');
	await expect(parentRow).toBeVisible();
	const glyph = parentRow.locator('[data-testid="session-status"]');
	await expect(glyph).toHaveAttribute('aria-label', 'delegating, 1 running');
});

test('15 · lineage: adopt pins the child below its spawner — and the family block never splits', async ({ page }) => {
	await plantLineage([{ sessionId: 'e2e-sub-agent-0003', title: 'Adoptable child' }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);
	await revealChildren(page);

	// Adopt via the ghost's own click.
	await page.getByTestId('sidebar-ghost-row').click();
	// Adoption SELECTS the new panel — its row carries the legacy current
	// testid, so the locator unions both row species.
	const adopted = panelRow(page, 'e2e-sub-agent-0003');
	await expect(adopted).toBeVisible();
	await expect(adopted).toHaveAttribute('data-depth', '1');

	// Add a plain session panel (plain-click the spine row) — the add
	// lands BEFORE THE FOCUSED PANEL (operator spec, 2026-08-31); the
	// adoption focused the CHILD, so the slot clamps to the family head
	// (never split a family) — the stranger joins above the whole block.
	await spineCard(page, 'e2e-chat-session-0003').click();
	await expect(panelRow(page, 'e2e-chat-session-0003')).toBeVisible();

	// [other, parent, child] — the add joined left of the family; the
	// family block stays CONTIGUOUS (pin intact).
	expect(await panelGroupSessionIds(page)).toEqual([
		'e2e-chat-session-0003',
		STUB_SESSION_ID,
		'e2e-sub-agent-0003'
	]);
	// The stranger moves DOWN: a root move swaps with the adjacent BLOCK
	// as a unit — it leaps the whole family, children never re-parent.
	await panelRow(page, 'e2e-chat-session-0003').getByTestId('sidebar-panel-move-down').click();
	expect(await panelGroupSessionIds(page)).toEqual([
		STUB_SESSION_ID,
		'e2e-sub-agent-0003',
		'e2e-chat-session-0003'
	]);
});

test('16 · lineage: closing the parent removes the WHOLE family — no dangling child, rows return to the spine', async ({ page }) => {
	await plantLineage([{ sessionId: 'e2e-sub-agent-0004', title: 'Orphaning child' }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);
	await revealChildren(page);
	await page.getByTestId('sidebar-ghost-row').click();
	await expect(panelRow(page, 'e2e-sub-agent-0004')).toBeVisible();

	// Close the PARENT panel (operator spec, 2026-08-28): the adopted
	// child goes WITH it — the subtree never dangles on the floor.
	await panelRow(page, STUB_SESSION_ID).getByTestId('sidebar-panel-close').click();

	// Floor: both panels are gone (the empty floor renders no columns).
	await expect(page.getByTestId('panel-column')).toHaveCount(0);

	// Spine: the parent's row returns (nothing panels it now). href-keyed.
	await expect(spineCard(page, STUB_SESSION_ID)).toBeVisible();
});

test('17 · paneled sessions paint darkviolet — name, workspace chip, row buttons; ghosts keep defaults', async ({ page }) => {
	await plantLineage([{ sessionId: 'e2e-sub-agent-0005', title: 'Violet sibling' }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);
	await revealChildren(page);

	// A second panel so the seed row OFFERS its move-UP (consecutive adds
	// stack newest-first at the head, so the seed rides the TAIL — edge
	// rows hide their buttons, the clamp, journey 15's grammar).
	await spineCard(page, 'e2e-chat-session-0003').click();

	// The PANEL row (the seed session): name + ws chip + move button carry
	// #9400d3 (rgb(148, 0, 211)); the ghost sibling keeps default colors.
	// Computed styles — the honest paint check (unit-level happy-dom never
	// receives Svelte-injected CSS).
	const panel = panelRow(page, STUB_SESSION_ID);
	await expect(panel).toBeVisible();
	await expect(panel.locator('.label')).toHaveCSS('color', 'rgb(148, 0, 211)');
	await expect(panel.locator('.ws')).toHaveCSS('color', 'rgb(148, 0, 211)');
	await expect(panel.getByTestId('sidebar-panel-move-up')).toHaveCSS('color', 'rgb(148, 0, 211)');
	await expect(panel.getByTestId('sidebar-panel-close')).toHaveCSS('color', 'rgb(148, 0, 211)');

	const ghost = page.getByTestId('sidebar-ghost-row');
	await expect(ghost).toBeVisible();
	await expect(ghost.locator('.label')).not.toHaveCSS('color', 'rgb(148, 0, 211)');
});

// W7 (2026-08-28): spine CONTIGUITY. The spine rendered the wire order
// (updatedAt desc) with the lineage indent painted on top — nothing moved
// a child next to its head, so a stranger whose recency fell between two
// children's wedged INSIDE the family block. Live-caught on the operator's
// run: session-2758c928 ("LOL Refactor", 5 sub-agents) with session-85d8e67c
// interleaved between the indented children. The stub now lists sessions in
// real-host order (updatedAt descending, apiproxy parity), so the fixture
// reproduces the wedge exactly — and the spine must heal it (ADR D6/I1).
test('18 · lineage: spine family renders CONTIGUOUS — a stranger never wedges between the children', async ({ page }) => {
	const M = 60_000;
	// Five children whose recency STRADDLES the stranger's (ages 10m..60m).
	await plantLineage([
		{ sessionId: 'e2e-spine-kid-0001', title: 'Spine kid 1', ageMs: 10 * M },
		{ sessionId: 'e2e-spine-kid-0002', title: 'Spine kid 2', ageMs: 20 * M },
		{ sessionId: 'e2e-spine-kid-0003', title: 'Spine kid 3', ageMs: 40 * M },
		{ sessionId: 'e2e-spine-kid-0004', title: 'Spine kid 4', ageMs: 50 * M },
		{ sessionId: 'e2e-spine-kid-0005', title: 'Spine kid 5', ageMs: 60 * M }
	]);
	// The STRANGER (age 30m — between kid 2 and kid 3 on the wire) and a
	// VANTAGE session (age 90m, oldest): opening the vantage's conversation
	// keeps the family head (STUB_SESSION_ID) OFF the floor, so the whole
	// family stays in the spine — the exact posture of the live catch.
	const turn = [
		{ event: { type: 'turn/start', seq: 11, time: 1787212000001, data: {} } },
		{ event: { type: 'turn/end', seq: 12, time: 1787212000002, data: {} } }
	];
	const state = await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json();
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			extraSessions: [
				...(state.extraSessions ?? []),
				{
					sessionId: 'e2e-spine-stranger',
					title: 'Unrelated stranger',
					agentPreset: 'main',
					cwd: '/tmp',
					ledger: turn,
					ageMs: 30 * M
				},
				{
					sessionId: 'e2e-spine-vantage',
					title: 'Spine vantage',
					agentPreset: 'main',
					cwd: '/tmp',
					ledger: turn,
					ageMs: 90 * M
				}
			]
		})
	});

	await page.goto(`/?sessionKey=e2e-spine-vantage`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	// The spine order (href sessionKeys, top to bottom): the head, then its
	// five children ONE BLOCK (I1), then the stranger — never the wire's
	// interleaved order (head, kid1, kid2, STRANGER, kid3, kid4, kid5).
	await expect
		.poll(async () => {
			const cards = page.getByTestId('sidebar-session-card');
			const keys: string[] = [];
			for (let i = 0; i < await cards.count(); i++) {
				const href = (await cards.nth(i).getAttribute('href')) ?? '';
				keys.push(new URL(href, 'http://e2e').searchParams.get('sessionKey') ?? '');
			}
			return keys;
		})
		.toEqual([
			STUB_SESSION_ID,
			'e2e-spine-kid-0001',
			'e2e-spine-kid-0002',
			'e2e-spine-kid-0003',
			'e2e-spine-kid-0004',
			'e2e-spine-kid-0005',
			'e2e-spine-stranger',
			'e2e-chat-session-0003'
		]);

	// The indent tells the same story: children depth 1 under the head, the
	// stranger depth 0 OUTSIDE the block (the wedge would have read as a
	// 4+1 split family).
	await expect(spineCard(page, 'e2e-spine-kid-0003')).toHaveAttribute('data-depth', '1');
	await expect(spineCard(page, 'e2e-spine-stranger')).toHaveAttribute('data-depth', '0');
});

// ── Spine group (2026-09-01): collapse + name filter + sub-agent toggle ──
// The spine's own collapsible group header: the session-name filter
// (family-aware, D7), its [x] clear, and the sub-agent visibility toggle.
// Everything persists per profile (dsi-spine-group) — a reload restores
// the operator's exact view, filtered list included.

/** The spine's session ids, top to bottom (href sessionKey order). */
async function spineKeys(page: import('@playwright/test').Page): Promise<string[]> {
	const cards = page.getByTestId('sidebar-session-card');
	const keys: string[] = [];
	for (let i = 0; i < (await cards.count()); i++) {
		const href = (await cards.nth(i).getAttribute('href')) ?? '';
		keys.push(new URL(href, 'http://e2e').searchParams.get('sessionKey') ?? '');
	}
	return keys;
}

test('19 · spine group: family-aware name filter, [x] clear, sub-agent toggle — all persisted', async ({ page }) => {
	const M = 60_000;
	// Two sub-agents under the seed head, planted so the head stays OFF the
	// floor (the vantage carries the URL — it needs a ledger, spec-18
	// pattern): the whole family sits in the SPINE, the exact posture the
	// view filters shape. Spine: head block (head + 2 kids) + chat-0003.
	await plantLineage([
		{ sessionId: 'e2e-spine-filter-kid1', title: 'Filter kid alpha', ageMs: 10 * M },
		{ sessionId: 'e2e-spine-filter-kid2', title: 'Second kid beta', ageMs: 15 * M }
	]);
	const turn = [
		{ event: { type: 'turn/start', seq: 21, time: 1787212000011, data: {} } },
		{ event: { type: 'turn/end', seq: 22, time: 1787212000012, data: {} } }
	];
	const state = await (await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`)).json();
	await fetch(`http://127.0.0.1:${STUB_PORT}/__e2e/state`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			extraSessions: [
				...(state.extraSessions ?? []),
				{
					sessionId: 'e2e-spine-filter-vantage',
					title: 'Spine filter vantage',
					agentPreset: 'main',
					cwd: '/tmp',
					ledger: turn,
					ageMs: 90 * M
				}
			]
		})
	});

	await page.goto(`/?sessionKey=e2e-spine-filter-vantage`);
	await expect(page.getByTestId('app-sidebar')).toBeVisible();

	// Defaults: expanded, unfiltered, sub-agents visible. The current
	// session (the vantage) never renders as a spine row; the blank row
	// hides under the default [!0] filter.
	const filter = page.getByTestId('sidebar-spine-filter');
	await expect(filter).toHaveAttribute('placeholder', 'Filter by session name...');
	await expect(page.getByTestId('sidebar-spine-group-toggle')).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByTestId('sidebar-spine-subagents')).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => spineKeys(page)).toEqual([
		STUB_SESSION_ID,
		'e2e-spine-filter-kid1',
		'e2e-spine-filter-kid2',
		'e2e-chat-session-0003'
	]);

	// The name filter is FAMILY-AWARE: matching a child keeps its head and
	// the whole family block; the unrelated root drops out.
	await filter.fill('filter kid');
	await expect.poll(() => spineKeys(page)).toEqual([
		STUB_SESSION_ID,
		'e2e-spine-filter-kid1',
		'e2e-spine-filter-kid2'
	]);

	// The filter is type="search" — the browser owns clearing; emptying
	// the query restores the full list (no [x] button since 2026-09-25).
	await filter.fill('');
	await expect(filter).toHaveValue('');
	await expect(page.getByTestId('sidebar-spine-filter-clear')).toHaveCount(0);
	await expect.poll(() => spineKeys(page)).toEqual([
		STUB_SESSION_ID,
		'e2e-spine-filter-kid1',
		'e2e-spine-filter-kid2',
		'e2e-chat-session-0003'
	]);

	// The sub-agent toggle removes ONLY origin-subagent rows — the head and
	// the plain root stay (children never drag their head away).
	await page.getByTestId('sidebar-spine-subagents').click();
	await expect(page.getByTestId('sidebar-spine-subagents')).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => spineKeys(page)).toEqual([STUB_SESSION_ID, 'e2e-chat-session-0003']);

	// Compose both view filters, then RELOAD: query text, hide state, and
	// the filtered list all survive (dsi-spine-group, per profile).
	await filter.fill('stub conversation');
	await expect.poll(() => spineKeys(page)).toEqual([STUB_SESSION_ID]);
	await page.reload();
	const reloaded = page.getByTestId('sidebar-spine-filter');
	await expect(reloaded).toHaveValue('stub conversation');
	await expect(page.getByTestId('sidebar-spine-subagents')).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => spineKeys(page)).toEqual([STUB_SESSION_ID]);

	// Clear + re-show restore everything (kids return under their head).
	await filter.fill('');
	await page.getByTestId('sidebar-spine-subagents').click();
	await expect.poll(() => spineKeys(page)).toEqual([
		STUB_SESSION_ID,
		'e2e-spine-filter-kid1',
		'e2e-spine-filter-kid2',
		'e2e-chat-session-0003'
	]);

	// Collapse hides the rows pane; the choice persists across a reload.
	await page.getByTestId('sidebar-spine-group-toggle').click();
	await expect(page.getByTestId('sidebar-spine-group-rows')).toHaveCount(0);
	await expect(page.getByTestId('sidebar-spine-group-toggle')).toHaveAttribute('aria-expanded', 'false');
	await page.reload();
	await expect(page.getByTestId('sidebar-spine-group-toggle')).toHaveAttribute('aria-expanded', 'false');
	await expect(page.getByTestId('sidebar-spine-group-rows')).toHaveCount(0);
	await page.getByTestId('sidebar-spine-group-toggle').click();
	await expect(page.getByTestId('sidebar-spine-group-rows')).toBeVisible();
});

// ── Fold map persistence (2026-09-03, ADR The Tree That Remembers) ────
// The family fold map joins dsi-panel-group[_<profile>]: a chevron AND a
// reveal survive a hard reload (D1/D2 — the 14:00/14:05 asymmetry dies),
// restore is a silent hydrate (D6), and each desk keeps its own map (D5).

test('20 · fold map persists: reveal survives a reload, a fold survives, a fork stays open — per desk', async ({
	page
}) => {
	await plantLineage([{ sessionId: 'e2e-fold-kid-0001', title: 'Fold kid' }]);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await openPanelGroup(page);

	// Folded default: the ghost hides. Reveal it, then RELOAD: the family
	// stands open again with no click — the group's own field reopens it
	// too (one blob, two fields).
	await expect(page.getByTestId('sidebar-ghost-row')).toHaveCount(0);
	await revealChildren(page);
	await expect(page.getByTestId('sidebar-ghost-row')).toBeVisible();
	await page.reload();
	await expect(page.getByTestId('sidebar-ghost-row')).toBeVisible();
	expect(await panelGroupSessionIds(page)).toEqual([STUB_SESSION_ID, 'e2e-fold-kid-0001']);

	// Fold it back: the choice persists the other way — after a reload the
	// family stays folded while the group stays open.
	await revealChildren(page);
	await expect(page.getByTestId('sidebar-ghost-row')).toHaveCount(0);
	await page.reload();
	await expect(page.getByTestId('sidebar-panel-group-toggle')).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByTestId('sidebar-ghost-row')).toHaveCount(0);

	// A fork's reveal is IN the desk: fork the head — the child joins the
	// floor and its family auto-reveals (fold-on-add); a reload keeps it
	// open. The auto-reveal persists exactly like a manual chevron.
	await page.getByTestId('fork-button').click();
	await expect(panelRow(page, 'e2e-forked-0001')).toBeVisible();
	await page.reload();
	await expect(panelRow(page, 'e2e-forked-0001')).toBeVisible();

	// Desk switch: the widi desk is its own memory — the same wire family
	// is folded there (nothing carried over in either direction); back on
	// the default desk (bare / — a sessionKey arrival would RE-SEED the
	// floor), the arrangement is exactly as left.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}&profile=widi`);
	await openPanelGroup(page);
	await expect(page.getByTestId('sidebar-ghost-row')).toHaveCount(0);
	await expect(panelRow(page, 'e2e-forked-0001')).toHaveCount(0);
	await page.goto('/');
	await expect(page.getByTestId('sidebar-ghost-row')).toBeVisible();
	await expect(panelRow(page, 'e2e-forked-0001')).toBeVisible();
});

test('21 · about dialog: the circled-A trigger portals the box — title, credit, link, Escape dismisses', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('sidebar-about-trigger')).toBeVisible();
	await page.getByTestId('sidebar-about-trigger').click();

	// The portaled about box: title (h1), pitch (h2), credit, author link.
	const dialog = page.getByRole('dialog', { name: 'About Deepseek Insight' });
	await expect(dialog).toBeVisible();
	await expect(page.getByTestId('about-title')).toHaveText('DEEPSEEK INSIGHT');
	await expect(page.getByTestId('about-subtitle')).toHaveText('Getting Insight of Deepseek Harness');
	await expect(page.getByTestId('about-credit')).toHaveText(
		'Created by: Widi Harsojo (c) 2026 - Apache License'
	);
	await expect(page.getByTestId('about-link')).toHaveAttribute(
		'href',
		'https://www.linkedin.com/in/wharsojo/'
	);

	// Escape dismisses; the portal host unmounts with the dialog.
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(page.getByTestId('about-title')).toHaveCount(0);
});


