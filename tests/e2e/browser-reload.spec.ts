/**
 * E2E: The Sticky Glass (spec 2026-10-20 Wave 3, task 3.1; ADR-0030 D1/D2).
 *
 * 01 a hard page.reload() mid-task keeps the session: same id re-binds, the
 *    debug port stays HELD, frames resume on the remounted glass
 * 02 panel-close after the reload still frees the port (the D8 gate, reused)
 *
 * The reload is the operator's muscle memory that used to KILL the browser
 * (the old onDestroy close-POST). Here it must detach the SSE stream only.
 */
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // the webServer's DSH_BASE_URL — every spec shares it
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const ATTR = (s: string): string => s.replaceAll("'", String.fromCharCode(39));
const STATE_FIXTURE = 'data:text/html,<title>STICKY</title>' +
	'<input style="position:fixed;inset:0;width:100vw;height:100vh;font-size:40px" ' +
	'oninput="document.title=' + ATTR("'HOLDING:'+this.value") + '">';

const portHeld = (port: number): boolean =>
	spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' }).status === 0;

/** The chip path — the operator's way; after a reload it rides the resolver. */
async function openGlass(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await expect(page.getByTestId('conversation-header')).toBeVisible();
	await page.getByTestId('open-browser').click();
	await expect(page.getByTestId('panel-browser')).toBeVisible();
}

async function panelSession(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext): Promise<{ id: string; port: number }> {
	const strip = page.getByTestId('browser-status');
	let prefix = '';
	await expect
		.poll(async () => {
			const m = (await strip.textContent())?.match(/[0-9a-f]{8}/);
			prefix = m ? m[0] : '';
			return prefix;
		}, { timeout: 20_000 })
		.not.toBe('');
	const list = (await (await request.get('/api/browser')).json()) as { sessions: Array<{ id: string; port: number }> };
	const mine = list.sessions.find((s) => s.id.startsWith(prefix))!;
	return { id: mine.id, port: mine.port };
}

test.describe.serial('sticky glass reload e2e', () => {
	test.setTimeout(120_000); // two real browser-launch paths + a reload

	test('01 hard reload mid-task keeps the session: re-bind, port held, frames resume', async ({ page, request }) => {
		await openGlass(page);
		await expect(page.getByTestId('browser-status')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		const before = await panelSession(page, request);

		// in-progress state the operator would lose under the old contract
		await request.post('/api/browser/' + before.id + '/navigate', { data: { url: STATE_FIXTURE } });
		await page.waitForTimeout(800);
		await page.getByTestId('browser-glass').click();
		await page.keyboard.type('abc');

		// THE HARD RELOAD — the panel must come back ON ITS OWN (no chip
		// click): the boot auto-restores the browser species when the
		// persisted session is still live (ADR-0030 D1)
		await page.reload();
		await expect(page.getByTestId('panel-browser')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('browser-status')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		const after = await panelSession(page, request);

		// SAME session (re-bind, not a twin), port still held, work intact
		expect(after.id).toBe(before.id);
		expect(portHeld(before.port)).toBe(true);
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + before.id + '/page')).json()) as { title: string }).title, { timeout: 10_000 })
			.toBe('HOLDING:abc');
		// the strip marks the re-bind (ADR-0030 D1)
		await expect(page.getByTestId('browser-status')).toHaveAttribute('data-rebound', 'true', { timeout: 10_000 });

		// PLACEMENT STABILITY: the persisted floor slot is the same after the
		// reload, and a SECOND reload restores at that same slot again — the
		// panel must not crawl across the PanelsZoom order
		const slot1 = await page.evaluate(() => localStorage.getItem('dsi.browser.panelIndex'));
		expect(slot1).not.toBeNull();
		await page.reload();
		await expect(page.getByTestId('panel-browser')).toBeVisible({ timeout: 20_000 });
		const slot2 = await page.evaluate(() => localStorage.getItem('dsi.browser.panelIndex'));
		expect(slot2).toBe(slot1);

		// FOCUS PRESERVATION: the restore must not steal the floor selection —
		// the browser column is NOT the selected one, and exactly one other
		// column carries the selection ring (ADR-0030 D1, focus too)
		const browserColumn = page.locator('.column:has([data-testid="panel-browser"])');
		await expect(browserColumn).toHaveCount(1); // the locator must MATCH — a vacuous pass proves nothing
		await expect(browserColumn).not.toHaveClass(/selected/);
		await expect(page.locator('.column.selected')).toHaveCount(1);
	});

	test('02 panel-close after the reload still frees the port (D8 gate reused)', async ({ page, request }) => {
		// session 01 is still open and re-bound on this fresh page load? No —
		// serial tests share the worker page only via storage; reopen the glass
		await openGlass(page);
		const mine = await panelSession(page, request);
		await page.getByTestId('panel-browser').getByTestId('panel-close').click();
		await expect(page.getByTestId('panel-browser')).toHaveCount(0);
		await expect.poll(async () => (await request.get('/api/browser/' + mine.id + '/page')).status()).toBe(409);
		await expect.poll(() => portHeld(mine.port).toString()).toBe('false');
	});
});
