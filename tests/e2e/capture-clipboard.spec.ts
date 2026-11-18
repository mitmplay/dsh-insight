import { expect, test } from '@playwright/test';

/**
 * The gesture gate that was owed since R6 (RCA 2026-11-19 — The Capture
 * Button That Loaded Nothing): an ACTUAL click on a CanvasCopyButton must
 * end in an image on the clipboard. The old gates verified chrome and
 * bindings while the engine import failed in the browser — a silent no-op.
 * Grants clipboard permissions in the test context so no permission
 * prompt blocks the assertion.
 */
test('controlbar floor capture click writes a PNG to the clipboard', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5175' });
	await page.goto('/');
	// The sidebar-header copy button is always present (expanded rail header
	// action cluster) — the floor capture needs an open panel, which a fresh
	// profile does not have.
	const btn = page.locator('.rail-header-actions [data-testid="canvas-copy-button"]');
	await expect(btn).toBeVisible();

	// Prove the write, not just the absence of failure: instrument
	// clipboard.write BEFORE the click (no permission needed) and record
	// the blob types the button hands to the clipboard.
	await page.evaluate(() => {
		(window as unknown as { __capWrites: { type: string }[] }).__capWrites = [];
		const orig = navigator.clipboard.write.bind(navigator.clipboard);
		navigator.clipboard.write = async (items) => {
			const rec = (window as unknown as { __capWrites: { type: string }[] }).__capWrites;
			for (const item of items) {
				for (const type of item.types) rec.push({ type });
			}
			return orig(items);
		};
	});

	const errors: string[] = [];
	page.on('pageerror', (err) => errors.push('pageerror: ' + String(err).slice(0, 200)));
	page.on('console', (m) => {
		if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 200));
	});

	await btn.click();

	// The busy spinner must eventually clear (capture finished or degraded).
	await expect(page.locator('.rail-header-actions svg.ccb-spin')).toHaveCount(0, { timeout: 30_000 });

	const writes = await page.evaluate(() => (window as unknown as { __capWrites: { type: string }[] }).__capWrites);
	if (!writes.some((w) => w.type === 'image/png')) {
		console.log('CAPTURE DEBUG — writes:', JSON.stringify(writes), 'errors:', JSON.stringify(errors));
	}
	expect(writes.some((w) => w.type === 'image/png')).toBe(true);
});
