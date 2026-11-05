/**
 * terminal-font-slider.spec (ADR-0041 Amendment 4 — the terminal font knob)
 *
 * The operator's ask: a slider in the settle-badge header row changes the
 * terminal's base font; the choice survives a reload (the dsi-panels floor
 * blob), and zoom composes ON TOP (the preference is a NUMBER, zoom the
 * MULTIPLIER). Reuses terminal.spec's seams: the run's disposable
 * settings.yaml flag, the DSH stub host, and a real PTY.
 */
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // playwright.config wires DSH_BASE_URL to this port
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const configPath = process.env.DSI_CONFIG_PATH ?? '';

function writeConfig(enabled: boolean): void {
	writeFileSync(configPath, 'home:\n  refreshMs: 1000\nterminal:\n  enabled: ' + (enabled ? 'true' : 'false') + '\n', 'utf-8');
}

/** The glyph-size DOM truth is the ROW PITCH (cell height): the gap
 *  between the first two rendered row divs. rowsHeight is useless here —
 *  fit() sizes the rows block to the container, so its height stays
 *  ~constant across a font change while the pitch grows. */
async function rowPitch(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(() => {
		const rows = document.querySelectorAll('.xterm-rows > div');
		if (rows.length < 2) return 0;
		const a = rows[0].getBoundingClientRect().top;
		const b = rows[1].getBoundingClientRect().top;
		return b - a;
	});
}

test.describe('flag on (operator opted in)', () => {
	test('font slider resizes glyphs, persists across reload, sits in the badge row', async ({ page }) => {
		test.setTimeout(60_000);
		writeConfig(true);
		await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
		await expect(page.getByTestId('access-mode-chip')).toBeVisible();
		const input = page.locator('textarea').first();
		await input.fill('/dsi-terminal');
		await input.press('Enter');
		await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });

		const slider = page.getByTestId('terminal-font-slider');
		await expect(slider).toBeVisible({ timeout: 20_000 });
		// RIGHT-ALIGN placement: the slider sits after the grow spacer in
		// the settle-badge row — assert the readout exists beside it.
		await expect(page.getByTestId('terminal-font-slider-readout')).toBeVisible();

		await page.getByTestId('terminal-host').click();
		await page.keyboard.type('echo dsi-font-ready');
		await page.keyboard.press('Enter');
		await expect.poll(async () => rowPitch(page), { timeout: 20_000 }).toBeGreaterThan(0);
		const before = await rowPitch(page);

		// Drag the base font 12 -> 16 (band 8-20, step 1).
		await slider.fill('16');
		await expect(page.getByTestId('terminal-font-slider-readout')).toHaveText('16px');
		await expect.poll(async () => rowPitch(page), { timeout: 20_000 }).toBeGreaterThan(before);

		// Persistence: the floor blob carries the value; a reload restores it.
		const stored = await page.evaluate(() => {
			const raw = localStorage.getItem('dsi-panels');
			return raw ? (JSON.parse(raw) as { termFontSize?: number }).termFontSize : undefined;
		});
		expect(stored).toBe(16);
		await page.reload();
		await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('terminal-font-slider-readout')).toHaveText('16px', { timeout: 20_000 });
		const after = await rowPitch(page);
		expect(after).toBeGreaterThan(before);
	});
});
