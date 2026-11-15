import { expect, test } from '@playwright/test';

/**
 * W3 3.4 (ADR-0063 D3) — the locale survives a hard reload at FIRST PAINT:
 * paraglide's SSR chain reads the dsi.locale cookie, so <html lang=...>
 * in the initial HTML is the pre-hydration truth. The base store dual-
 * wrote that cookie (base mirrors, paraglide reads — the risk-register
 * contract).
 */

const SLOW_LOAD = { waitUntil: 'domcontentloaded' } as const;
// navigate early, then wait for hydration: clicks before the bundle mounts are lost
const gotoLoaded = async (page: import('@playwright/test').Page, url: string): Promise<void> => {
	await page.goto(url, SLOW_LOAD);
	await page.waitForLoadState('load').catch(() => {});
};

test('zh survives a reload — cookie dual-write + SSR first-paint lang', async ({ page }) => {
	test.setTimeout(90000); // the DSI 'load' event is slow (heavy chunks); 30s default is too tight for goto+clicks+reload
	await gotoLoaded(page, '/');
	await page.getByTestId('language-menu-trigger').click();
	await page.getByTestId('locale-option-zh').click();
	await page.waitForFunction(() => document.cookie.includes('dsi.locale=zh'));
	// NOTE: html lang is SSR-rendered — it only flips on the NEXT render;
	// the no-reload contract (D2) means it stays 'en' until the reload below.

	// hard reload — lang must be zh in the SSR HTML (first paint, no flash)
	await page.reload(SLOW_LOAD); // the reload asserts the SSR-rendered html lang
	await page.waitForLoadState('load').catch(() => {});
	expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh');
	expect(await page.evaluate(() => document.cookie)).toContain('dsi.locale=zh');
});

test('profile-scoped storage: profile b keeps its own locale mirror', async ({ page }) => {
	await gotoLoaded(page, '/?profile=b');
	await page.getByTestId('language-menu-trigger').click();
	await page.getByTestId('locale-option-id').click();
	await page.waitForFunction(() => localStorage.getItem('dsi.locale_b') === 'id');
	// the bare legacy key (other desks / verbatim blob rule) stays untouched
	expect(await page.evaluate(() => localStorage.getItem('dsi.locale'))).toBeNull();
});