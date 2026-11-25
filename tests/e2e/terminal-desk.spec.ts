/**
 * terminal-desk.spec (Terminal Desk Wave 5, task 5.1) — the desk end-to-end
 * against the built app and REAL PTYs: bare opens the desk; --split-down
 * stacks a second shell; --new-tab appends and selects a tab; a hard
 * reload rebuilds the SAME arrangement from the probe (no duplicate
 * sessions); tab x empties the server's session list with the server
 * alive. The flag flips via the run's disposable settings.yaml
 * (DSI_CONFIG_PATH seam) — never the operator's real ~/.dsi.
 */
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { DshStubHost, STUB_SESSION_ID } from './dsh-stub';

const STUB_PORT = 4590; // shared webServer stub (DSH_BASE_URL)
let stub: DshStubHost | undefined;

test.beforeAll(async () => {
	stub = new DshStubHost(STUB_PORT);
	await stub.start();
});

test.afterAll(async () => {
	await stub?.stop();
});

const configPath = process.env.DSI_CONFIG_PATH ?? '';

function writeConfig(enabled: boolean): void {
	writeFileSync(
		configPath,
		'home:\n  refreshMs: 1000\nterminal:\n  enabled: ' + (enabled ? 'true' : 'false') + '\n',
		'utf-8'
	);
}

async function run(page: import('@playwright/test').Page, line: string): Promise<void> {
	const input = page.locator('textarea').first();
	await input.fill(line);
	await input.press('Enter');
}

test('desk end-to-end — split, tab, reload survival, tab close kills all', async ({ page }) => {
	test.setTimeout(90_000);
	writeConfig(true);
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible({ timeout: 30_000 });

	// 1.1 — bare: the desk exists with tab[0]/row[0]
	await run(page, '/dsi-terminal');
	await expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('terminal-desk')).toBeVisible();
	await expect(page.getByTestId('terminal-tab-button-0')).toHaveAttribute('data-selected', 'true');

	// 1.1.1 — split-down: two rows in tab[0]
	await run(page, '/dsi-terminal --split-down');
	await expect(page.getByTestId('terminal-split-container')).toHaveAttribute('data-rows', '2', { timeout: 20_000 });
	await expect
		.poll(async () => (await (await page.request.get('/api/terminal')).json()).sessions.filter((s: { exited: boolean }) => !s.exited).length, { timeout: 20_000 })
		.toBe(2);

	// 1.2 — new-tab: tab[1] selected, tab[0] hidden, THREE live sessions
	await run(page, '/dsi-terminal --new-tab');
	await expect(page.getByTestId('terminal-tab-button-1')).toHaveAttribute('data-selected', 'true', { timeout: 20_000 });
	await expect(page.getByTestId('terminal-tab-container-0')).toHaveAttribute('data-visible', 'false');
	await expect(page.getByTestId('terminal-tab-container-1')).toHaveAttribute('data-visible', 'true');
	await expect
		.poll(async () => (await (await page.request.get('/api/terminal')).json()).sessions.filter((s: { exited: boolean }) => !s.exited).length, { timeout: 20_000 })
		.toBe(3);

	// THE SURVIVAL PROMISE — hard reload: same arrangement, same selection,
	// NO duplicate sessions (the rebuild ladder re-attaches, never re-opens).
	await page.reload();
	await expect(page.getByTestId('terminal-desk')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('terminal-tab-button-1')).toHaveAttribute('data-selected', 'true', { timeout: 20_000 });
	await expect(page.getByTestId('terminal-tab-container-0')).toHaveAttribute('data-visible', 'false');
	await expect(page.getByTestId('terminal-tab-container-1')).toHaveAttribute('data-visible', 'true');
	const after = (await (await page.request.get('/api/terminal')).json()).sessions.filter((s: { exited: boolean }) => !s.exited);
	expect(after.length).toBe(3); // re-attached, never duplicated

	// D5 — tab x (the selected one) closes ITS rows only; the other tab's
	// shell keeps running; the server is alive and answers.
	await page.getByTestId('terminal-tab-close-1').click();
	await expect
		.poll(async () => (await (await page.request.get('/api/terminal')).json()).sessions.filter((s: { exited: boolean }) => !s.exited).length, { timeout: 20_000 })
		.toBe(2); // tab[1] held ONE row — tab[0]'s two shells keep running
	const status = await (await page.request.get('/api/terminal')).status();
	expect(status).toBe(200); // the server survived the whole scenario
});

/** A composer command, retried across HYDRATION (the R9 lesson: a fill or an
 *  Enter before the bundle wires the composer is lost; survival-matrix.spec.ts's
 *  fillUntil exists for the same trap). The access-mode chip is SSR HTML, so its
 *  visibility says nothing about hydration. Send, probe for the EFFECT, retry. */
async function runUntil(page: import('@playwright/test').Page, line: string, probe: () => Promise<void>): Promise<void> {
	for (let i = 0; i < 10; i++) {
		const input = page.locator('textarea').first();
		await input.fill('');
		await input.fill(line);
		await input.press('Enter');
		try {
			await probe();
			return;
		} catch {
			// pre-hydration keystroke lost: retry
		}
	}
	throw new Error('the composer command never took effect: ' + line);
}

/**
 * The Job Bridge (ADR-0081, Task 4.4): a born job paints its ROW. A browser e2e
 * cannot start a real DSH job, so the job endpoints are mocked with page.route,
 * BEFORE the first goto: /api/dsh/jobs/stream (the roster push),
 * /api/dsh/jobs/follow (one job's output) and the roster SNAPSHOT
 * (/api/dsh/jobs?sessionId= / ?sessionIds=) that the rebuild probe reads. Each
 * fulfilled SSE body ends at once, so the browser's EventSource reconnects and
 * re-receives it — adoption is idempotent, and `retry: 500` keeps that quick.
 */
test('job row end-to-end — a born job paints its row with no click, no -J tab, non-focusable; a closed row stays closed across a reload', async ({ page }) => {
	test.setTimeout(120_000);
	writeConfig(true); // jobs.autoAttach on (the default), autoClose off (the default)

	const OWNER = STUB_SESSION_ID;
	const JOB_ID = 'bash-e2e-0001';
	type Status = 'running' | 'completed';
	/** The DSH job view shape as the roster wire carries it. */
	const jobView = (status: Status) => ({
		id: JOB_ID,
		kind: 'bash',
		label: 'code coverage',
		owner: OWNER,
		status,
		startedAt: 1,
		output: { total: 128, earliest: 0 }
	});
	let phase: Status = 'running';
	let streamDeliveries = 0; // roster frames the desk's push stream received

	// route.fulfill takes a headers OBJECT: an array here is not applied, the body
	// ships without a MIME type and the EventSource fails for good (no reconnect)
	const streamHeaders = { 'content-type': 'text/event-stream' };
	const sse = (events: unknown[]): string =>
		'retry: 500\n\n' + events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('');

	await page.route(/\/api\/dsh\/jobs\/stream/, async (route) => {
		streamDeliveries += 1;
		await route.fulfill({ status: 200, headers: streamHeaders, body: sse([{ sessionId: OWNER, jobs: [jobView(phase)] }]) });
	});
	await page.route(/\/api\/dsh\/jobs\/follow\?/, async (route) =>
		route.fulfill({
			status: 200,
			headers: streamHeaders,
			body: sse([
				{ type: 'opened', job: jobView(phase), from: 0 },
				{ type: 'output', text: 'RUN src/a.test.ts\n', next: 20 },
				{ type: 'output', text: 'RUN src/b.test.ts\n', next: 40 },
				...(phase === 'completed' ? [{ type: 'status', job: jobView('completed') }] : [])
			])
		})
	);
	// the roster SNAPSHOT: the singular form a first watch / the rebuild probe
	// reads, and the spine tick's batch form. The kill POST is not ours.
	await page.route(/\/api\/dsh\/jobs(\?.*)?$/, async (route) => {
		if (route.request().method() !== 'GET') return route.continue();
		const url = new URL(route.request().url());
		const roster = (id: string | null) => (id === OWNER ? { jobs: [jobView(phase)] } : { jobs: [] });
		const ids = (url.searchParams.get('sessionIds') ?? '').split(',').filter((id) => id !== '');
		const body =
			ids.length > 0
				? { ok: true, rosters: Object.fromEntries(ids.map((id) => [id, roster(id)])) }
				: { ok: true, sessionId: url.searchParams.get('sessionId'), ...roster(url.searchParams.get('sessionId')) };
		await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
	});

	// (1) a live job: the row paints under the selected tab with NO click
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('access-mode-chip')).toBeVisible({ timeout: 30_000 });
	await runUntil(page, '/dsi-terminal', () => expect(page.getByTestId('panel-terminal')).toBeVisible({ timeout: 3_000 }));
	const row = page.getByTestId('terminal-job-row');
	await expect(row).toBeVisible({ timeout: 20_000 }); // nobody clicked anything
	await expect(row).toHaveAttribute('data-state', 'live');
	// under the SELECTED tab, stacked after the shell (1 shell + 1 job row)
	const selected = page.getByTestId('terminal-tab-container-0');
	await expect(selected).toHaveAttribute('data-visible', 'true');
	await expect(selected.getByTestId('terminal-job-row')).toBeVisible();
	await expect(selected.getByTestId('terminal-split-container')).toHaveAttribute('data-rows', '2');
	await expect(selected.getByTestId('job-tail')).toContainText('RUN src/a.test.ts');
	// the tab strip shows no -J tab: the one tab is the shell
	const tabButtons = page.locator('[data-testid^="terminal-tab-button-"]');
	await expect(tabButtons).toHaveCount(1);
	await expect(tabButtons.filter({ hasText: '-J' })).toHaveCount(0);
	await expect(tabButtons.first()).toHaveAttribute('data-selected', 'true');

	// (2) the row is non-focusable: tabindex -1, and clicking its tail parks
	// focus on no xterm (no textarea is focused)
	await expect(row).toHaveAttribute('tabindex', '-1');
	await row.getByTestId('job-tail').click();
	await expect(page.locator('textarea:focus')).toHaveCount(0);

	// (3) the job settles: the follow stream reconnects and delivers `status completed`
	phase = 'completed';
	await expect(row).toHaveAttribute('data-state', 'settled', { timeout: 15_000 });
	await page.getByTestId('terminal-job-row-close').click();
	await expect(page.getByTestId('terminal-job-row')).toHaveCount(0);
	// the closed row leaves the persisted mirror (the reload's remembered half)
	const rememberedJobs = () =>
		page.evaluate(() => {
			const blob = JSON.parse(localStorage.getItem('dsi-panels') ?? '{}') as {
				panels?: Array<{ kind: string; desk?: { jobs?: unknown[] } }>;
			};
			return (blob.panels ?? []).filter((p) => p.kind === 'terminal').flatMap((p) => p.desk?.jobs ?? []).length;
		});
	await expect.poll(rememberedJobs).toBe(0);

	// (4) reload, the job now completed on every endpoint: a finished job restores
	// CLOSED — no row — and still no -J tab; the terminal panel survives the reload
	const before = streamDeliveries;
	await page.reload();
	await expect(page.getByTestId('terminal-desk')).toBeVisible({ timeout: 20_000 });
	// two roster frames after the reload: the first can be held until the config
	// lands (never judged on the default), the second is a full re-delivery
	await expect.poll(() => streamDeliveries - before).toBeGreaterThanOrEqual(2);
	await expect(page.getByTestId('terminal-tab-button-0')).toBeVisible({ timeout: 20_000 });
	await expect(page.getByTestId('terminal-job-row')).toHaveCount(0);
	await expect(page.locator('[data-testid^="terminal-tab-button-"]').filter({ hasText: '-J' })).toHaveCount(0);
});

