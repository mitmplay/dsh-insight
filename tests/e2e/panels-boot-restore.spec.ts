/**
 * E2E: The Desk Remembers Before Paint (ADR-0067, Tasks 2.1) — on a reload
 * the FIRST post-reload paint already shows the SAVED panel width; no
 * default-width layout ever renders before the restore kicks in.
 *
 * Proof strategy (reference-relative, not symptom-level): an init script
 * (1) traps the window.__DSI_PANELS_BOOT assignment so we see the pre-paint
 * hand-off happen at all, and (2) samples the floor's first panel-column
 * width on EVERY animation frame from the earliest possible moment. The
 * pinned facts: the trap fires, and NO sampled frame shows the default
 * width — the first visible layout is the saved one.
 *
 * Freshness: each test gets a fresh browser context (see
 * reload-rememberer.spec.ts header); the stub host serves the DSH wire.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

declare global {
	interface Window {
		__bootCapture: () => { raw: string; at: number } | null;
		__widthFrames: { w: number; at: number }[];
		__DSI_PANELS_BOOT?: unknown;
	}
}

const STUB_PORT = 4590; // MUST equal the config's DSH_BASE_URL stub port
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const SAVED_WIDTH = 812; // non-default: PANEL_DEFAULT_WIDTH is 730
const BLOB = JSON.stringify({
	panels: [{ id: 'panel-1', kind: 'conversation', sessionId: STUB_SESSION_ID, agentPreset: null, width: SAVED_WIDTH }],
	selectedPanelId: 'panel-1',
	panelWidth: SAVED_WIDTH,
	zoom: 1,
	explorerHidden: false,
	termFontSize: 12
});

/** Install, pre-document: (a) the boot-global trap, (b) the rAF width sampler. */
const INIT = `
	(() => {
		let captured;
		Object.defineProperty(window, '__BOOT_PREFS', {
			configurable: true,
			set(v) {
				const e = v && v['dsi-panels'];
				if (e) captured = { raw: e.raw, at: performance.now() };
				Object.defineProperty(v, 'dsi-panels', {
					configurable: true,
					set(e2) { captured = { raw: e2 && e2.raw, at: performance.now() }; },
					get() { return undefined; }
				});
			},
			get() { return undefined; }
		});
		window.__bootCapture = () => captured;
		window.__widthFrames = [];
		const sample = () => {
			const col = document.querySelector('[data-testid="panel-column"]');
			if (col) window.__widthFrames.push({ w: col.getBoundingClientRect().width, at: performance.now() });
			if (window.__widthFrames.length < 90) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	})();
`;

test('reload paints the SAVED width on the first layout — no default-width frame', async ({ page }) => {
	await page.addInitScript((blob) => localStorage.setItem('dsi-panels', blob), BLOB);
	await page.addInitScript(INIT);
	await page.goto('/');
	await page.reload();

	const col = page.locator('[data-testid="panel-column"]').first();
	await expect(col).toBeVisible();

	// FACT 1 — the generated boot block published the raw blob pre-paint.
	const captured = await page.evaluate(() => window.__bootCapture());
	expect(captured).not.toBeNull();
	expect(captured!.raw).toBe(BLOB);

	// FACT 2 — the app consumed it (consume-once: the register entry is gone).
	expect(await page.evaluate(() => (window.__BOOT_PREFS || {})['dsi-panels'])).toBeUndefined();

	// FACT 3 — the FIRST sampled frame already shows the saved width, and
	// NO frame ever shows the default (no second-render flash).
	const frames = await page.evaluate(() => window.__widthFrames);
	expect(frames.length).toBeGreaterThan(0);
	expect(frames[0].w).toBeCloseTo(SAVED_WIDTH, 0);
	const widths = frames.map((f: { w: number }) => Math.round(f.w));
	expect(widths).not.toContain(730);
	expect(widths.every((w: number) => Math.abs(w - SAVED_WIDTH) <= 1)).toBe(true);
});

test('profile desk (?profile=widi) restores from the suffixed key on first paint', async ({ page }) => {
	await page.addInitScript(
		(b) => localStorage.setItem('dsi-panels_widi', b),
		BLOB.replace('812', '620').replace('"width":812', '"width":620')
	);
	await page.addInitScript(INIT);
	await page.goto('/?profile=widi');
	const col = page.locator('[data-testid="panel-column"]').first();
	await expect(col).toBeVisible();
	const frames = await page.evaluate(() => window.__widthFrames);
	expect(frames.length).toBeGreaterThan(0);
	expect(frames[0].w).toBeCloseTo(620, 0);
});
