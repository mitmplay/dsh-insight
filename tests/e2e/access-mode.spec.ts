/**
 * E2E: DSI access chip (ADR-0007, 2026-08-25) — the prompt footer's access
 * mode against the stub DSH host (no live host required).
 *
 *   1. cold render: the tail page's permissions projection renders the chip
 *      (label + the DSH aria string); the menu lists the presets, never custom
 *   2. a safe pick POSTs the /permission line through the typed route; the
 *      poll's knob events confirm (optimistic label → re-enabled truth)
 *   3. Full access opens the risk gate (R7): Enable disabled until
 *      acknowledged; acknowledge+enable submits; cancel submits nothing
 */

import { expect, test } from '@playwright/test';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

// All spec files share the webServer's DSH_BASE_URL port (4590); workers:1
// serializes files, so each beforeAll owns the port for its file.
const STUB_PORT = 4590;
const stubCtl = `http://127.0.0.1:${STUB_PORT}/__e2e/state`;

let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

interface StubStateView {
	permissionPreset: string;
	permissionCalls: string[];
}

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	return (await res.json()) as StubStateView;
}

/** Reset the permission fixtures between tests (the mode + the call log). */
async function resetPermission(): Promise<void> {
	await fetch(stubCtl, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ permissionPreset: 'workspace-write', permissionCalls: [] })
	});
}

test('01 · cold render: the chip reads the tail projections; custom never switchable', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const chip = page.getByTestId('access-mode-chip');
	await expect(chip).toBeVisible();
	// DSH aria parity + the Title Case label.
	await expect(chip).toHaveAttribute('aria-label', 'Access mode, current: Workspace Write');
	await expect(chip).toContainText('Workspace Write');

	await chip.click();
	const menu = page.getByTestId('access-mode-menu');
	await expect(menu).toBeVisible();
	const options = menu.locator('[data-testid="access-mode-option"]');
	await expect(options).toHaveCount(3);
	await expect(options.nth(0)).toContainText('Read Only');
	await expect(options.nth(1)).toContainText('Workspace Write');
	await expect(options.nth(2)).toContainText('Full access'); // pinned product label
	// The menu never offers custom (readable as current, never switchable).
	await expect(menu.locator('[data-value="custom"]')).toHaveCount(0);
});

test('02 · a safe pick POSTs the /permission line; the poll fold confirms', async ({ page }) => {
	await resetPermission();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const chip = page.getByTestId('access-mode-chip');
	await expect(chip).toBeVisible();

	await chip.click();
	await page.locator('[data-testid="access-mode-option"][data-value="read-only"]').click();

	// Optimistic label + disabled until the poll's knob events land.
	await expect(chip).toContainText('Read Only');
	await expect(chip).toBeDisabled();

	// The stub host received the exact slash line through the typed route.
	await expect
		.poll(async () => (await stubState()).permissionCalls)
		.toEqual(['/permission read-only']);

	// The poll delivers the knob events → the store fold confirms → the
	// chip re-enables on the real read state.
	await expect(chip).toBeEnabled({ timeout: 10_000 });
	await expect(chip).toContainText('Read Only');
	await expect(chip).toHaveAttribute('aria-label', 'Access mode, current: Read Only');
	// The mode change never renders in the transcript (knob events stay
	// silent — the chip is their surface, the chat is not).
	await expect(page.getByTestId('transcript').locator('[data-testid="unknown-event"]')).toHaveCount(0);
});

test('03 · Full access keeps its gate: acknowledge before enable', async ({ page }) => {
	await resetPermission();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const chip = page.getByTestId('access-mode-chip');
	await expect(chip).toBeVisible();

	await chip.click();
	await page.locator('[data-testid="access-mode-option"][data-value="danger-full-access"]').click();

	// The gate opens INSTEAD of submitting; Enable stays disabled.
	const dialog = page.getByTestId('access-mode-confirm');
	await expect(dialog).toBeVisible();
	const enable = page.getByTestId('access-mode-enable');
	await expect(enable).toBeDisabled();
	await expect
		.poll(async () => (await stubState()).permissionCalls, { timeout: 2_000 })
		.toEqual([]);

	// Cancel submits nothing and closes cleanly.
	await page.getByTestId('access-mode-cancel').click();
	await expect(dialog).toBeHidden();
	await expect
		.poll(async () => (await stubState()).permissionCalls, { timeout: 2_000 })
		.toEqual([]);

	// Acknowledge + enable submits the line and the gate closes.
	await chip.click();
	await page.locator('[data-testid="access-mode-option"][data-value="danger-full-access"]').click();
	await expect(dialog).toBeVisible();
	await page.getByTestId('access-mode-acknowledge').click();
	await expect(enable).toBeEnabled();
	await enable.click();
	await expect(dialog).toBeHidden();
	await expect
		.poll(async () => (await stubState()).permissionCalls)
		.toEqual(['/permission danger-full-access']);

	// The poll fold confirms — the pinned product label on the trigger.
	await expect(chip).toHaveAttribute('aria-label', 'Access mode, current: Full access', { timeout: 10_000 });
	await expect(chip).toContainText('Full access');
});

test('04 · dismissal contract: outside click closes; one menu at a time (spec 2026-11-01)', async ({ page }) => {
	await resetPermission();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const chip = page.getByTestId('access-mode-chip');
	await expect(chip).toBeVisible();

	// Outside click — the composer prompt input — closes the open menu.
	await chip.click();
	const menu = page.getByTestId('access-mode-menu');
	await expect(menu).toBeVisible();
	await page.getByTestId('prompt-input').click();
	await expect(menu).toBeHidden();

	// Mutual exclusivity: opening the model selector closes the chip menu.
	await chip.click();
	await expect(menu).toBeVisible();
	const modelBtn = page.getByTestId('model-selector-button');
	await expect(modelBtn).toBeVisible();
	await modelBtn.click();
	await expect(menu).toBeHidden();

	// Escape closes the model menu too (the same shared contract).
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('model-selector-menu')).toBeHidden();
});

