/* eslint-disable */
/**
 * Job Row Live Gate (The Job Bridge, ADR-0081) — the DoD's surface checks
 * against a REAL floor with REAL live harness jobs. The repo's live-gate
 * pattern (job-badge-live-gate.mjs): a headed Chromium driven by Playwright.
 *
 *   node tests/e2e/job-row-live-gate.mjs [baseUrl] [outDir]
 *
 * Two real background jobs are needed; the script prints a marker when each
 * must be started, and waits up to LIVE_WAIT_MS for its row:
 *   >>> START JOB live NOW     — an UNPIPED job running ~120 s whose command
 *                                 contains the text  job-bridge LIVE
 *   >>> START JOB dismiss NOW  — an UNPIPED job running ~60 s whose command
 *                                 contains the text  job-bridge DISMISS
 * (e.g. `for i in $(seq 24); do echo "job-bridge LIVE $i"; sleep 5; done`).
 *
 * Checks (DoD D1–D7): D1 a born job paints its row with no click; D3 a
 * keystroke aimed at the row opens no terminal write; D4 a dismissed live row
 * stays closed past one spine tick; D5 a refresh restores rows for LIVE jobs
 * only; D6 no -J tab; D7 the roster click attaches, the roster clear closes.
 * Writes screenshots + summary.json to outDir; exit 0 only if every check
 * passes.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5202';
const outDir = process.argv[3] ?? 'tmp/job-bridge-live-gate';
const LIVE_WAIT_MS = 60_000;
const TICK_MS = 7_500; // > one 5000 ms spine tick
mkdirSync(outDir, { recursive: true });

const results = [];
function check(id, name, pass, evidence) {
	results.push({ id, name, pass: !!pass, evidence });
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}  ${JSON.stringify(evidence)}`);
}
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(2) + 's';

const browser = await chromium.launch({ headless: false, slowMo: 60 });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
/** Every terminal /send POST the page makes, with its body: an `action`
 *  (close, kill…) is a CONTROL verb; a body without one is a KEYSTROKE write. */
const sends = [];
page.on('request', (req) => {
	if (req.method() === 'POST' && /\/api\/terminal\/[^/]+\/send/.test(req.url())) {
		let body = null;
		try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = req.postData(); }
		sends.push({ at: stamp(), action: body && typeof body === 'object' ? body.action ?? null : null });
	}
});
const keystrokes = (since) => sends.slice(since).filter((s) => s.action === null);

/** Every job row: its HEADER label (the command — the span[title] carries it whole),
 *  state, and what it must never contain. Rows are told apart by LABEL, never by
 *  text: this gate script is itself a background job whose own row streams this
 *  file's stdout — which contains every needle a text match would look for. */
const rows = () =>
	page.evaluate(() =>
		[...document.querySelectorAll('[data-testid="terminal-job-row"]')].map((e) => ({
			state: e.getAttribute('data-state'),
			label: e.querySelector('span[title]')?.getAttribute('title') ?? '',
			text: (e.textContent || '').replace(/\s+/g, ' '),
			xterm: e.querySelectorAll('.xterm, textarea').length,
			tabindex: e.getAttribute('tabindex')
		}))
	);
/** The row whose LABEL starts with the marker (the gate's own row never does). */
const liveRowsWith = async (marker) => (await rows()).filter((r) => r.label.includes(marker));
const countWith = (needle) => page.evaluate((n) => [...document.querySelectorAll('[data-testid="terminal-job-row"]')].filter((e) => (e.querySelector('span[title]')?.getAttribute('title') || '').includes(n)).length, needle);
const jTabs = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="terminal-tab-button-"]')].filter((b) => /-J/.test(b.textContent || '')).length);
const badge = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="job-badge-trigger"]')].map((b) => (b.textContent || '').trim()));

async function mountDesk() {
	for (let i = 0; i < 3; i++) {
		if (await page.locator('[data-testid="terminal-desk"]').count()) return true;
		await page.keyboard.press('Alt+KeyS');
		await page.waitForTimeout(350);
		await page.keyboard.press('KeyT');
		try { await page.locator('[data-testid="terminal-desk"]').waitFor({ state: 'visible', timeout: 7000 }); return true; } catch {}
	}
	return false;
}
async function openSidebar() {
	for (let i = 0; i < 2; i++) {
		if (!(await page.locator('[data-testid="app-sidebar-collapsed"]').count())) return true;
		await page.keyboard.press('Alt+KeyS');
		await page.waitForTimeout(350);
		await page.keyboard.press('KeyS');
		await page.waitForTimeout(2500);
	}
	return !(await page.locator('[data-testid="app-sidebar-collapsed"]').count());
}
/** Load the floor and wait for HYDRATION — never for `load`: in a dev-server
 *  floor a reload with the terminal panel restored can hold the page's `load`
 *  event for minutes (lazily compiled message modules), long after the app is
 *  interactive. The signal is the sidebar's session rows, which exist only
 *  after the first client fetch; a collapsed sidebar (no rows) falls through to
 *  the mount retry loop. Then mount the desk + sidebar. */
async function loadFloor() {
	await page.goto(base, { waitUntil: 'commit', timeout: 60_000 });
	try {
		await page.waitForFunction(() => {
			const s = document.querySelector('[data-testid="sidebar-sessions"]');
			return !!s && s.children.length > 0;
		}, null, { timeout: 60_000, polling: 500 });
	} catch {
		// no sidebar rows in 60 s (collapsed sidebar) — the mount loop decides
	}
	await page.waitForTimeout(2500);
	const desk = await mountDesk();
	const sidebar = await openSidebar();
	return { desk, sidebar };
}
async function waitFor(needle, timeout) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if ((await countWith(needle)) > 0) return Date.now() - start;
		await page.waitForTimeout(100);
	}
	return null;
}

try {
	// ── F1: the floor mounts, the desk opens through the public chord ──
	const f1 = await loadFloor();
	const before = await rows();
	await page.screenshot({ path: `${outDir}/00-floor-mounted.png` });
	check('F1', 'the lane floor mounts and the desk opens via Alt+S → t', f1.desk && f1.sidebar, { ...f1, rowsBefore: before.length, badges: await badge() });

	// ── D1: a job born while the desk is mounted paints its row, no click ──
	console.log('>>> START JOB live NOW');
	const born = await waitFor('job-bridge LIVE', LIVE_WAIT_MS);
	await page.waitForTimeout(600);
	const bornRows = await rows();
	await page.screenshot({ path: `${outDir}/01-born-row.png` });
	const liveRow = bornRows.find((r) => r.label.includes('job-bridge LIVE'));
	check('D1', 'a born job paints a live row under the selected tab with NO click', born !== null && liveRow?.state === 'live', { rowSeenAfterMs: born, liveRowsNow: bornRows.filter((r) => r.state === 'live').length, allRows: bornRows.map((r) => ({ state: r.state, head: r.label.slice(0, 58) })), row: liveRow ? { state: liveRow.state, xterm: liveRow.xterm, tabindex: liveRow.tabindex, head: liveRow.label.slice(0, 120) } : null });
	await page.waitForTimeout(6500); // let it stream
	const streamed = (await liveRowsWith('job-bridge LIVE'))[0];
	check('D1b', 'the row streams the job\'s output', !!streamed && /LIVE [2-9]/.test(streamed.text), { tail: streamed?.text.slice(-150) ?? null });
	check('D6', 'no T*-J tab button renders', (await jTabs()) === 0, { jTabs: await jTabs(), tabs: await page.evaluate(() => [...document.querySelectorAll('[data-testid^="terminal-tab-button-"]')].map((b) => (b.textContent || '').trim())) });

	// ── D5 (live half): a refresh while the job runs restores its row ──
	const r0 = Date.now();
	const f1b = await loadFloor();
	const reloadToDeskMs = Date.now() - r0;
	const restoredIn = await waitFor('job-bridge LIVE', 45_000);
	const restoredRows = await rows();
	await page.screenshot({ path: `${outDir}/02-restored-live.png` });
	const liveAgain = restoredRows.find((r) => r.label.includes('job-bridge LIVE'));
	check('D5-live', 'a refresh while the job is live restores its row', f1b.desk && restoredIn !== null && liveAgain?.state === 'live', { reloadToDeskMs, rowSeenAfterDeskMs: restoredIn, state: liveAgain?.state ?? null });

	// ── D5 (settled): the row settles when the job ends ──
	let settled = null;
	{
		const start = Date.now();
		while (Date.now() - start < 150_000) {
			const r = (await liveRowsWith('job-bridge LIVE'))[0];
			if (r?.state === 'settled') { settled = Date.now() - start; break; }
			if (!r) break; // autoClose is off by default, so the row must STAY
			await page.waitForTimeout(500);
		}
	}
	const settledRow = (await liveRowsWith('job-bridge LIVE'))[0];
	await page.screenshot({ path: `${outDir}/03-settled.png` });
	check('D5-settle', 'the row flips to settled when the job ends and the tail stays readable', settled !== null && !!settledRow, { settledAfterMs: settled, tail: settledRow?.text.slice(-140) ?? null });

	// ── D4 + D7: a dismissed live row stays closed; the roster click attaches ──
	console.log('>>> START JOB dismiss NOW');
	const born2 = await waitFor('job-bridge DISMISS', LIVE_WAIT_MS);
	const dismissRow = page.locator('[data-testid="terminal-job-row"]', { has: page.locator('span[title*="job-bridge DISMISS"]') }).first();
	const pre = (await liveRowsWith('job-bridge DISMISS'))[0]; // must be LIVE when dismissed
	const sendsBefore = sends.length;
	await dismissRow.locator('[data-testid="terminal-job-row-close"]').click();
	await page.waitForTimeout(TICK_MS); // more than one spine tick
	const stillThere = (await liveRowsWith('job-bridge DISMISS')).length;
	const badgeDuring = await badge();
	await page.screenshot({ path: `${outDir}/04-dismissed-after-tick.png` });
	check('D4', 'a dismissed LIVE row stays closed past one spine tick', born2 !== null && pre?.state === 'live' && stillThere === 0, { rowSeenAfterMs: born2, stateWhenDismissed: pre?.state ?? null, waitedMs: TICK_MS, rowsForThatJobAfter: stillThere, badges: badgeDuring });
	// D7 — the REAL roster click: the owner session's job badge opens the popover
	// (JobRosterList); its label button calls openJobTab on the desk's own bus.
	// (A dynamic import of the bus module from this script would be a SECOND
	// module instance under vite's HMR-timestamped URLs — never a proof.)
	// The badge renders only once the heartbeat scope's tick has refreshed the owner
	// session's roster (RowJobBadge is a pure reader) — in a fresh context that can
	// take a few ticks, so wait for it rather than assume it.
	let badgeAt = null;
	{
		const bt = Date.now();
		while (Date.now() - bt < 25_000) { if (await page.locator('[data-testid="job-badge-trigger"]').count()) { badgeAt = Date.now() - bt; break; } await page.waitForTimeout(250); }
	}
	if (badgeAt === null) {
		check('D7-click', 'the roster click attaches the row (the badge popover\'s label button)', false, { inconclusive: 'no job badge rendered within 25 s — the owner session\'s roster was never refreshed in this context' });
		await page.screenshot({ path: `${outDir}/05-no-badge.png` });
	} else {
	await page.locator('[data-testid="job-badge-trigger"]').first().click();
	await page.locator('[data-testid="job-badge-popover"]').first().waitFor({ state: 'visible', timeout: 8000 });
	const openBtn = page.locator('[data-testid="job-badge-popover"] [data-testid^="job-open-"]', { hasText: 'job-bridge DISMISS' }).first();
	const openTitle = await openBtn.getAttribute('title');
	const jobId = ((await openBtn.getAttribute('data-testid')) ?? '').replace('job-open-', ''); // captured while the popover is open
	const clearBtn = page.locator('[data-testid="job-badge-popover"] [data-testid^="job-clear-"]', { hasText: 'job-bridge DISMISS' }).first();
	const clearTitle = await clearBtn.getAttribute('title').catch(() => null);
	await openBtn.click();
	const reattached = await waitFor('job-bridge DISMISS', 8_000);
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${outDir}/05-roster-click-attached.png` });
	check('D7-click', 'the roster click attaches the row (the badge popover\'s label button)', reattached !== null, { badgeSeenAfterMs: badgeAt, rowSeenAfterMs: reattached, openTitle });
	}
	// D3 — a keystroke aimed at the row reaches no session. Scope the window to the
	// typing itself: control verbs (close/kill) are not keystrokes and are not counted.
	if (await page.locator('[data-testid="job-badge-popover"]').count()) await page.locator('[data-testid="job-badge-trigger"]').first().click(); // toggle the popover shut
	await page.waitForTimeout(300);
	const target = page.locator('[data-testid="terminal-job-row"]', { has: page.locator('span[title*="job-bridge DISMISS"]') }).first().locator('[data-testid="job-tail"]');
	await target.click(); // focus lands on the row's own wrapper (tabindex -1)
	const focusBeforeTyping = await page.evaluate(() => ({ tag: document.activeElement?.tagName, inRow: !!document.activeElement?.closest('[data-testid="terminal-job-row"]'), inXterm: !!document.activeElement?.closest('.xterm') }));
	const sendsBeforeTyping = sends.length;
	await page.keyboard.type('echo SHOULD_NOT_REACH');
	await page.keyboard.press('Enter');
	await page.waitForTimeout(900);
	const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, inRow: !!document.activeElement?.closest('[data-testid="terminal-job-row"]'), inXterm: !!document.activeElement?.closest('.xterm') }));
	const keystrokesDuringTyping = keystrokes(sendsBeforeTyping);
	await page.screenshot({ path: `${outDir}/06-typed-at-row.png` });
	check('D3', 'typing into a job row reaches no session', keystrokesDuringTyping.length === 0 && focus.inRow === true && focus.inXterm === false, { focusBeforeTyping, focusAfterTyping: focus, keystrokeWritesDuringTyping: keystrokesDuringTyping.length, allSendPostsInWindow: sends.slice(sendsBeforeTyping) });
	
	// D7 clear — the popover's REAL clear button closes the row (a dismissing close).
	// Its testid is job-clear-<jobId>; the id comes from the label button's testid.

	if (!(await page.locator('[data-testid="job-badge-popover"]').count())) await page.locator('[data-testid="job-badge-trigger"]').first().click();
	await page.locator('[data-testid="job-badge-popover"]').first().waitFor({ state: 'visible', timeout: 8000 });
	const clearById = page.locator('[data-testid="job-badge-popover"] [data-testid="job-clear-' + jobId + '"]');
	const clearTitle2 = await clearById.getAttribute('title');
	await clearById.click();
	await page.waitForTimeout(600);
	check('D7-clear', 'the roster clear closes the row', (await liveRowsWith('job-bridge DISMISS')).length === 0, { jobId, clearTitle: clearTitle2, rowsAfter: (await liveRowsWith('job-bridge DISMISS')).length });
	
	// ── D5 (finished): after the job ends, a refresh restores no row for it ──
	{
		const start = Date.now();
		while (Date.now() - start < 90_000) {
			const r = (await rows()).find((x) => x.text.includes('job-bridge DISMISS'));
			if (r?.state === 'settled') break;
			await page.waitForTimeout(500);
		}
	}
	const r1 = Date.now();
	const f1c = await loadFloor();
	const reload2ToDeskMs = Date.now() - r1;
	await page.waitForTimeout(8_000); // two roster frames / one full tick
	const finalRows = await rows();
	await page.screenshot({ path: `${outDir}/06-finished-not-restored.png` });
	check('D5-finished', 'a refresh restores NO row for a finished job', f1c.desk && (await countWith('job-bridge DISMISS')) === 0 && (await countWith('job-bridge LIVE')) === 0, { reload2ToDeskMs, rowsAfter: finalRows.map((r) => r.text.slice(0, 60)) });
	check('D6b', 'still no T*-J tab after every reload', (await jTabs()) === 0, { jTabs: await jTabs() });
} catch (err) {
	check('X', 'the run completed without an exception', false, { error: String(err && err.message || err).split('\n')[0] });
	await page.screenshot({ path: `${outDir}/99-exception.png` }).catch(() => {});
} finally {
	const summary = { base, at: new Date().toISOString(), totalMs: Date.now() - t0, pass: results.every((r) => r.pass), results, terminalWritesSeen: sends.length };
	writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
	console.log(`SUMMARY ${summary.pass ? 'PASS' : 'FAIL'} — ${results.filter((r) => r.pass).length}/${results.length} checks — ${outDir}/summary.json`);
	await browser.close();
	process.exit(summary.pass ? 0 : 1);
}