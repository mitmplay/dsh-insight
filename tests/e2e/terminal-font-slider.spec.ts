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

		// Persistence (ADR-0083 D2): the desk mirror carries the ROW's own
		// fontPx; the legacy floor field stays untouched at its seed value.
		const stored = await page.evaluate(() => {
			const raw = localStorage.getItem('dsi-panels');
			if (!raw) return undefined;
			const blob = JSON.parse(raw) as {
				termFontSize?: number;
				panels?: Array<{ kind: string; desk?: { tabs?: Array<{ fontPx?: number; rowFonts?: number[] }> } }>;
			};
			const deskPanel = blob.panels?.find((p) => p.kind === 'terminal');
			const tab = deskPanel?.desk?.tabs?.[0];
			return { legacy: blob.termFontSize, rowFont: tab?.fontPx ?? tab?.rowFonts?.[0] };
		});
		expect(stored?.legacy).toBe(12);
		expect(stored?.rowFont).toBe(16);
		await page.reload();
		await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('terminal-font-slider-readout')).toHaveText('16px', { timeout: 20_000 });
		const after = await rowPitch(page);
		expect(after).toBeGreaterThan(before);
	});
});

test.describe('flag on — per-pane fonts (ADR-0083 D5)', () => {
	test('split desk: pane 1\'s slider controls pane 1 only; each pane\'s font survives a reload', async ({ page }) => {
		test.setTimeout(120_000);
		writeConfig(true);
		await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
		await expect(page.getByTestId('access-mode-chip')).toBeVisible();
		const input = page.locator('textarea').first();
		await input.fill('/dsi-terminal');
		await input.press('Enter');
		await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });
		// Split-down stacks a second shell under the selected tab — two
		// panes, each with its own slider + readout.
		await input.fill('/dsi-terminal --split-down');
		await input.press('Enter');
		const slider1 = page.getByTestId('terminal-font-slider').nth(1);
		await expect(slider1).toBeVisible({ timeout: 30_000 });
		const slider0 = page.getByTestId('terminal-font-slider').nth(0);
		const readout0 = page.getByTestId('terminal-font-slider-readout').nth(0);
		const readout1 = page.getByTestId('terminal-font-slider-readout').nth(1);
		await expect(readout0).toHaveText('12px');
		await expect(readout1).toHaveText('12px');

		// (a) Independence: drag pane 1 — pane 2's readout never moves.
		await slider0.fill('16');
		await expect(readout0).toHaveText('16px');
		await expect(readout1).toHaveText('12px');
		// And pane 2's own slider still writes only pane 2.
		await slider1.fill('10');
		await expect(readout1).toHaveText('10px');
		await expect(readout0).toHaveText('16px');

		// (b) Reload: each pane restores its OWN font — no global fallback.
		await page.reload();
		await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('terminal-font-slider-readout').nth(0)).toHaveText('16px', { timeout: 30_000 });
		await expect(page.getByTestId('terminal-font-slider-readout').nth(1)).toHaveText('10px', { timeout: 30_000 });
	});

	test('legacy boot: a mirror row without fontPx seeds ONCE from the old global', async ({ page }) => {
		test.setTimeout(120_000);
		writeConfig(true);
		await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
		await expect(page.getByTestId('access-mode-chip')).toBeVisible();
		const input = page.locator('textarea').first();
		await input.fill('/dsi-terminal');
		await input.press('Enter');
		await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });
		const slider = page.getByTestId('terminal-font-slider');
		await expect(slider).toBeVisible({ timeout: 20_000 });

		// Manufacture the legacy shape: the desk mirror's row forgets its
		// fontPx; the floor-global keeps the old value 15.
		await page.evaluate(() => {
			const raw = localStorage.getItem('dsi-panels');
			if (!raw) throw new Error('no dsi-panels blob');
			const blob = JSON.parse(raw) as {
				termFontSize?: number;
				panels?: Array<{ kind: string; desk?: { tabs?: Array<{ fontPx?: number; rowFonts?: number[] }> } }>;
			};
			blob.termFontSize = 15;
			for (const p of blob.panels ?? []) {
				if (p.kind !== 'terminal' || !p.desk) continue;
				for (const tab of p.desk.tabs ?? []) {
					delete tab.fontPx;
					delete tab.rowFonts;
				}
			}
			localStorage.setItem('dsi-panels', JSON.stringify(blob));
		});
		await page.reload();
		await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });
		// The row boots at the OLD global value — the one-shot seed.
		await expect(page.getByTestId('terminal-font-slider-readout')).toHaveText('15px', { timeout: 30_000 });
	});
});
