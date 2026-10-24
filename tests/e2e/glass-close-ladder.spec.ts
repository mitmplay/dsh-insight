/**
 * E2E: The Glass Close Ladder (ADR 2026-10-24, task 3.2) — the replay
 * gate in ONE live session, no reload:
 *
 * 01 the KILL path — chip-open a glass, close the opener panel: the wire
 *    list empties, the debug port is FREED, and no ghost row remains.
 * 02 the FOLD path — browse-close leaves the session live (ADR-0037 D1
 *    unchanged), the ghost row present.
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
	// test 01+02 both KILL now — any surviving session is an orphan from an
	// earlier run; release it so the port gate stays honest for later specs
	const list = (await fetch("http://127.0.0.1:5176/api/browser").then((r) => r.json())) as { sessions: Array<{ id: string }> };
	for (const s of list.sessions) {
		await fetch("http://127.0.0.1:5176/api/browser/" + s.id + "/close", { method: "POST" }).catch(() => undefined);
	}
	await stub?.stop();
});

async function openGlass(page: import("@playwright/test").Page): Promise<void> {
	await page.goto("/?sessionKey=" + STUB_SESSION_ID);
	await expect(page.getByTestId("conversation-header")).toBeVisible();
	await page.getByTestId("open-browser").click();
	await expect(page.getByTestId("panel-browser")).toBeVisible();
}

async function panelSession(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext): Promise<{ id: string; port: number }> {
	const strip = page.getByTestId("browser-status");
	let prefix = "";
	await expect
		.poll(async () => {
			const m = (await strip.textContent())?.match(/[0-9a-f]{8}/);
			prefix = m ? m[0] : "";
			return prefix;
		}, { timeout: 20_000 })
		.not.toBe("");
	const list = (await (await request.get("/api/browser")).json()) as { sessions: Array<{ id: string; port: number }> };
	return list.sessions.find((s) => s.id.startsWith(prefix))!;
}

test.describe.serial("the glass close ladder", () => {
	test.setTimeout(90_000);

	test("01 the FOLD path: opener close keeps the session alive and nests the lineage-tree ghost", async ({ page, request }) => {
		await openGlass(page);
		await expect(page.getByTestId("browser-status")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
		const mine = await panelSession(page, request);
		// close the OPENER conversation column (family close, no shift)
		const convColumn = page.getByTestId("panel-column").filter({ has: page.getByTestId("conversation-header") }).first();
		await convColumn.getByTestId("panel-close").click();
		await expect(page.getByTestId("panel-browser")).toHaveCount(0, { timeout: 10_000 });
		// Amendment 2 (operator 2026-10-24): the session SURVIVES the opener
		// close — the glass folds and the lineage-tree ghost nests it under
		// the opener family in the Sessions list.
		await expect.poll(async () => (await request.get("/api/browser/" + mine.id + "/page")).status()).toBe(200);
		const held = spawnSync("lsof", ["-ti", "tcp:" + mine.port, "-sTCP:LISTEN"], { stdio: "pipe" });
		expect(held.status === 0).toBe(true);
		// the opener is UNPANELED now — the ghost nests in the SESSIONS spine
		// (sidebar-session-card with the folded-glass arm, origin browser)
		await expect(page.locator('[data-testid="sidebar-session-card"]', { hasText: "Browser — " }).first()).toBeVisible({ timeout: 10_000 });
		await page.screenshot({ path: "test-results/demo/ghost-in-spine.png" });
		// THE SUMMON (operator scenario): clicking the spine ghost brings back
		// the OPENER conversation too — the glass never lands as an orphan.
		await page.locator('[data-testid="sidebar-session-card"]', { hasText: "Browser — " }).first().click();
		await expect(page.getByTestId("panel-browser")).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId("conversation-header")).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId("browser-status")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
		await page.screenshot({ path: "test-results/demo/summon-family-back.png" });
		// FOCUS CONTRACT: the operator clicked the BROWSER — the selection
		// ring must be on the glass column, not stolen back by the opener.
		const glassColumn = page.locator(".column:has([data-testid=\"panel-browser\"])");
		await expect(glassColumn).toHaveClass(/selected/, { timeout: 10_000 });
	});

	test("02 the HEADER KILL path: browse-close (trash) kills the session and prunes the ghost", async ({ page, request }) => {
		await openGlass(page);
		await expect(page.getByTestId("browser-status")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
		const mine = await panelSession(page, request);
		await page.getByTestId("panel-browser").getByTestId("browse-close").click();
		await expect(page.getByTestId("panel-browser")).toHaveCount(0);
		// Amendment 1: the header verb is a FULL CLOSE — the wire session is
		// killed (page route 404) and the slot pruned so no ghost row remains.
		await expect.poll(async () => (await request.get("/api/browser/" + mine.id + "/page")).status()).toBe(409);
		await expect(page.locator("[data-testid=sidebar-ghost-row]")).toHaveCount(0, { timeout: 10_000 });
	});
});