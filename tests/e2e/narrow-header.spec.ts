/**
 * E2E: narrow-column icon-only header (2026-11-05, ADR-0029 amendment A8).
 *
 * The container query cannot be evaluated in jsdom (vitest) — it needs a real
 * layout engine. This spec drives the real app against the stub DSH host
 * (browser-strip pattern: localStorage-seeded conversation panel) and proves,
 * at computed-style level:
 *   1. wide column (600px): the chip label and pill text are visible
 *   2. narrow column (400px < 530px): both .narrow-hide spans display:none —
 *      the Globe icon and the state dot remain
 *   3. testids survive at both widths; the query is live both ways
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

async function setColumnWidth(page: import('@playwright/test').Page, px: number): Promise<void> {
	await page.evaluate((w) => {
		const col = document.querySelector('[data-testid="panel-column"]') as HTMLElement | null;
		if (!col) throw new Error('panel-column not found');
		col.style.setProperty('width', w + 'px');
		col.style.setProperty('min-width', w + 'px');
		col.style.setProperty('max-width', w + 'px');
	}, px);
}

test('below 530px the chip label and pill text hide; above they show', async ({ page }) => {
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
	await expect(page.getByTestId('transcript')).toBeVisible({ timeout: 20_000 });

	const chip = page.getByTestId('open-browser');
	await expect(chip).toBeVisible();
	const pill = page.getByTestId('running-status');
	await expect(pill).toBeVisible();

	// WIDE (600px): label + text visible; icon + dot present.
	await setColumnWidth(page, 600);
	await expect(chip.locator('svg')).toBeVisible();
	await expect(chip.locator('.narrow-hide')).toBeVisible();
	await expect(pill.locator('.narrow-hide')).toBeVisible();
	await expect(pill.locator('.narrow-hide')).toHaveText('idle');

	// NARROW (400px): text spans collapse; icon + dot remain; testids stay.
	await setColumnWidth(page, 400);
	await expect(chip.locator('.narrow-hide')).toHaveCSS('display', 'none');
	await expect(pill.locator('.narrow-hide')).toHaveCSS('display', 'none');
	await expect(chip).toBeVisible();
	await expect(chip.locator('svg')).toBeVisible();
	await expect(pill).toBeVisible();

	// Back wide: the text returns (the query is live, not one-way).
	await setColumnWidth(page, 600);
	await expect(chip.locator('.narrow-hide')).toBeVisible();
});
