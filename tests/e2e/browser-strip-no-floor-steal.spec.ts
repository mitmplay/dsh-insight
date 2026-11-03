/**
 * E2E regression (2026-10-28 operator bug, ADR "The Mirror Must Face a
 * Living Tab"): the Glass tab strip's active-tab reveal used
 * scrollIntoView, whose ancestor walk reached the floor's panels-viewport
 * and YANKED the floor scroll — the focused session left view ~1.3s after
 * every selection-follow (the 2s tabs poll re-fired it). Fix commit
 * cd276e13: strip-local scrollLeft on active-tab change only.
 *
 * Stock lane (chip-spawned disposable glass — browser-panel.spec pattern;
 * on the glass lane a chip-open would re-home our own tab away).
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // playwright.config points DSH_BASE_URL here
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

test.setTimeout(120_000); // real glass tab births are one POST at a time

test('strip poll does not steal the floor scroll from the selection-follow', async ({ page }) => {
	// A WIDE focused conversation panel: the chip-opened Glass lands clipped
	// at the viewport's right edge — its strip chips sit outside the floor
	// viewport, the geometry where the old code yanked the floor.
	await page.addInitScript(
		(sid) => {
			localStorage.setItem(
				'dsi-panels',
				JSON.stringify({
					panels: [
						{ id: 'panel-a', kind: 'conversation', sessionId: sid, agentPreset: 'ptc', width: 900 }
					],
					selectedPanelId: 'panel-a',
					panelWidth: 900,
					zoom: 1,
					treePct: 30
				})
			);
		},
		STUB_SESSION_ID
	);
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await expect(page.getByTestId('panels-viewport')).toBeVisible({ timeout: 20_000 });

	// Chip-open the Glass — the operator's flow; spawns a disposable session
	// bound to this run (browser-panel.spec pattern).
	await page.getByTestId('open-browser').click();
	await expect(page.getByTestId('panel-browser')).toBeVisible({ timeout: 20_000 });

	// Overflow the strip: newborn tabs are auto-followed, so the ACTIVE chip
	// is the LAST one — the chip the old code demanded floor scrolls for.
	const strip = page.getByTestId('browser-tab-strip');
	await expect(strip.getByTestId('browser-tab')).toHaveCount(1, { timeout: 30_000 });
	for (let i = 0; i < 5; i++) {
		await page.getByTestId('browser-tab-new').click();
	}
	await expect(strip.getByTestId('browser-tab')).toHaveCount(6);

	// Focus the conversation column: selection-follow reveals it.
	const column = page.locator('[data-testid="panel-column"][data-session-id="' + STUB_SESSION_ID + '"]');
	await column.locator('[data-testid="panel-header"]').click();
	const viewport = page.getByTestId('panels-viewport');
	await expect
		.poll(
			async () => {
				const vp = await viewport.boundingBox();
				const col = await column.boundingBox();
				if (!vp || !col) return false;
				return col.x >= vp.x - 1 && col.x + col.width <= vp.x + vp.width + 1;
			},
			{ timeout: 10_000 }
		)
		.toBe(true);
	const slAfterReveal = await viewport.evaluate((el) => el.scrollLeft);

	// THE CONTRACT: survive at least two strip polls (2s cadence) — the old
	// code's scrollIntoView yanked the floor within ~1.3s of a poll tick.
	await page.waitForTimeout(6_000);
	const slAfterPolls = await viewport.evaluate((el) => el.scrollLeft);
	const vp = await viewport.boundingBox();
	const col = await column.boundingBox();
	// The contract is NO YANK (the old bug moved the floor hundreds of px to
	// the Glass panel). PanelsZoom's own ring math may self-settle up to the
	// ring width (4px x zoom — the .panels-row padding) — that is a reveal,
	// not a steal.
	const ring = 4; // zoom 1
	expect(Math.abs(slAfterPolls - slAfterReveal), 'floor drift beyond the ring = a steal').toBeLessThanOrEqual(ring);
	expect(col!.x).toBeGreaterThanOrEqual(vp!.x - 1);
	expect(col!.x + col!.width).toBeLessThanOrEqual(vp!.x + vp!.width + 1);
});
