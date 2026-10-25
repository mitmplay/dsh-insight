/**
 * E2E: The Operator's Blank Page (ADR-0042) — the strip's + chip.
 *
 * 01 clicking + creates a SECOND tab: the chip appears ACTIVE (absence is
 *    the blank signal — the POST body is {})
 * 02 the address bar drives the blank face: /page (DOM truth) reports the
 *    typed page on the NEW target
 * 03 the strip X closes the new tab; the ORIGINAL tab re-activates and the
 *    session SURVIVES (a blank tab is an ordinary tab)
 * 04 the kill ladder still closes the whole session (port freed)
 *
 * Harness = the ADR-0040 browser-tabs.spec.ts shape: DshStubHost, data:
 * fixture titles, /page as the witness.
 */
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // playwright.config.ts wires DSH_BASE_URL to this port
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const TAB_A = 'data:text/html,<title>PLUS-A</title><h1>a</h1>';
const TAB_B = 'data:text/html,<title>PLUS-B</title><h1>b</h1>';

const portHeld = (port: number): boolean =>
	spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' }).status === 0;

async function openGlass(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await expect(page.getByTestId('conversation-header')).toBeVisible();
	await page.getByTestId('open-browser').click();
	await expect(page.getByTestId('panel-browser')).toBeVisible();
	await expect(page.getByTestId('browser-status')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
}

async function mySession(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext): Promise<{ id: string; port: number }> {
	const m = (await page.getByTestId('browser-status').textContent())?.match(/[0-9a-f]{8}/);
	expect(m).toBeTruthy();
	const list = (await (await request.get('/api/browser')).json()) as { sessions: Array<{ id: string; port: number }> };
	return list.sessions.find((s) => s.id.startsWith(m![0]))!;
}

test.describe.serial('glass plus-tab ladder', () => {
	test.setTimeout(120_000);

	test('01 + creates a second tab, active', async ({ page, request }) => {
		await openGlass(page);
		const mine = await mySession(page, request);
		await request.post('/api/browser/' + mine.id + '/navigate', { data: { url: TAB_A } });
		await page.reload();
		await expect(page.getByTestId('browser-tab-strip')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId('browser-tab')).toHaveCount(1);
		await page.getByTestId('browser-tab-new').click();
		await expect(page.getByTestId('browser-tab')).toHaveCount(2, { timeout: 15_000 });
		// the NEW face is active — asserted by flag, not position: the
		// registry's tab order is explicitly arbitrary (operator round 3)
		const active = page.locator('[data-testid="browser-tab"][data-active="true"]');
		await expect(active).toHaveCount(1);
		// the blank face carries about:blank as its url (the chip's title attr)
		await expect(active).not.toHaveAttribute('title', /PLUS-A/);
	});

	test('02 the address bar drives the blank face (DOM truth)', async ({ page, request }) => {
		await openGlass(page);
		const mine = await mySession(page, request);
		await request.post('/api/browser/' + mine.id + '/navigate', { data: { url: TAB_A } });
		await page.reload();
		await expect(page.getByTestId('browser-tab-strip')).toBeVisible({ timeout: 15_000 });
		await page.getByTestId('browser-tab-new').click();
		await expect(page.getByTestId('browser-tab')).toHaveCount(2, { timeout: 15_000 });
		// the operator types where to go — the blank face takes it
		await page.getByTestId('browser-url-input').fill(TAB_B);
		await page.getByTestId('browser-url-input').press('Enter');
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + mine.id + '/page')).json()) as { title: string }).title, { timeout: 15_000 })
			.toBe('PLUS-B');
	});

	test('03 strip X closes the new tab; the original re-activates; session survives', async ({ page, request }) => {
		await openGlass(page);
		const mine = await mySession(page, request);
		await request.post('/api/browser/' + mine.id + '/navigate', { data: { url: TAB_A } });
		await page.reload();
		await expect(page.getByTestId('browser-tab-strip')).toBeVisible({ timeout: 15_000 });
		await page.getByTestId('browser-tab-new').click();
		await expect(page.getByTestId('browser-tab')).toHaveCount(2, { timeout: 15_000 });
		// close the ACTIVE (new) tab via its strip X — the operator's way.
		// The X is a SIBLING of the chip button inside the wrapper (BrowserTab
		// renders both under div.relative), so climb to the parent first.
		const activeChip = page.locator('[data-testid="browser-tab"][data-active="true"]');
		await activeChip.locator('..').getByTestId('browser-tab-close').click();
		await expect(page.getByTestId('browser-tab')).toHaveCount(1, { timeout: 15_000 });
		// the survivor is the original — and it is ACTIVE again
		await expect(page.locator('[data-testid="browser-tab"]', { hasText: 'PLUS-A' })).toHaveAttribute('data-active', 'true', { timeout: 15_000 });
		// the session SURVIVED (a blank tab is an ordinary tab)
		const tabs = (await (await request.get('/api/browser/' + mine.id + '/tabs')).json()) as { tabs: unknown[] };
		expect(tabs.tabs).toHaveLength(1);
	});

	test('04 the kill ladder still closes the whole session (port freed)', async ({ page, request }) => {
		await openGlass(page);
		const mine = await mySession(page, request);
		await page.getByTestId('browser-tab-new').click();
		await expect(page.getByTestId('browser-tab')).toHaveCount(2, { timeout: 15_000 });
		expect(portHeld(mine.port)).toBe(true);
		const res = await request.post('/api/browser/' + mine.id + '/close');
		expect(res.ok()).toBe(true);
		expect(portHeld(mine.port)).toBe(false);
	});
});
