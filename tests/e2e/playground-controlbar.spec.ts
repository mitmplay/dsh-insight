import { type ChildProcess, spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';

// R10 W3 3.2 (ADR-0073) — the playground tray e2e: the second consumer
// proof on a real floor. Own dev server on 5178 (the e2e stack owns
// 5176 for the DSI preview; the survival matrix owns 5177).

const PG_PORT = 5178;
const PG = 'http://localhost:' + PG_PORT;

let pgServer: ChildProcess | null = null;

test.beforeAll(async () => {
	pgServer = spawn('npx', ['vite', 'dev', '--port', String(PG_PORT), '--strictPort'], {
		cwd: 'packages/container-base/playground',
		stdio: 'ignore',
		detached: false
	});
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(PG);
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error('playground dev server failed to boot on ' + PG_PORT);
});

test.afterAll(async () => {
	pgServer?.kill();
	await new Promise((r) => setTimeout(r, 500));
});

async function openTray(page: import('@playwright/test').Page) {
	await page.goto(PG, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle'); // hydration gate (R9 lesson: a click before listeners attach fires once into the void)
	const trigger = page.getByTestId('pg-controlbar-trigger');
	await expect(trigger).toBeVisible({ timeout: 20000 });
	trigger.click(); // click implies hydration (the R9 lesson: hover before hydration lands on unwired handlers)
	const trayFloat = page.locator('.tray-float');
	await expect(page.getByTestId('pg-controlbar-tray')).toBeVisible({ timeout: 10000 });
	return trayFloat;
}

test.describe('playground tray (R10 W3)', () => {
	test('open tray, move the zoom slider, the floor zoom follows', async ({ page }) => {
		const trayFloat = await openTray(page);
		const zoomInput = trayFloat.locator('[data-testid="pg-controlbar-slider-zoom-input"]');
		await expect(zoomInput).toBeVisible();
		const before = Number(await zoomInput.inputValue());
		await zoomInput.fill(String(Math.max(before - 0.1, 0.25)));
		const after = Number(await zoomInput.inputValue());
		expect(after).not.toBe(before);
		// the zoomed ROW carries --zoom (PanelsZoom writes it on the row)
		const zoomVar = await page.evaluate(() => (document.querySelector('[data-testid="panels-row"]') as HTMLElement)?.style.getPropertyValue('--zoom').trim() ?? '');
		expect(Number(zoomVar)).toBeCloseTo(after, 2);
	});

	test('reload: the tray is ephemeral — closed after reload, no pg tray keys', async ({ page }) => {
		await openTray(page);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.getByTestId('pg-controlbar')).toBeVisible({ timeout: 20000 });
		// ssr=false remounts under a PARKED cursor — the browser fires
		// mouseenter for content reappearing under a static pointer, so the
		// tray legitimately reopens; move the pointer off the gear and let
		// the 250ms grace land before asserting closure.
		await page.mouse.move(5, 5);
		await page.waitForTimeout(450);
		await expect(page.getByTestId('pg-controlbar-tray')).toHaveCount(0);
		const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pg-tray') || k.includes('tray')));
		expect(keys.filter((k) => k.includes('controlbar'))).toEqual([]);
	});

test('reload: FIRST paint is the saved selection (no default flash, ssr=false)', async ({ page }) => {
	await page.goto(PG, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle');
	// promote Scheduler (the 2nd row) so the saved desk selects it
	const row = page.getByTestId('pg-tray-resting-scheduler');
	await row.click();
	await page.waitForTimeout(300);
	await page.reload({ waitUntil: 'domcontentloaded' });
	// NO default flash: at the moment the FIRST pane appears, the floor
	// must already be the saved desk (a default flash would render 1 pane).
	await page.waitForSelector('.pane-body');
	const paneCount = await page.evaluate(() => document.querySelectorAll('.pane-body').length);
	expect(paneCount).toBe(2);
	// the SELECTION is the promoted row (not the demo-order first pane)
	const selected = await page.evaluate(() => localStorage.getItem('pg-panels')).then((s) => JSON.parse(s ?? '{}').selectedPanelId);
	expect(selected).toBe('scheduler');
});
});
