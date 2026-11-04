/**
 * terminal-zoom-selection.spec (ADR-0041 Amendment 3 — the terminal pocket)
 *
 * The operator's bug: on a zoomed floor, xterm text selection grabbed the
 * wrong rows — selecting the last row landed 3+ rows higher. The pocket
 * (scale(1/zoom) wrapper at inset-0) makes the terminal's coordinate space
 * net-1, so THE SAME VISUAL DRAG must select THE SAME TEXT at zoom 1 and
 * zoom 0.9. That equivalence is the pin: pre-fix, the zoomed drag maps
 * cells through the row's transform and diverges near the bottom.
 *
 * Reuses terminal.spec's seams: the run's disposable settings.yaml flag,
 * the DSH stub host, and a real PTY.
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
	writeFileSync(
		configPath,
		'home:\n  refreshMs: 1000\nterminal:\n  enabled: ' + (enabled ? 'true' : 'false') + '\n',
		'utf-8'
	);
}

/** Drag-select the BOTTOM rows (the operator's repro: drift accumulates
 *  toward the viewport bottom) and return xterm 6's OWN
 *  selection geometry (the .xterm-selection layer rects) — xterm 6 paints
 *  selection without a native DOM selection, so getSelection() is empty by
 *  design. The rect is in POCKET-LOCAL px, so the same visual drag must
 *  paint the SAME rect at zoom 1 and zoom 0.9 (the pocket pin: pre-fix,
 *  the zoomed drag maps through the row transform and lands rows high). */
interface PocketSelection {
	top: number;
	cellHeight: number;
	rowIndex: number;
	bottomIndex: number;
}

async function dragRows(page: import('@playwright/test').Page): Promise<PocketSelection | null> {
	const box = (await page.getByTestId('terminal-host').boundingBox()) as {
		x: number;
		y: number;
		width: number;
		height: number;
	};
	const x = box.x + 60;
	await page.mouse.move(x, box.y + box.height - 14);
	await page.mouse.down();
	await page.mouse.move(x, box.y + box.height - 46, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(200);
	return page.evaluate(() => {
		const first = document.querySelector('.xterm-selection > div') as HTMLElement | null;
		if (!first) return null;
		const top = parseFloat(first.style.top);
		const rows = document.querySelectorAll('.xterm-rows > div');
		const firstRow = rows[0] as HTMLElement | undefined;
		const cellHeight = firstRow ? firstRow.offsetHeight : 0;
		const rowIndex = Math.round((top / cellHeight) * 100) / 100;
		// Bottom-relative: a different fontSize fits a different total row
		// count, so the invariant is rows-from-the-bottom, not raw index.
		return { top, cellHeight, rowIndex, bottomIndex: rows.length - rowIndex };
	});
}

test('selection at zoom 0.9 selects the same rows as zoom 1 (the pocket pin)', async ({ page }) => {
	test.setTimeout(90_000);
	writeConfig(true);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible();
	const input = page.locator('textarea').first();
	await input.fill('/dsi-terminal');
	await input.press('Enter');
	await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });

	await page.getByTestId('terminal-host').click();
	// Content rows so the drag crosses real text rows.
	await page.keyboard.type('for i in $(seq 1 80); do echo POCKET-$i; done');
	await page.keyboard.press('Enter');
	await expect(page.getByTestId('terminal-host')).toContainText('POCKET-80', { timeout: 15_000 });

	// Baseline: zoom 1 — the rect must start on an exact cell boundary.
	const atZoom1 = await dragRows(page);
	expect(atZoom1).not.toBeNull();
	expect(atZoom1!.top % atZoom1!.cellHeight).toBeLessThan(1);

	// Clear, zoom to 0.9 (the ControlBar slider — one clamp site), re-drag
	// the SAME visual box. The pocket cancels the row transform, so the
	// selected text must match the zoom-1 baseline.
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	// Zoom via the ControlBar tray (manager-panel.spec idiom).
	await page.getByTestId('controlbar-trigger').click();
	await page.getByTestId('controlbar-tray').waitFor({ state: 'visible' });
	await page.getByTestId('controlbar-slider-zoom-input').fill('0.9');
	await page.keyboard.press('Escape'); // close the tray
	await page.waitForTimeout(400); // one settle: pocket style + fontSize refit
	await expect
		.poll(async () => {
			const row = page.locator('[data-testid="panels-row"]');
			return (await row.getAttribute('style')) ?? '';
		}, { timeout: 5_000 })
		.toContain('0.9');

	const atZoom09 = await dragRows(page);
	expect(atZoom09).not.toBeNull();
	// The pocket pin: at zoom 0.9 the same visual drag still lands on an
	// EXACT cell boundary at the SAME row index. Pre-fix, the row transform
	// skewed the mapping and the drag grabbed rows above the cursor
	// (same rows-from-the-bottom at both zooms).
	expect(atZoom09!.top % atZoom09!.cellHeight).toBeLessThan(1);
	expect(atZoom09!.bottomIndex).toBe(atZoom1!.bottomIndex);
});
