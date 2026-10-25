/**
 * Glass-routed fixtures (2026-10-25): opt-in reroute of an e2e spec's
 * browser into the LIVE BrowserManager glass (the launchPersistentContext
 * browser of src/lib/server/browser/registry.ts) instead of Playwright's
 * own launch.
 *
 * Opt-in: DSI_E2E_GLASS_CDP_URL=http://127.0.0.1:<port> — the port of a
 * live glass from GET /api/browser (the registry's --remote-debugging-port).
 * Without the env, this module IS @playwright/test (zero behavior change).
 *
 * Watch-me knobs (all optional, for the human watching the mirror):
 * - DSI_E2E_GLASS_SLOWMO=<ms>    delay on every Playwright call
 *                                (chromium.connectOverCDP slowMo)
 * - DSI_E2E_GLASS_ACTIVATE=1     make each test tab the ACTIVE face in the
 *                                floor mirror (POST /api/browser/<id>/activate)
 * - DSI_E2E_GLASS_HOLD_MS=<ms>   hold the page open after the test body
 *                                finishes, so the result can be inspected
 *
 * Contract respected (KB browser-manager):
 * - the glass is NEVER closed: teardown only disconnects the CDP client;
 * - the spec's pages are tabs of the glass persistent context (contexts()[0]),
 *   so they appear in the floor mirror like any brain-opened tab;
 * - a CDP-attached context carries none of the runner's options, so the
 *   page fixture resolves relative goto('/') itself against
 *   DSI_E2E_GLASS_BASE_URL (default the config's preview :5176);
 * - cookies land in the glass profile dir (disposable, swept on close).
 */
import { test as base, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

const GLASS_CDP_URL = process.env.DSI_E2E_GLASS_CDP_URL;
const SLOWMO_MS = Number(process.env.DSI_E2E_GLASS_SLOWMO ?? 0) || 0;
const ACTIVATE = process.env.DSI_E2E_GLASS_ACTIVATE === '1';
const HOLD_MS = Number(process.env.DSI_E2E_GLASS_HOLD_MS ?? 0) || 0;
const DSI_URL = process.env.DSI_E2E_GLASS_DSI_URL ?? 'http://127.0.0.1:5175';

export const test = GLASS_CDP_URL
	? base.extend<{ browser: Browser; context: BrowserContext; page: Page }>({
			browser: async ({ playwright }, use) => {
				const browser = await playwright.chromium.connectOverCDP(GLASS_CDP_URL, {
					slowMo: SLOWMO_MS
				});
				await use(browser);
				// disconnect only — the glass must survive the run
				await browser.close();
			},
			context: async ({ browser }, use) => {
				const ctx = browser.contexts()[0];
				if (!ctx) throw new Error('glass has no persistent context');
				await use(ctx);
				// do NOT close: this is the live glass context, not ours
			},
			page: async ({ context }, use) => {
				const page = await context.newPage();
				// surface the test tab in the floor mirror (best effort only)
				if (ACTIVATE) {
					try {
						const port = new URL(GLASS_CDP_URL!).port;
						const list = await fetch(DSI_URL + '/api/browser').then((r) => r.json());
						const session = (list.sessions ?? []).find((s: { port: number }) => s.port === Number(port));
						if (session) {
							const cdp = await context.newCDPSession(page);
							const info = (await cdp.send('Target.getTargetInfo')) as { targetInfo?: { targetId?: string } };
							await cdp.detach();
							const tid = info.targetInfo?.targetId;
							if (tid) {
								await fetch(DSI_URL + '/api/browser/' + session.id + '/activate', {
									method: 'POST',
									headers: { 'content-type': 'application/json' },
									body: JSON.stringify({ targetId: tid })
								});
							}
						}
					} catch {
						// mirror-chasing is cosmetic — never fail the test for it
					}
				}
				const glassBase = process.env.DSI_E2E_GLASS_BASE_URL ?? 'http://127.0.0.1:5176';
				// resolve relative URLs: a CDP-attached context has no runner baseURL
				const origGoto = page.goto.bind(page);
				page.goto = ((url: string, options?: Parameters<Page['goto']>[1]) =>
					origGoto(new URL(url, glassBase).toString(), options)) as Page['goto'];
				await use(page);
				if (HOLD_MS > 0) {
					await page.bringToFront().catch(() => undefined);
					await new Promise((r) => setTimeout(r, HOLD_MS));
				}
				await page.close().catch(() => undefined); // our tab only
			}
		})
	: base;

export { expect };
