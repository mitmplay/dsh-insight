import { type ChildProcess, spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * W7 7.1 (ADR-0063 D7) — the cross-app hard-reload survival matrix per
 * the W1 instrument decision (matrix-instrument.md): same origin, two
 * workspace profiles. The playground boots on 5177 (the e2e stack owns
 * 5176 for the DSI preview — the W1-flagged collision); the cross-app
 * rows therefore run across ORIGINS too, so their isolation asserts the
 * stronger fact — disjoint KEY NAMES (dsi-* vs pg-*) — while the
 * same-origin namespacing grammar is proven by DSI profile a vs b.
 *
 * FIRST-PAINT assertions: html[data-theme] / <html lang> are set during
 * the HTML parse (base applier / paraglide SSR) — captured pre-hydration.
 */

const PG_PORT = 5177;
const PG = 'http://localhost:' + PG_PORT;

let pgServer: ChildProcess | null = null;

test.beforeAll(async () => {
	pgServer = spawn('npx', ['vite', 'dev', '--port', String(PG_PORT), '--strictPort'], {
		cwd: 'packages/container-base/playground',
		stdio: 'ignore',
		detached: false
	});
	// wait for the dev server to answer
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

/** Pre-paint capture: MutationObserver microtasks fire during parse,
 *  before first paint (never poll from an init script — starvation). */
async function withFirstPaint(page: import('@playwright/test').Page, url: string, seed?: { key: string; value: string }) {
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
	await page.goto(url, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('load').catch(() => {});
}

/** Open a menu robustly across hydration: click, wait briefly, retry. */
async function openMenu(page: import('@playwright/test').Page, triggerId: string, optionId: string): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await page.getByTestId(triggerId).click();
		try {
			await page.getByTestId(optionId).waitFor({ state: 'visible', timeout: 1500 });
			return;
		} catch {
			// pre-hydration click lost — retry
		}
	}
	throw new Error('menu never opened: ' + optionId);
}

const firstPaintTheme = (page: import('@playwright/test').Page) =>
	page.evaluate(() => (window as unknown as { __firstPaintTheme?: string }).__firstPaintTheme);

test.describe('survival matrix — theme x app x reload', () => {
	test('DSI profile a: dark survives reload at first paint (dsi-theme_a)', async ({ page }) => {
		await withFirstPaint(page, 'http://127.0.0.1:5176/?profile=a', { key: 'dsi-theme_a', value: 'dark' });
		expect(await firstPaintTheme(page)).toBe('dark');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		expect(await page.evaluate(() => localStorage.getItem('dsi-theme_a'))).toBe('dark');
	});

	test('DSI profile b: light survives on the SAME origin — namespacing proof', async ({ page }) => {
		await withFirstPaint(page, 'http://127.0.0.1:5176/?profile=b', { key: 'dsi-theme_b', value: 'light' });
		expect(await firstPaintTheme(page)).toBe('light');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		// profile a's choice did not leak into b's desk
		expect(await page.evaluate(() => localStorage.getItem('dsi-theme_a'))).toBeNull();
	});

	test('playground: dark survives reload at first paint (pg-theme, own key)', async ({ page }) => {
		await withFirstPaint(page, PG, { key: 'pg-theme', value: 'dark' });
		expect(await firstPaintTheme(page)).toBe('dark');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		// and the DSI key namespace is absent in the playground origin
		expect(await page.evaluate(() => localStorage.getItem('dsi-theme'))).toBeNull();
		expect(await page.evaluate(() => localStorage.getItem('dsi-theme_a'))).toBeNull();
	});
});

test.describe('survival matrix — locale x app x reload', () => {
	// the DSI 'load' is slow (~20s) and the playground dev-compiles on first hit
	test.setTimeout(120000);
	test('DSI: zh survives reload — SSR lang at first paint (dsi.locale cookie)', async ({ page }) => {
		await page.goto('http://127.0.0.1:5176/', { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load').catch(() => {});
		await openMenu(page, 'language-menu-trigger', 'locale-option-zh');
		await page.getByTestId('locale-option-zh').click();
		await page.waitForFunction(() => document.cookie.includes('dsi.locale=zh'));
		await page.reload({ waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load').catch(() => {});
		expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh');
		expect(await page.evaluate(() => document.cookie)).toContain('dsi.locale=zh');
	});

	test('playground: id survives reload via its OWN cookie (pg.locale) — cross-app locale independence', async ({ page }) => {
		await page.goto(PG, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load').catch(() => {});
		await openMenu(page, 'language-menu-trigger', 'locale-option-id');
		await page.getByTestId('locale-option-id').click();
		await page.waitForFunction(() => document.cookie.includes('pg.locale=id'));
		await page.reload({ waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('load').catch(() => {});
		expect(await page.evaluate(() => document.cookie)).toContain('pg.locale=id');
		// the DSI cookie is untouched by the playground's choice
		expect(await page.evaluate(() => document.cookie)).not.toContain('dsi.locale=');
	});
});

test.describe('survival matrix — independence + junk edges', () => {
	test('cross-app storage namespaces are disjoint (DSI keys vs pg keys)', async ({ page }) => {
		await withFirstPaint(page, 'http://127.0.0.1:5176/?profile=a', { key: 'dsi-theme_a', value: 'dark' });
		const dsiKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pg-')));
		expect(dsiKeys).toEqual([]);
		const pg = await page.context().newPage();
		await withFirstPaint(pg, PG, { key: 'pg-theme', value: 'light' });
		const pgKeys = await pg.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('dsi-')));
		expect(pgKeys).toEqual([]);
		await pg.close();
	});

	test('junk theme blob survives: defaults at first paint, no crash', async ({ page }) => {
		await withFirstPaint(page, 'http://127.0.0.1:5176/', { key: 'dsi-theme', value: '{truncated' });
		const fp = await firstPaintTheme(page);
		expect(fp === 'light' || fp === 'dark').toBe(true); // resolved, never undefined
		await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
	});
});