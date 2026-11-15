import { expect, test } from '@playwright/test';

/**
 * W2 2.4 (ADR-0063 D2) — the theme survives a hard reload with NO flash:
 * html[data-theme] must be set at FIRST PAINT (during HTML parse, by the
 * base applier inline script), not after hydration.
 *
 * Deviation note (recorded in Wave 2 completion notes): the spec lives in
 * its own file, not as a row in panel-floor.spec.ts — the floor spec is
 * the floor's regression gate; survival rows are a new R2 surface.
 */

// FIRST-PAINT capture: an init script runs before ANY page script (incl.
// the inline applier). MutationObserver callbacks are microtasks — they
// fire during the parse, BEFORE first paint. Never poll from an init
// script: a microtask recursion starves the event loop and navigation
// never reaches load (2026-11-14 first-draft finding).
const captureFirstPaint = async (page: import('@playwright/test').Page, url: string, seed?: { key: string; value: string }) => {
	await page.addInitScript(
		({ seed }) => {
			if (seed) {
				try {
					localStorage.setItem(seed.key, seed.value);
				} catch {}
			}
			(window as unknown as { __firstPaintTheme?: string }).__firstPaintTheme = undefined;
			const mo = new MutationObserver(() => {
				const el = document.documentElement;
				if (el && el.dataset.theme) {
					(window as unknown as { __firstPaintTheme?: string }).__firstPaintTheme = el.dataset.theme;
					mo.disconnect();
				}
			});
			mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme'] });
		},
		{ seed }
	);
	await page.goto(url);
};

test('dark survives a reload with no flash — first-paint data-theme (base applier)', async ({ page }) => {
	// set the choice through the real lamp UI
	await page.goto('/');
	await page.getByTestId('theme-toggle-trigger').click();
	await page.getByTestId('theme-option-dark').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.waitForFunction(() => localStorage.getItem('dsi-theme') === 'dark');

	// hard reload — the choice must be painted BEFORE hydration
	await captureFirstPaint(page, '/');
	expect(await page.evaluate(() => (window as unknown as { __firstPaintTheme?: string }).__firstPaintTheme)).toBe('dark');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('profile-scoped keys: profile b keeps its own choice, never sees profile a', async ({ page }) => {
	// desk A (no profile) is dark
	await captureFirstPaint(page, '/', { key: 'dsi-theme', value: 'dark' });
	expect(await page.evaluate(() => (window as unknown as { __firstPaintTheme?: string }).__firstPaintTheme)).toBe('dark');

	// desk B (?profile=b) stays light with its own key
	const b = await page.context().newPage();
	await captureFirstPaint(b, '/?profile=b', { key: 'dsi-theme_b', value: 'light' });
	expect(await b.evaluate(() => (window as unknown as { __firstPaintTheme?: string }).__firstPaintTheme)).toBe('light');
	await b.close();

	// and A is still dark after another reload
	await captureFirstPaint(page, '/');
	expect(await page.evaluate(() => (window as unknown as { __firstPaintTheme?: string }).__firstPaintTheme)).toBe('dark');
});