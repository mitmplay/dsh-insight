
/**
 * E2E (Wave 3, ADR-0076 — the prepare hook): the run_code CodeCard's
 * camera captures the WHOLE card. Journey: stub-push a run_code call
 * whose program is over-cap (45 lines), carries a result footer AND a
 * raw JSON pane → open the chip's card (all folds CLOSED, the operator's
 * default view) → grant clipboard → click canvas-copy-button → read the
 * image/png back and decode it → assert the card re-folded (the three
 * fold toggles' pre-click states hold AFTER the capture).
 *
 * Why e2e: the 2.1-T unit suite proves the wiring in happy-dom; only a
 * real browser proves Svelte's flush delivered the expanded DOM to the
 * raster AND the restore landed after the clipboard write settled.
 */
import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const STUB_PORT = 4590;
const LAST_LINE = 'const v44 = 44; // over the cap';

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

test('the code-card capture decodes from the clipboard and the card re-folds', async ({ page }) => {
	const CALL = 'call_e2e_codecap_0001';
	const program = Array.from({ length: 45 }, (_, i) => `const v${i} = ${i};`).join('\n');
	const base = (await (stub as DshStubHost).getState()).lastSeq + 1;
	const now = Date.now();
	const push = (n: number, type: string, data: Record<string, unknown>) =>
		(stub as DshStubHost).pushEvent({ type, seq: base + n, time: now + n, data });

	await push(0, 'tool/call', {
		callId: CALL,
		name: 'run_code',
		arguments: JSON.stringify({ description: 'Capture me', code: program })
	});
	await push(1, 'tool/result', {
		message: {
			source: { kind: 'tool', callId: CALL },
			content: [{ type: 'tool-result', content: [{ type: 'text', text: '--- program output ---\nok' }] }]
		}
	});

	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();

	// Open the card (inline chip expansion — the house shape of spec 28).
	// the chip label is the mapped plan title ("Code"), not the raw tool name
	const chip = transcript.locator('[data-testid="tool-chip"][data-kind="call"]', { hasText: 'Code' }).first();
	await chip.getByTestId('tool-chip-toggle').click();
	const card = transcript.getByTestId('code-card');
	await expect(card).toBeVisible();

	// Pre-click: every fold CLOSED — the last line is behind the cap, no
	// footer pane, no raw panes. This is the state restore must return to.
	await expect(card.getByTestId('code-result-pane')).toHaveCount(0);
	await expect(card.getByTestId('code-raw-args')).toHaveCount(0);
	const collapsed = await card.textContent();
	expect(collapsed).not.toContain(LAST_LINE);

	// THE click: prepare expands everything, the raster runs, restore
	// re-folds in finally — and only then does the done icon show.
	const capture = card.getByTestId('canvas-copy-button');
	await expect(capture).toBeAttached();
	await capture.click();
	await expect(capture.locator('svg[stroke="var(--color-status-pass)"]')).toBeVisible();

	// (a) the artifact: the clipboard PNG decodes and is a real capture.
	const audit = await page.evaluate(async () => {
		const items = await navigator.clipboard.read();
		let png: Blob | null = null;
		for (const item of items) {
			if (item.types.includes('image/png')) png = await item.getType('image/png');
		}
		if (!png) return { error: 'no image/png item on the clipboard' as const };
		const url = URL.createObjectURL(png);
		try {
			const img = new Image();
			await new Promise((res, rej) => {
				img.onload = res;
				img.onerror = () => rej(new Error('clipboard PNG did not decode'));
				img.src = url;
			});
			const c = document.createElement('canvas');
			c.width = img.width;
			c.height = img.height;
			const ctx = c.getContext('2d');
			if (!ctx) return { error: 'no 2d context' as const };
			ctx.drawImage(img, 0, 0);
			const d = ctx.getImageData(0, 0, c.width, c.height).data;
			let opaque = 0;
			for (let i = 3; i < d.length; i += 4) if (d[i] === 255) opaque++;
			return { w: c.width, h: c.height, opaqueRatio: opaque / (d.length / 4) };
		} finally {
			URL.revokeObjectURL(url);
		}
	});
	expect(audit).not.toHaveProperty('error');
	const a = audit as { w: number; h: number; opaqueRatio: number };
	expect(a.w).toBeGreaterThan(100);
	expect(a.h).toBeGreaterThan(60);
	expect(a.opaqueRatio).toBeGreaterThan(0.9); // the opaque-backing floor held

	// (b) THE re-fold: every fold toggle's pre-click state holds AFTER the
	// capture — collapsed code, closed footer, closed raw.
	await expect(card.getByTestId('code-result-pane')).toHaveCount(0);
	await expect(card.getByTestId('code-raw-args')).toHaveCount(0);
	expect(await card.textContent()).not.toContain(LAST_LINE);
	await expect(card).toBeVisible();
});
