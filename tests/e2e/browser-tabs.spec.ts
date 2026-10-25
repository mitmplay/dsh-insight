/**
 * E2E: The Many-Faced Glass (ADR-0040; spec 2026-10-24 task 3.2).
 *
 * 01 a second tab (opened through the debug port — the same surface the
 *    MCP brain drives) reaches the panel's tab strip
 * 02 activating from the strip makes /page (the DOM-truth channel)
 *    report the ACTIVE tab
 * 03 input through the glass lands on the ACTIVE tab (fixture title flips)
 * 04 the kill ladder still closes the WHOLE session (tabs die, port freed)
 *
 * Fixture = data: URLs with distinct titles; /page is the witness.
 */
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // the config wires DSH_BASE_URL to this exact stub port
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const BQ = String.fromCharCode(39);
const ATTR = (s: string): string => s.replaceAll("'", BQ);

const TAB_B = 'data:text/html,<title>TABB</title>' +
	'<button style="position:fixed;inset:0;width:100vw;height:100vh;font-size:48px" ' +
	'onclick="document.title=' + ATTR("'CLICKED-B'") + '">go</button>';

let sessionId = '';
let glassPort = 0;

const portHeld = (port: number): boolean =>
	spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' }).status === 0;

async function openGlass(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await expect(page.getByTestId('conversation-header')).toBeVisible();
	await page.getByTestId('open-browser').click();
	await expect(page.getByTestId('panel-browser')).toBeVisible();
	await expect(page.getByTestId('browser-status')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
}

async function sessionInfo(request: import('@playwright/test').APIRequestContext, prefix: string): Promise<{ id: string; port: number }> {
	const list = (await (await request.get('/api/browser')).json()) as { sessions: Array<{ id: string; port: number }> };
	return list.sessions.find((s) => s.id.startsWith(prefix))!;
}

test.describe.serial('glass two-tab ladder', () => {
	test.setTimeout(120_000);

	/** Each test drives its OWN glass (a fresh page context opens a fresh
	 *  session): mount the panel, derive its session from the strip prefix,
	 *  open a second tab through the debug port, wait for /tabs to see it. */
	async function setupTwoTabs(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext): Promise<{ sessionId: string; glassPort: number }> {
		await openGlass(page);
		const m = (await page.getByTestId('browser-status').textContent())?.match(/[0-9a-f]{8}/);
		expect(m).toBeTruthy();
		const mine = await sessionInfo(request, m![0]);
		// the brain's move: a second page in the SAME browser via its
		// debug endpoint (what a Playwright page handle does underneath)
		const opened = await request.put('http://127.0.0.1:' + mine.port + '/json/new?about:blank');
		expect(opened.ok()).toBe(true);
		await expect
			.poll(async () => {
				const t = (await (await request.get('/api/browser/' + mine.id + '/tabs')).json()) as { tabs: unknown[] };
				return t.tabs.length;
			}, { timeout: 15_000 })
			.toBe(2);
		// BUGFIX witness: NO reload — the live poll must surface the strip
		// (3s tick) after the brain opened the tab post-mount
		await expect(page.getByTestId('browser-tab-strip')).toBeVisible({ timeout: 12_000 });
		await expect(page.getByTestId('browser-tab')).toHaveCount(2, { timeout: 10_000 });
		return { sessionId: mine.id, glassPort: mine.port };
	}

	test('01 second tab reaches the strip', async ({ page, request }) => {
		const mine = await setupTwoTabs(page, request);
		expect(mine.glassPort).toBeGreaterThan(0);
	});

	test('02 activating from the strip moves the mirror (DOM truth)', async ({ page, request }) => {
		const { sessionId: id } = await setupTwoTabs(page, request);
		await request.post('/api/browser/' + id + '/navigate', { data: { url: 'data:text/html,<title>TABA</title><h1>a</h1>' } });
		const tabs = (await (await request.get('/api/browser/' + id + '/tabs')).json()) as { tabs: Array<{ targetId: string; active: boolean; title: string }> };
		const inactive = tabs.tabs.find((t) => !t.active)!;
		await request.post('/api/browser/' + id + '/navigate', { data: { url: TAB_B, targetId: inactive.targetId } });
		await page.reload();
		await expect(page.getByTestId('browser-tab-strip')).toBeVisible({ timeout: 15_000 });
		const buttons = page.getByTestId('browser-tab');
		await expect(buttons).toHaveCount(2, { timeout: 15_000 });
		// click the TABB button (find it by title text, order-proof)
		await page.locator('[data-testid="browser-tab"]', { hasText: 'TABB' }).click();
		await expect
			.poll(async () => {
				const p = (await (await request.get('/api/browser/' + id + '/page')).json()) as { title: string };
				return p.title;
			}, { timeout: 15_000 })
			.toBe('TABB');
	});

	test('03 input through the glass lands on the ACTIVE tab', async ({ page, request }) => {
		const { sessionId: id } = await setupTwoTabs(page, request);
		const tabs = (await (await request.get('/api/browser/' + id + '/tabs')).json()) as { tabs: Array<{ targetId: string; active: boolean; title: string }> };
		const inactive = tabs.tabs.find((t) => !t.active)!;
		await request.post('/api/browser/' + id + '/navigate', { data: { url: TAB_B, targetId: inactive.targetId } });
		// activate TABB from the strip (the operator's way)
		await page.reload();
		await expect(page.getByTestId('browser-tab-strip')).toBeVisible({ timeout: 15_000 });
		await page.locator('[data-testid="browser-tab"]', { hasText: 'TABB' }).click();
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + id + '/page')).json()) as { title: string }).title, { timeout: 15_000 })
			.toBe('TABB');
		const box = await page.getByTestId('browser-glass').boundingBox();
		await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + id + '/page')).json()) as { title: string }).title, { timeout: 15_000 })
			.toBe('CLICKED-B');
	});

	test('04 the kill ladder closes the WHOLE session (port freed)', async ({ page, request }) => {
		const { sessionId: id, glassPort } = await setupTwoTabs(page, request);
		expect(portHeld(glassPort)).toBe(true);
		const res = await request.post('/api/browser/' + id + '/close');
		expect(res.ok()).toBe(true);
		expect(portHeld(glassPort)).toBe(false);
		const after = await request.get('/api/browser/' + id + '/tabs');
		expect(after.status()).toBe(409);
	});
});
