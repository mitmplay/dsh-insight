import { type ChildProcess, spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';

// R11 W3 (ADR-0074) — the playground mount proof: the corner is ONE base
// mount (copy camera NEW on this surface, collapse preserved via
// pg-sidebar-toggle, floor tray intact in extras), and the GESTURE GATE:
// an actual click on the new camera writes image/png to the clipboard
// (the capture-clipboard.spec.ts pattern, grant-free: instrument
// clipboard.write). Own dev server on 5179 (the e2e stack owns 5176 for
// the DSI preview; 5177 survival matrix; 5178 playground tray).

const PG_PORT = 5179;
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

test.describe('playground corner (R11 W3)', () => {
	test('camera renders in the header corner; collapse keeps pg-sidebar-toggle; ControlBar rides extras', async ({ page }) => {
		await page.goto(PG, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle');
		const corner = page.locator('.hdr-actions .rail-header-actions');
		await expect(corner).toBeVisible({ timeout: 20000 });
		// organ order: copy → collapse → ControlBar
		const kids = corner.locator(':scope > *');
		await expect(corner.locator('[data-testid="canvas-copy-button"]')).toBeVisible();
		await expect(corner.locator('[data-testid="pg-sidebar-toggle"]')).toBeVisible();
		await expect(corner.locator('[data-testid="pg-controlbar-trigger"]')).toBeVisible();
		expect(await kids.count()).toBe(3);
	});

	test('collapse toggle still works (pg-sidebar-toggle flips the sidebar)', async ({ page }) => {
		await page.goto(PG, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle');
		const toggle = page.getByTestId('pg-sidebar-toggle');
		await expect(toggle).toBeVisible({ timeout: 20000 });
		// Expanded header hosts pg-sidebar-toggle; collapsing UNMOUNTS the
		// expanded rail and the collapsed stub hosts pg-sidebar-restore —
		// that swap IS the flip (SidebarContainer contract).
		const before = await toggle.getAttribute('aria-expanded');
		await toggle.click();
		if (before === 'true') {
			await expect(page.getByTestId('pg-sidebar-toggle')).toHaveCount(0, { timeout: 10000 });
			await expect(page.getByTestId('pg-sidebar-restore')).toBeVisible();
		} else {
			await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		}
	});

	test('gesture gate: clicking the playground camera writes image/png to the clipboard', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: PG });
		await page.goto(PG, { waitUntil: 'domcontentloaded' });
		await page.waitForLoadState('networkidle');
		const btn = page.locator('.hdr-actions [data-testid="canvas-copy-button"]');
		await expect(btn).toBeVisible({ timeout: 20000 });

		// Prove the write: instrument clipboard.write BEFORE the click.
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

		await btn.click();
		// the busy spinner must clear (capture finished or degraded no-op)
		await expect(page.locator('.hdr-actions svg.ccb-spin')).toHaveCount(0, { timeout: 30_000 });

		const writes = await page.evaluate(
			() => (window as unknown as { __capWrites: { type: string }[] }).__capWrites
		);
		expect(writes.some((w) => w.type === 'image/png')).toBe(true);
	});
});
