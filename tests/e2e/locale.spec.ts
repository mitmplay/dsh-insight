/**
 * E2E: locale switching — Three Tongues W2 task 2.4 + W4 4.1 seed
 * (ADR 2026-09-12, D2/D3). Runs the REAL built app over the stub DSH
 * host (same stack as the other lanes).
 *
 * AC2: switching to id in the header menu updates the trigger label and
 *      persists the dsi.locale cookie — with NO navigation (a page
 *      reload would tear down the live DSH stream, D2's rejection).
 * AC3: a fresh load with the cookie keeps the choice (resolver row 1).
 *
 * Selectors verified in component source (Step 3.8): language-menu,
 * language-menu-trigger, locale-option-* (LanguageMenu.svelte).
 * The menu list is shown by hovering the trigger (CSS-only dropdown).
 */
// glass-reroutable fixtures: DSI_E2E_GLASS_CDP_URL runs these tests in the
// LIVE BrowserManager glass (registry.ts launch), otherwise stock Playwright
import { expect, test } from './fixtures/glass-browser';

test.describe('locale switching', () => {
	test('switch to id in the header: label flips, cookie set, no navigation', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByTestId('language-menu-trigger')).toBeVisible();

		let navigated = false;
		page.on('framenavigated', () => {
			navigated = true;
		});

		const initialLang = await page.evaluate(() => document.documentElement.lang);
		expect(initialLang.length).toBeGreaterThan(0);

		await page.getByTestId('language-menu-trigger').click();
		await page.getByTestId('locale-option-id').click();

		// trigger shows the active locale (LanguageMenu source)
		await expect(page.getByTestId('language-menu-trigger')).toContainText('id');
		// AND a real body label flips INSTANTLY (t(m.x) reactive seat —
		// the 're-renders instantly' regression proof)
		await expect(page.getByTestId('workspace-empty')).toContainText(
			'Tidak ada percakapan terbuka.'
		);
		expect(navigated).toBe(false);
		expect(await page.evaluate(() => document.cookie)).toContain('dsi.locale=id');
	});

	test('reload keeps the choice (AC3 — cookie wins the resolution order)', async ({ page }) => {
		await page.goto('/');
		await page.getByTestId('language-menu-trigger').click();
		await page.getByTestId('locale-option-zh').click();
		await expect(page.getByTestId('language-menu-trigger')).toContainText('zh');

		await page.reload();
		await expect(page.getByTestId('language-menu-trigger')).toContainText('zh');
		expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh');
	});
});
