/**
 * E2E: The Glass Browser (spec 2026-10-19 Wave 2, task 2.3; ADR-0029).
 *
 * 01 a browser panel mounts the glass and reaches live frames
 * 02 a click through the glass lands in the real browser (fixture title flips)
 * 03 typed text through the glass reaches the fixture input
 * 04 browse-close removes the panel AND frees the debug port (D8)
 *
 * Fixture = a data: URL (no extra server): a full-viewport button/input that
 * reports into document.title — the /page route is the DOM-truth channel,
 * since the glass itself is pixels.
 */
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	// the raw request-session of test 01 has no panel to release it (D8's
	// owner is the panel) — release it explicitly so the port gate is honest
	if (requestSessionId) {
		await fetch('http://127.0.0.1:5176/api/browser/' + requestSessionId + '/close', { method: 'POST' }).catch(() => undefined);
	}
	await stub?.stop();
});

const BQ = String.fromCharCode(39); // single quote, escaped into data URLs
const ATTR = (s: string): string => s.replaceAll("'", BQ);

const CLICK_FIXTURE = 'data:text/html,<title>FIX</title>' +
	'<button style="position:fixed;inset:0;width:100vw;height:100vh;font-size:48px" ' +
	'onclick="document.title=' + ATTR("'CLICKED'") + '">go</button>';

const TYPE_FIXTURE = 'data:text/html,<title>TYPE</title>' +
	'<input style="position:fixed;inset:0;width:100vw;height:100vh;font-size:40px" ' +
	'oninput="document.title=' + ATTR("'TYPED:'+this.value") + '">';

// The Glass Proxies e2e (ADR-0031): data: pages with distinct titles so
// the /page route can witness back/forward travel.
const HIST_A = 'data:text/html,<title>HISTA</title><h1>a</h1>';
const HIST_B = 'data:text/html,<title>HISTB</title><h1>b</h1>';

let port = 0;
let requestSessionId: string | null = null; // test 01's raw request session

/** Bare / RESETS the floor (spec 01 of panel-floor) — the glass must be
 *  (re)opened through the chip on every arrival, the operator's way. */
async function openGlass(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await expect(page.getByTestId('conversation-header')).toBeVisible();
	await page.getByTestId('open-browser').click();
	await expect(page.getByTestId('panel-browser')).toBeVisible();
}


/** The panel's OWN session id: the status strip prints its 8-char prefix
 *  once the panel's open resolved — poll it, then match the registry list.
 *  (A bare sessions.at(-1) races the panel's open and can be empty.) */
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

test.describe.serial('glass browser e2e', () => {
	test.setTimeout(90_000); // real browser launches + load waits
	test('01 panel mounts the glass and reaches live frames', async ({ page, request }) => {
		const open = await request.post('/api/browser', { data: {} });
		const info = (await open.json()) as { id: string; port: number };
		port = info.port;
		requestSessionId = info.id;
		expect(port).toBeGreaterThan(0);
		// drive the APP to open its panel through the chrome API: the page
		// exposes none headlessly, so we exercise the wire directly — open a
		// session, then reload; the panel body opens its own and mounts
		await openGlass(page);
		await expect(page.getByTestId('browser-status')).toHaveAttribute(
			'data-status',
			/live|connecting|opening/,
			{ timeout: 15_000 }
		);
	});

	test('02 click through the glass flips the fixture title', async ({ page, request }) => {
		await openGlass(page);
		const strip = page.getByTestId('browser-status');
		await expect(strip).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		const mine = (await panelSession(page, request)).id;
		const nav = await request.post('/api/browser/' + mine + '/navigate', { data: { url: CLICK_FIXTURE } });
		// the glass paints on the NEXT screencast frame — give it a beat
		await page.waitForTimeout(800);
		const box = await page.getByTestId('browser-glass').boundingBox();
		await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await expect
			.poll(async () => {
				const p = (await (await request.get('/api/browser/' + mine + '/page')).json()) as { title: string };
				return p.title;
			}, { timeout: 10_000 })
			.toBe('CLICKED');
	});

	test('03 typed text through the glass reaches the fixture input', async ({ page, request }) => {
		await openGlass(page);
		const mine = (await panelSession(page, request)).id;
		await request.post('/api/browser/' + mine + '/navigate', { data: { url: TYPE_FIXTURE } });
		// settle: the fixture must be ON the glass before the focusing click
		await page.waitForTimeout(800);
		// letterbox-safe focus: click the CENTER of the contained image (the
		// input is inset:0 full-viewport), never a letterbox bar (no-op)
		await page.getByTestId('browser-glass').click();
		console.log('T3_AFTER_CLICK', JSON.stringify(await (await request.get('/api/browser/' + mine + '/page')).json()));
		await page.keyboard.type('e2e');
		console.log('T3_AFTER_TYPE', JSON.stringify(await (await request.get('/api/browser/' + mine + '/page')).json()));
		console.log('T3_ACTIVE', await page.evaluate(() => document.activeElement?.tagName + '/' + document.activeElement?.getAttribute('data-testid')));
		await expect
			.poll(async () => {
				const p = (await (await request.get('/api/browser/' + mine + '/page')).json()) as { title: string };
				return p.title;
			}, { timeout: 10_000 })
			.toBe('TYPED:e2e');
	});

	test('05 header proxies drive the glass: URL input clears, back/forward, reload (ADR-0031)', async ({ page, request }) => {
		await openGlass(page);
		const strip = page.getByTestId('browser-status');
		await expect(strip).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		const mine = (await panelSession(page, request)).id;
		const input = page.getByTestId('panel-browser').getByTestId('browser-url-input');
		await expect(input).toBeEnabled({ timeout: 10_000 });
		// type a fixture URL into the header box, Enter -> glass shows it, box empties
		await input.fill(HIST_A);
		await input.press('Enter');
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + mine + '/page')).json()) as { title: string }).title, { timeout: 10_000 })
			.toBe('HISTA');
		await expect(input).toHaveValue('');
		// second page, then back/forward travel and the end-buttons disable
		await input.fill(HIST_B);
		await input.press('Enter');
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + mine + '/page')).json()) as { title: string }).title, { timeout: 10_000 })
			.toBe('HISTB');
		const back = page.getByTestId('panel-browser').getByTestId('browser-back');
		const forward = page.getByTestId('panel-browser').getByTestId('browser-forward');
		await expect(back).toBeEnabled({ timeout: 10_000 });
		await back.click();
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + mine + '/page')).json()) as { title: string }).title, { timeout: 10_000 })
			.toBe('HISTA');
		// HISTA is not the list start (the session carries older entries),
		// so "back enabled" is CORRECT here — the deterministic list END is
		// HISTB, the newest entry, where forward must disable
		await expect(forward).toBeEnabled();
		await forward.click();
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + mine + '/page')).json()) as { title: string }).title, { timeout: 10_000 })
			.toBe('HISTB');
		await expect(forward).toBeDisabled({ timeout: 10_000 }); // newest entry = list end
		// reload keeps the page (D4) and the glass input still works after
		const reload = page.getByTestId('panel-browser').getByTestId('browser-reload');
		await reload.click();
		await expect
			.poll(async () => ((await (await request.get('/api/browser/' + mine + '/page')).json()) as { title: string }).title, { timeout: 10_000 })
			.toBe('HISTB');
		// address-bar ORDER (amendment 2): back, forward, reload, input — left to right
		const panel = page.getByTestId('panel-browser');
		const xs = await Promise.all(
			['browser-back', 'browser-forward', 'browser-reload', 'browser-url-input'].map((tid) => panel.getByTestId(tid).boundingBox().then((b) => b!.x))
		);
		expect(xs).toEqual([...xs].sort((a, b) => a - b));
		// the title label is gone: the header starts at the back button
		await expect(panel.locator('span.font-medium')).toHaveCount(0);
		// viewport follows the glass (amendment 2): /page innerWidth converges
		// to the glass box width — content at native scale, not zoomed
		const box = await page.getByTestId('browser-glass').boundingBox();
		await expect
			.poll(async () => {
				const p = (await (await request.get('/api/browser/' + mine + '/page')).json()) as { innerWidth: number };
				return p.innerWidth;
			}, { timeout: 10_000 })
			.toBeCloseTo(box!.width, 1);
	});

	test('04 browse-close KILLS: panel leaves, the session dies, the port is FREED (Ladder Amendment 1)', async ({
 page, request }) => {
		await openGlass(page);
		const mine = (await panelSession(page, request)).id;
		const myPort = (await (await request.get('/api/browser')).json()) as { sessions: Array<{ id: string; port: number }> };
		const thePort = myPort.sessions.find((s) => s.id === mine)!.port;
		// scope INSIDE the browser panel — the floor chrome uses panel-close too
		await page.getByTestId('panel-browser').getByTestId('browse-close').click();
		await expect(page.getByTestId('panel-browser')).toHaveCount(0);
		// THE KILL (Ladder Amendment 1): wire session dead (409 tombstone), port freed, NO ghost
		await expect.poll(async () => (await request.get('/api/browser/' + mine + '/page')).status()).toBe(409);
		await expect.poll(() => spawnSync('lsof', ['-ti', 'tcp:' + thePort, '-sTCP:LISTEN'], { stdio: 'pipe' }).status === 0).toBe(false);
		await expect(page.locator(`[data-testid="sidebar-ghost-row"][data-session-id="${mine}"]`)).toHaveCount(0, { timeout: 10_000 });
	});
	// The Glass Provenance (ADR-0036, task 4.1): the chip survives the hard
	// reload (the slot re-mint) and dies with the panel close (no ghost).
	// The never-rewrite rule is unit-pinned (browser-species.test.ts) — this
	// surface case pins what the operator sees.
	test('06 provenance chip survives reload and dies with the panel', async ({ page }) => {
		await openGlass(page);
		const chip = page.getByTestId('browser-provenance');
		await expect(chip).toBeVisible();
		// the STABLE identity is the title attribute (the opener session id);
		// the visible label may heal from the raw id to the spine title after
		// a tick — text equality across the reload is not the contract
		const before = await chip.getAttribute('title');
		expect(before?.trim().length).toBeGreaterThan(0);
		// the session open must SETTLE (persistId lands) before the reload —
		// otherwise the boot restore correctly finds no persisted id (the
		// least-surprise rule) and summons nothing
		await expect(page.getByTestId('browser-status')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		// HARD reload — the boot restore re-mints the glass from the slot
		await page.reload();
		await expect(page.getByTestId('panel-browser')).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('browser-provenance')).toHaveAttribute('title', before ?? '', { timeout: 20_000 });
		// panel close takes the chip (and its slot) with it — no ghost
		await page.getByTestId('panel-browser').getByTestId('browse-close').click();
		await expect(page.getByTestId('panel-browser')).toHaveCount(0);
		await expect(page.getByTestId('browser-provenance')).toHaveCount(0);
	});

	// Amendment 2: the glass is FAMILY, not furniture — it spawns to the
	// RIGHT of its opener (D6) and dies with it (D5 revised).
	test('07 glass spawns right of opener and cascade-closes with it', async ({ page }) => {
		await openGlass(page);
		await expect(page.getByTestId('browser-status')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		// D6 placement: the glass column sits right of the conversation column
		const convColumn = page.getByTestId('panel-column').filter({ has: page.getByTestId('conversation-header') }).first();
		const convBox = await convColumn.boundingBox();
		const glassBox = await page.getByTestId('panel-browser').boundingBox();
		expect(convBox).not.toBeNull();
		expect(glassBox!.x).toBeGreaterThanOrEqual(convBox!.x + convBox!.width - 1);
		// the roster row wears the sub-agent costume: depth 1 under its opener
		await expect(page.locator('[data-panel-id][data-depth="1"]')).toHaveCount(1);
		// D5 revised cascade: closing the OPENER conversation takes the glass
		await page.getByTestId('browse-close').first().click();
		await expect(page.getByTestId('panel-browser')).toHaveCount(0, { timeout: 10_000 });
	});

	// ADR-0041 D1+D2: the glass measures the transform-true rect and a
	// zoom-ONLY change re-arms the measure — dragging the floor zoom (no
	// layout resize, no ResizeObserver fire) must re-converge the
	// Playwright viewport to the NEW seen box, smaller than the layout box.
	test('08 a floor zoom change re-converges the viewport to the seen box', async ({ page, request }) => {
		await openGlass(page);
		const mine = (await panelSession(page, request)).id;
		const innerW = async () => ((await (await request.get('/api/browser/' + mine + '/page')).json()) as { innerWidth: number }).innerWidth;
		// baseline at zoom 1: viewport = the unzoomed seen box
		const box1 = await page.getByTestId('browser-glass').boundingBox();
		// precision 0: the rect is fractional under the zoom transform, the
		// page viewport is integral CSS px — sub-pixel drift is expected
		await expect.poll(innerW, { timeout: 15_000 }).toBeCloseTo(box1!.width, 0);
		// zoom-only change: the layout box does NOT move (transform-blind
		// observers see nothing) — the D2 effect must carry the correction.
		// The zoom slider lives in the controlbar tray — open it first.
		await page.getByTestId('controlbar-trigger').click();
		const vpPosts: number[] = [];
		page.on('request', (req) => {
			if (req.url().includes('/viewport') && req.method() === 'POST') {
				const b = JSON.parse(req.postData() ?? '{}') as { width?: number };
				if (typeof b.width === 'number') vpPosts.push(b.width);
			}
		});
		await page.getByTestId('controlbar-slider-zoom-input').fill('0.8');
		await expect(page.getByTestId('controlbar-slider-zoom-value')).toContainText('80');
		// the zoom change MUST produce a viewport POST carrying the SHRUNK
		// width (D2 re-arm with the visual measure) — pin the client half
		// before judging the server half
		await expect.poll(() => vpPosts.some((w) => w < box1!.width - 5), { timeout: 5_000 }).toBe(true);
		const box2 = await page.getByTestId('browser-glass').boundingBox();
		expect(box2!.width).toBeLessThan(box1!.width - 5); // the seen box truly shrank
		await expect.poll(innerW, { timeout: 15_000 }).toBeCloseTo(box2!.width, 0);
	});
});