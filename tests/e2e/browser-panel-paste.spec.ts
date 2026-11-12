/**
 * E2E: the wire clipboard (ADR-0061, spec 2026-11-12 Wave 1, task 1.4).
 *
 * 01 a paste event on the glass wrap preventDefaults and produces the
 *    kind:'text' input POST (observed on the wire via a capture route —
 *    the request continues to the REAL server), and the text truly lands
 *    in the glass fixture input (the /page DOM-truth channel shows it)
 * 02 the panel still mounts and gestures: a mousedown through the glass
 *    still produces the kind:'mouse' dispatch
 *
 * Selectors verified in component source (Step 3.8): browser-glass /
 * browser-status / panel-browser (BrowserPanel.svelte, BrowserContent.svelte).
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // playwright.config pins DSH_BASE_URL to 4590
let stub: DshStubHost | undefined;
let sessionId: string | null = null;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	if (sessionId) {
		await fetch('http://127.0.0.1:5176/api/browser/' + sessionId + '/close', { method: 'POST' }).catch(() => undefined);
	}
	await stub?.stop();
});

const ATTR = (s: string): string => s.replaceAll("'", String.fromCharCode(39));
const TYPE_FIXTURE =
	'data:text/html,<title>TYPE</title>' +
	'<input style="position:fixed;inset:0;width:100vw;height:100vh;font-size:40px" ' +
	'oninput="document.title=' + ATTR("'TYPED:'+this.value") + '">';

async function openGlass(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	await expect(page.getByTestId('conversation-header')).toBeVisible();
	await page.getByTestId('open-browser').click();
	await expect(page.getByTestId('panel-browser')).toBeVisible();
}

test.describe.serial('wire clipboard e2e', () => {
	test.setTimeout(90_000); // real browser launches + load waits

	test('01 paste event on the wrap posts kind:text and the text lands in the glass', async ({ page, request }) => {
		await openGlass(page);
		const strip = page.getByTestId('browser-status');
		await expect(strip).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		const prefix = (await strip.textContent())?.match(/[0-9a-f]{8}/)?.[0] ?? '';
		const list = (await (await request.get('/api/browser')).json()) as { sessions: Array<{ id: string; port: number }> };
		sessionId = list.sessions.find((s) => s.id.startsWith(prefix))!.id;
		await request.post('/api/browser/' + sessionId + '/navigate', { data: { url: TYPE_FIXTURE } });
		// settle: the fixture must be ON the glass before the focusing click
		await page.waitForTimeout(800);
		// focus the fixture input through the glass (the paste event only
		// fires on a focused surface; the insertText target must be focused)
		await page.getByTestId('browser-glass').click();

		// CAPTURE (not stub) the input POSTs — the request continues to the
		// real server so the wire end-to-end stays honest
		const inputPosts: Array<Record<string, unknown>> = [];
		await page.route('**/api/browser/*/input', async (route) => {
			inputPosts.push(route.request().postDataJSON() as Record<string, unknown>);
			await route.fallback();
		});

		const prevented = await page
			.locator('[data-testid=browser-glass] canvas')
			.evaluate((el) => {
				const dt = new DataTransfer();
				dt.setData('text/plain', 'e2e-paste');
				const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
				el.dispatchEvent(ev);
				return ev.defaultPrevented;
			});
		expect(prevented).toBe(true); // the DSI page itself never receives the text

		// the paste rode the wire as a kind:'text' dispatch (the focusing
		// click's gesture dispatches are co-present — filter to the text kind)
		const textPosts = () => inputPosts.filter((p) => p.kind === 'text');
		await expect.poll(textPosts, { timeout: 10_000 }).toHaveLength(1);
		expect(textPosts()[0]).toMatchObject({ kind: 'text', text: 'e2e-paste' });
		// and the glass ACTUALLY received it — the fixture input's title flips
		await expect
			.poll(async () => {
				const p = (await (await request.get('/api/browser/' + sessionId + '/page')).json()) as { title: string };
				return p.title;
			}, { timeout: 10_000 })
			.toBe('TYPED:e2e-paste');
	});

	test('03 drag-select in the glass yields a real selection; ⌘C copies it out (D6/D8)', async ({ page, request, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await openGlass(page);
		const strip = page.getByTestId('browser-status');
		await expect(strip).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		const prefix = (await strip.textContent())?.match(/[0-9a-f]{8}/)?.[0] ?? '';
		const list = (await (await request.get('/api/browser')).json()) as { sessions: Array<{ id: string; port: number }> };
		const mine = list.sessions.find((s) => s.id.startsWith(prefix))!.id;
		sessionId = mine;
		const SEL_FIXTURE =
			'data:text/html,<title>SEL</title>' +
			'<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;font-size:140px;line-height:1.4;user-select:text">HELLO selectable WORLD end</div>';
		await request.post('/api/browser/' + mine + '/navigate', { data: { url: SEL_FIXTURE } });
		// settle: the fixture must be ON the glass before the drag
		await page.waitForTimeout(800);
		const box = await page.getByTestId('browser-glass').boundingBox();
		// letterbox-safe drag along the TEXT LINE (top of the glass viewport —
		// a drag below the last text line extends no characters)
		await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.15);
		await page.mouse.down();
		for (let f = 0.3; f <= 0.75; f += 0.05) {
			await page.mouse.move(box!.x + box!.width * f, box!.y + box!.height * 0.15);
			await page.waitForTimeout(30);
		}
		await page.mouse.up();
		// the WHOLE chain: panel handlers → wire → REAL Chromium selection →
		// the point-less /element pass returns it (D8). The drag starts at
		// 25% width — mid-word is fine, the selection just must be REAL.
		await expect
			.poll(async () => {
				const res = await request.post('/api/browser/' + mine + '/element', { data: { selectionOnly: true } });
				return ((await res.json()) as { selection: string | null }).selection ?? '';
			}, { timeout: 10_000 })
			.toContain('selec');
		// ⌘C: the chord reads the glass selection and writes the OPERATOR's
		// clipboard (D8) — the glass's own OS clipboard is never touched.
		// NO click here: a click collapses the selection we just made (the
		// canvas already holds focus from the drag's press)
		await page.keyboard.press('Meta+c');
		await expect
			.poll(async () => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
			.toContain('selec'); // the drag's exact selection text
		// select-all verb (D7): ⌘A selects the whole fixture inside the glass
		await page.keyboard.press('Meta+a');
		await expect
			.poll(async () => {
				const res = await request.post('/api/browser/' + mine + '/element', { data: { selectionOnly: true } });
				return ((await res.json()) as { selection: string | null }).selection ?? '';
			}, { timeout: 10_000 })
			.toContain('WORLD end');
	});

	test('02 the panel still mounts and gestures after the paste wiring', async ({ page, request }) => {
		await openGlass(page);
		const strip = page.getByTestId('browser-status');
		await expect(strip).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		const prefix = (await strip.textContent())?.match(/[0-9a-f]{8}/)?.[0] ?? '';
		const list = (await (await request.get('/api/browser')).json()) as { sessions: Array<{ id: string; port: number }> };
		const mine = list.sessions.find((s) => s.id.startsWith(prefix))!.id;
		const mousePosts: Array<Record<string, unknown>> = [];
		await page.route('**/api/browser/*/input', async (route) => {
			mousePosts.push(route.request().postDataJSON() as Record<string, unknown>);
			await route.fallback();
		});
		const box = await page.getByTestId('browser-glass').boundingBox();
		await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await expect
			.poll(() => mousePosts.filter((p) => p.kind === 'mouse' && p.type === 'mousePressed'), { timeout: 10_000 })
			.toHaveLength(1);
		expect(sessionId).toBeTruthy(); // test 01's session survives for the cleanup gate
		void mine;
	});
});
