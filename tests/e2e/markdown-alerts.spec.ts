/**
 * E2E: GFM alert blocks (ADR-0056 task 1.3) — a NOTE alert renders as a
 * classed alert card in a real assistant bubble, in BOTH themes.
 *
 * Selectors verified in source (Step 3.8): .md-alert-note /
 * .md-alert-title / .md-alert-icon are emitted by markdown.ts (pinned by
 * tests/unit/markdown-alerts.test.ts); the transcript bubble is
 * [data-testid=assistant-turn]; the theme hinge is html[data-theme]
 * (ADR-0023 D1), switched via localStorage dsi-theme + reload — the same
 * choice the Three-State Lamp persists.
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const ALERT_FIXTURE = '> [!NOTE]\n> Remember to **save** your work.';
const PLAIN_FIXTURE = '> a plain quote line';

test('a NOTE alert renders as a classed card in light AND dark (ADR-0056 1.3)', async ({ page }) => {
	await page.goto('/?sessionKey=' + STUB_SESSION_ID);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();

	// Push one assistant message carrying the alert fixture ABOVE the poll
	// waterline (the ledger persists — the dark leg reloads cold and the
	// bubble must still be there).
	const state = await stub!.getState();
	const seq = state.lastSeq + 1;
	await stub!.pushEvent({
		type: 'assistant/message',
		seq,
		time: Date.now(),
		data: { turn: 91, step: 1, message: { content: [{ type: 'text', text: ALERT_FIXTURE + '\n\n' + PLAIN_FIXTURE }] } }
	});

	// LIGHT: the alert card, its icon svg, its title word, its inline body.
	const alert = transcript.locator('.md-content .md-alert-note').first();
	await expect(alert).toBeVisible({ timeout: 10_000 });
	const title = alert.locator('.md-alert-title');
	await expect(title).toBeVisible();
	await expect(title.locator('svg.md-alert-icon')).toHaveCount(1);
	await expect(title).toContainText('Note');
	await expect(alert.locator('p').last()).toContainText('Remember to');
	await expect(alert.locator('strong')).toHaveText('save');
	// Plain quote in the same bubble stays an ordinary blockquote.
	await expect(transcript.locator('.md-content blockquote:not(.md-alert)', { hasText: 'plain quote line' }).first()).toBeVisible();
	await page.screenshot({ path: 'test-results/markdown-alerts-light.png', fullPage: true });

	// DARK: same structure, re-toned skin — switch the lamp, reload cold.
	await page.evaluate(() => localStorage.setItem('dsi-theme', 'dark'));
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	const transcript2 = page.getByTestId('transcript');
	await expect(transcript2).toBeVisible();
	const alert2 = transcript2.locator('.md-content .md-alert-note').first();
	await expect(alert2).toBeVisible({ timeout: 10_000 });
	await expect(alert2.locator('.md-alert-title svg.md-alert-icon')).toHaveCount(1);
	await expect(alert2).toContainText('Remember to');
	await page.screenshot({ path: 'test-results/markdown-alerts-dark.png', fullPage: true });
});