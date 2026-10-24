/**
 * LIVE DEMO (operator request): BrowserClosed (trash) — watch
 * SidebarOpenPanels. Screenshots land in test-results/demo/ at each
 * step; every assertion states what the operator should see.
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
	const list = (await fetch("http://127.0.0.1:5176/api/browser").then((r) => r.json()).catch(() => ({ sessions: [] }))) as { sessions: Array<{ id: string }> };
	for (const s of list.sessions) await fetch("http://127.0.0.1:5176/api/browser/" + s.id + "/close", { method: "POST" }).catch(() => undefined);
	await stub?.stop();
});

test.describe.serial("DEMO: BrowserClosed trash -> SidebarOpenPanels", () => {
	test.setTimeout(120_000);

	test("open glass -> trash -> the row is REMOVED (not folded)", async ({ page, request }) => {
		const shot = (n: string) => `test-results/demo/${n}.png`;
		await page.goto("/?sessionKey=" + STUB_SESSION_ID);
		await expect(page.getByTestId("conversation-header")).toBeVisible();
		await page.screenshot({ path: shot("1-floor-before") });

		// 1. open the glass via the chip
		await page.getByTestId("open-browser").click();
		await expect(page.getByTestId("panel-browser")).toBeVisible();
		await expect(page.getByTestId("browser-status")).toHaveAttribute("data-status", "live", { timeout: 20_000 });
		await page.screenshot({ path: shot("2-glass-live") });

		// 2. the roster shows the mounted-glass row under the opener
		await expect(page.getByTestId("sidebar-panel-pane")).toContainText("Browser");
		await page.screenshot({ path: shot("3-roster-shows-browser") });

		// 3. THE TRASH: the icon is the bin, and the click is a FULL CLOSE
		const close = page.getByTestId("panel-browser").getByTestId("browse-close");
		await expect(close.locator("svg")).toBeVisible(); // trashbin, not an X
		await close.click();
		await expect(page.getByTestId("panel-browser")).toHaveCount(0);

		// 4. SidebarOpenPanels: the row is REMOVED — no roster row, no ghost
		await expect(page.getByTestId("sidebar-panel-pane")).not.toContainText("Browser");
		await expect(page.locator("[data-testid=sidebar-ghost-row]")).toHaveCount(0);
		const wire = (await (await request.get("/api/browser")).json()) as { sessions: Array<{ id: string }> };
		expect(wire.sessions).toHaveLength(0); // the Playwright browser is killed too
		await page.screenshot({ path: shot("4-row-removed") });
	});
});