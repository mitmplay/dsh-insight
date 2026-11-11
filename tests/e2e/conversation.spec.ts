/**
 * E2E: DSI conversation page (task 4.1) — the full POC loop against a stub
 * DSH host (tests/e2e/dsh-stub.ts). No live host required (BC-8 philosophy:
 * CI-green without dsh web; the live spike covers the real wire).
 *
 * Covers the Tasks.md 4.1 contract (route shapes per the Root-is-the-Floor
 * ADR, 2026-09-02 — the app root IS the floor):
 *   1. the root is the floor: bare / opens the workspace, the retired
 *      /conversation address 404s with a way back
 *   2. transcript loads (ledger cold load)
 *   3. optimistic user bubble on submit
 *   4. dots / Cancel states while running
 *   5. poll cadence drops to 500ms while running (vs 2000ms idle)
 */

import { expect, test } from '@playwright/test';
import { stubRuntime, STUB_SESSION_ID, STUB_USER_HELLO, STUB_OLDER_PAGE1_TEXT } from './dsh-stub';
import { DshStubHost } from './dsh-stub';
import {
	STUB_OLDER_USER_TEXT,
	STUB_REASONING_FINAL,
	STUB_TEXT_FINAL,
	STUB_TOOL_ARGS,
	STUB_TOOL_RESULT_TEXT
} from './dsh-stub';
import {
	STUB_APPROVAL_REASON,
	STUB_APPROVAL_RPC,
	STUB_APPROVAL_TOOL,
	STUB_INJECTIONS,
	STUB_QUESTIONS,
	STUB_QUESTION_CUSTOM,
	STUB_QUESTION_RPC
} from './dsh-stub';
import { stubAnswerer } from './dsh-stub';

/** Ledger event shape pushed via stubRuntime.pushEvent (spec 21/22). */
interface StubLedgerEvent {
	type: string;
	seq: number;
	time: number;
	data: Record<string, unknown>;
	view?: unknown;
}

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

type StubStateView = Awaited<ReturnType<DshStubHost['getState']>>;

async function stubState(): Promise<StubStateView> {
	const res = await fetch(stubCtl);
	return (await res.json()) as StubStateView;
}

test('01 · the root is the floor: bare / opens the workspace, no homepage', async ({ page }) => {
	// Root-is-the-Floor ADR (2026-09-02): `/` IS the conversation floor —
	// the homepage session list retired. A fresh browser carries no desk,
	// so the bare root renders the empty-workspace state, never a catalog.
	await page.goto('/');
	await expect(page.getByTestId('workspace-empty')).toBeVisible();
	await expect(page.getByTestId('sessions-list')).toHaveCount(0);
	await expect(page.getByTestId('session-card')).toHaveCount(0);
	await expect(page).toHaveURL(/\/$/);
});

test('01b · the retired /conversation address 404s with a way back', async ({ page }) => {
	// No redirect shim: the app-wide error page answers the old address,
	// and its back link is `/` itself — which opens/restores the floor.
	await page.goto(`/conversation?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('error-status')).toHaveText('404');
	await expect(page.getByTestId('error-back-home')).toBeVisible();

	await page.getByTestId('error-back-home').click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByTestId('workspace-empty')).toBeVisible();
});

test('02 · transcript loads from the ledger (cold load)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();
	// Ledger user bubble + assistant bubble render through the cold load.
	// Containment, not equality: the bubble also carries the hover-revealed
	// action row + timestamp at its bottom edge (OCI port, 2026-08-22).
	// hasText scoping (2026-08-24): the stub session has an older page and
	// the sentinel auto-loads it at open (short transcript → visible), so
	// the transcript holds MORE than one user bubble — strict mode needs
	// the tail bubble named, not the whole set.
	await expect(
		transcript.locator('[data-testid="message-bubble"][data-role="user"]', {
			hasText: STUB_USER_HELLO
		})
	).toContainText(STUB_USER_HELLO);
	// OCI two-group: text + tool chips share ONE assistant-turn bubble —
	// containment, not equality (the turn carries the whole run).
	await expect(transcript.locator('[data-testid="assistant-turn"]')).toContainText('Hi! How can I help?');
	// Header agent chip shows the host DISPLAY name (DSH picker parity),
	// not the raw preset id.
	await expect(page.getByTestId('agent-chip')).toHaveText('Main');
	// 2026-08-25: copy-id moved to the floor's PanelHeader — the
	// conversation header's id rides the cluster container attribute.
	await expect(page.getByTestId('session-id-and-name')).toHaveAttribute(
		'data-session-id',
		STUB_SESSION_ID
	);
	// The workspace chip sits PREFIXED to the title button — the stub
	// session's cwd is /tmp → basename label, full path on the tooltip.
	const wsChip = page.getByTestId('session-workspace');
	await expect(wsChip).toBeVisible();
	await expect(wsChip).toHaveText('tmp');
	await expect(wsChip).toHaveAttribute('title', '/tmp');
});

test('03 · optimistic user bubble on submit (receipt only)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	await page.getByTestId('prompt-textarea').fill('Playwright test prompt');
	await page.getByTestId('send-button').click();

	// Optimistic bubble renders immediately — before any poll can deliver it
	await expect(
		page.getByTestId('transcript').locator('[data-testid="message-bubble"][data-role="user"]', {
			hasText: 'Playwright test prompt'
		})
	).toBeVisible({ timeout: 2_000 });

	// The stub received the prompt over the DSH wire (server-side path). The
	// browser→DSI POST returns on the receipt; DSI→stub propagation is
	// server-internal and asynchronous from this assertion's view — poll for it.
	await expect
		.poll(async () => (await stubState()).promptCalls.at(-1)?.text, { timeout: 5_000 })
		.toBe('Playwright test prompt');
	await expect
		.poll(async () => (await stubState()).promptCalls.at(-1)?.mode, { timeout: 5_000 })
		.toBe('queue');
});

test('04 · dots + Cancel while running, back to Send when idle', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// Force a running turn from the stub side; the page must follow within ~2s.
	// StreamingIndicator renders inside a STREAMING assistant bubble (component
	// contract: PromptBubble children when entry.streaming) — so stream the
	// attempt over the stub's assistant-stream frames first (ledger v2: no
	// durable chunk events), then assert the dots on the real rendering path.
	const s = stub!;
	s.setRunning(true);
	s.pushLiveStreamingStart();
	await expect(page.getByTestId('running-status')).toHaveAttribute('aria-label', 'running', {
		timeout: 4_000
	});
	await expect(
		page.getByTestId('transcript').locator('[data-testid="assistant-turn"]', {
			hasText: 'streaming…'
		})
	).toBeVisible({ timeout: 4_000 });
	await expect(page.getByTestId('streaming-indicator')).toBeVisible();
	await expect(page.getByTestId('cancel-button')).toBeVisible();
	await expect(page.getByTestId('send-button')).toHaveCount(0);

	// Back to idle: Send returns. Note the component contract: the dots ride
	// the bubble's entry.streaming flag, which clears on the assistant/message
	// FINALIZE for the same turn/step (the end frame + durable settlement) —
	// not on the host running flag alone.
	s.setRunning(false);
	await s.pushLiveStreamingFinalize();
	await expect(page.getByTestId('running-status')).toHaveAttribute('aria-label', 'idle', { timeout: 4_000 });
	await expect(page.getByTestId('streaming-indicator')).toHaveCount(0);
	await expect(page.getByTestId('cancel-button')).toHaveCount(0);
	await expect(page.getByTestId('send-button')).toBeVisible();
	await expect(
		page.getByTestId('transcript').locator('[data-testid="assistant-turn"]', {
			hasText: '(finalized)'
		})
	).toBeVisible();
});

test('04b · an abandoned attempt clears its streaming bubble (never a dead partial)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	const s = stub!;
	// Phase 1: the partial streams — the bubble renders with the dots.
	s.pushAbandonedStart();
	await expect(
		page.getByTestId('transcript').locator('[data-testid="assistant-turn"]', {
			hasText: 'vanishing…'
		})
	).toBeVisible({ timeout: 4_000 });

	// Phase 2: the attempt settles WITHOUT a message (cancel/retry/stream
	// error). The poll's null liveStream drops the partial — nothing lingers
	// as a forever-streaming ghost.
	s.pushAbandonedEnd();
	await expect(
		page.getByTestId('transcript').locator('[data-testid="assistant-turn"]', {
			hasText: 'vanishing…'
		})
	).toHaveCount(0, { timeout: 4_000 });
	await expect(page.getByTestId('streaming-indicator')).toHaveCount(0);
});

test('05 · poll cadence drops to 500ms while running (vs 2000ms idle)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();
	// Idle baseline: long gaps
	const idleGaps = await measureGaps(page, 2);

	// Flip to running — gaps must shrink to fast cadence
	stub!.setRunning(true);
	await expect(page.getByTestId('running-status')).toHaveAttribute('aria-label', 'running', {
		timeout: 4_000
	});
	const runningGaps = await measureGaps(page, 2);
	stub!.setRunning(false);

	// BC-7: idle ≈ 2000ms, running ≈ 500ms — assert the ORDER with room for
	// scheduling jitter (running must be clearly faster than idle; idle must
	// not be faster than the fast cadence).
	expect(avg(runningGaps)).toBeLessThan(avg(idleGaps) / 2);
	expect(avg(idleGaps)).toBeGreaterThan(1_500);
	expect(avg(runningGaps)).toBeLessThan(1_100);
	expect(avg(runningGaps)).toBeGreaterThan(250);
});

test('06 · cancel POSTs session.cancel (red button does its job)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();
	stub!.setRunning(true);
	await expect(page.getByTestId('cancel-button')).toBeVisible({ timeout: 4_000 });
	const before = (await stubState()).cancelCalls;
	await page.getByTestId('cancel-button').click();
	await expect
		.poll(async () => (await stubState()).cancelCalls, { timeout: 4_000 })
		.toBe(before + 1);
	stub!.setRunning(false);
});

test('07 · BC-1 — browser never talks to the DSH host directly', async ({ page }) => {
	const forbidden: string[] = [];
	page.on('request', (req) => {
		const u = req.url();
		if (u.includes(':3080') || u.includes(':4590')) forbidden.push(u);
	});
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();
	await page.waitForTimeout(2_200); // one idle poll + margin
	expect(forbidden).toEqual([]);
});

// ── POC-2 Wave 4 (task 4.1): the Honest Inspector surfaces ────────────────

test('08 · tool chip renders pass; popup carries args + result panes (no layout push)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();

	// One chip per call — plain wire name + status dot; the paired standalone
	// result chip is SUPPRESSED (renderEntries rule).
	const call = transcript.locator('[data-testid="tool-chip"][data-kind="call"]');
	await expect(call.first()).toHaveAttribute('data-status', 'pass', { timeout: 5_000 });
	await expect(call.first()).toContainText('grep'); // plain wire name (chip simplification)
	// No paired result chip rides the row anymore (G5 double-chip fixed):
	await expect(transcript.locator('[data-testid="tool-chip"][data-kind="result"]')).toHaveCount(0);

	// Expand: the POPUP (after the chip row) carries the panes — never inside
	// the chip, so same-row chips never move (OCI ChipPopup pattern).
	// Measured CONTENT-RELATIVE (viewport y − container top + scrollTop):
	// opening the popup grows the transcript below the chip and the
	// stick-to-bottom primitive scrolls the container — a container scroll
	// is not a layout push, and a viewport-relative boundingBox would
	// conflate the two (0.1.2 stub migration, 2026-08-30).
	const contentY = async (): Promise<number> => {
		const chipBox = await call.first().boundingBox();
		const trBox = await transcript.boundingBox();
		const scrollTop = await transcript.evaluate((el) => el.scrollTop);
		return (chipBox?.y ?? 0) - (trBox?.y ?? 0) + scrollTop;
	};
	const chipTopBefore = await contentY();
	await call.first().getByTestId('tool-chip-toggle').click();
	const args = transcript.getByTestId('tool-chip-args');
	await expect(args).toBeVisible();
	await expect(args).toContainText(STUB_TOOL_ARGS);

	// The paired RESULT also rides the popup — one popup, both panes.
	const resultPane = transcript.getByTestId('tool-chip-result');
	await expect(resultPane).toBeVisible();
	await expect(resultPane).toContainText(STUB_TOOL_RESULT_TEXT);

	// The chip itself did NOT move when the popup opened (no layout push).
	const chipTopAfter = await contentY();
	expect(Math.abs(chipTopAfter - chipTopBefore)).toBeLessThan(1);
});

test('09 · fail path — isError result flips the call red and shows the error', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// Push the fail turn over the wire; the poll delivers it (~≤2s).
	stubRuntime!.runInspectorScenario();
	const transcript = page.getByTestId('transcript');
	// Chip simplification: `shell` renders its plain wire name.
	const failCall = transcript.locator('[data-testid="tool-chip"][data-kind="call"]', {
		hasText: 'shell'
	});
	await expect(failCall).toHaveAttribute('data-status', 'fail', { timeout: 6_000 });

	// One chip per call: the error result rides the SAME call chip (no second
	// result chip for the paired id — renderEntries suppression), duration
	// 250ms from the wire pair on the call row.
	await expect(failCall.getByTestId('tool-chip-duration')).toHaveCount(0); // duration off the chip (simplification)
	await expect(transcript.locator('[data-testid="tool-chip"][data-kind="result"]')).toHaveCount(0);
	await failCall.getByTestId('tool-chip-toggle').click();
	await expect(transcript.getByTestId('tool-chip-result')).toContainText('boom: path not found');

	// Pass chip from the seed pair is still pass — one fail does not stain.
	const grepCall = transcript.locator('[data-testid="tool-chip"][data-kind="call"]', {
		hasText: 'grep'
	});
	await expect(grepCall.first()).toHaveAttribute('data-status', 'pass');
});

test('10 · reasoning streams collapsed, finalizes authoritative; markdown bold renders', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// Stream the reasoning-then-text step over the wire (spec 09's scenario
	// pushes the reasoning turn too — wait for the SECTION to appear).
	stubRuntime!.runInspectorScenario();
	const transcript = page.getByTestId('transcript');
	const section = transcript.getByTestId('reasoning-section');
	await expect(section.first()).toBeVisible({ timeout: 6_000 });

	// Collapsed by default: header present, body absent.
	await expect(section.first()).toHaveAttribute('data-open', 'false');
	await expect(transcript.getByTestId('reasoning-body')).toHaveCount(0);

	// The finalize is authoritative: expand shows the FINAL reasoning block,
	// not the streamed fragment concatenation order alone.
	await section.first().getByTestId('reasoning-toggle').click();
	const body = transcript.getByTestId('reasoning-body');
	await expect(body.first()).toBeVisible();
	await expect(body.first()).toContainText(STUB_REASONING_FINAL);

	// Text bubble renders MARKDOWN: **files** → <strong>files</strong> (BC-12).
	// (inner text assertion uses the RENDERED form — markdown consumed the
	// asterisks; the <strong> node is the markdown proof itself.)
	const bubble = transcript.locator('[data-testid="assistant-turn"]', {
		hasText: 'files'
	});
	await expect(bubble.first()).toBeVisible({ timeout: 6_000 });
	await expect(bubble.first().locator('strong')).toHaveText('files');
	await expect(bubble.first()).toContainText(STUB_TEXT_FINAL.replace('**', '').replace('**', ''));
});

test('11 · context injections render as attributed chips, expand shows verbatim (runtime-context producer)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// Push the fixture-pinned runtime-context user message over the wire.
	await stubRuntime!.pushRuntimeContextEvent();
	const transcript = page.getByTestId('transcript');
	// W2/2.4 lockstep: RuntimeContextChip generalized into ContextInjectionChip —
	// same collapsed-chip contract, new testids + producer attribution.
	const chip = transcript.getByTestId('context-injection-chip');
	await expect(chip).toBeVisible({ timeout: 6_000 });

	// It is a CHIP, not a paragraph: collapsed label is just the title
	// (`context`); the body does not exist yet.
	await expect(chip).toHaveAttribute('data-open', 'false');
	await expect(chip).toHaveAttribute('data-producer', 'runtime-context');
	await expect(chip).toContainText('context');
	await expect(transcript.getByTestId('context-injection-body')).toHaveCount(0);

	// Expand: the stub's default sections (['env']) are deliberately
	// malformed — the all-or-nothing reader (Section Split D1) falls back
	// to the pre-split markdown body, byte-identical to before.
	await chip.getByTestId('context-injection-toggle').click();
	const body = transcript.getByTestId('context-injection-body');
	await expect(body).toBeVisible();
	await expect(body).toContainText('Current runtime context. cwd /tmp; agent research; 2 sessions open.');
	await expect(body.getByTestId('context-snapshot-supersedes')).toHaveCount(0);
});

test('11b · runtime-context sections render caption + named blocks (Section Split D2/D4)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// Proper [{name,text}] sections: the body switches to the supersedes
	// caption plus one block per section — the framing line is NOT reprinted
	// (it IS the caption, ADR D4), and the section names are verbatim wire
	// strings.
	await stubRuntime!.pushRuntimeContextEvent([
		{ name: 'sandbox:policy', text: 'Current DSH file policy: danger-full-access.' },
		{ name: 'approval:policy', text: 'Approval prompts are disabled in this session.' }
	]);
	const transcript = page.getByTestId('transcript');
	// Spec 11's malformed chip persists in the shared stub session — the
	// NEWEST chip (highest seq, this spec's push) is the section-aware one.
	// Wait for THIS spec's push to land (spec 11's chip is already in the
	// shared stub session — visibility alone would race the SSE delivery).
	const chips = transcript.getByTestId('context-injection-chip');
	await expect(chips).toHaveCount(2, { timeout: 10_000 });
	const chip = chips.last();
	await expect(chip).toHaveAttribute('data-producer', 'runtime-context');
	await chip.getByTestId('context-injection-toggle').click();
	const body = transcript.getByTestId('context-injection-body').last();
	await expect(body.getByTestId('context-snapshot-supersedes')).toBeVisible();
	const blocks = body.getByTestId('context-section');
	await expect(blocks).toHaveCount(2);
	await expect(blocks.first()).toContainText('sandbox:policy');
	await expect(blocks.first()).toContainText('danger-full-access');
	await expect(blocks.nth(1)).toContainText('approval:policy');
	// The joined prose is NOT reprinted beside the sections (ADR D2):
	// only the caption + section texts render, the framing prose is dropped.
	await expect(body).not.toContainText('cwd /tmp; agent research; 2 sessions open.');
});

test('12 · XSS attempt renders escaped — no raw HTML reaches the transcript', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// A crafted assistant finalize with markup payloads (BC-12 e2e pin).
	await stubRuntime!.pushEvent({
		type: 'assistant/message',
		seq: 940,
		time: Date.now(),
		data: {
			turn: 10,
			step: 1,
			message: {
				content: [
					{ type: 'text', text: 'xss <script>window.__xss=1</script> <img src=x onerror="window.__xss=2"> [link](javascript:alert(1))' }
				]
			}
		}
	});
	const transcript = page.getByTestId('transcript');
	const bubble = transcript.locator('[data-testid="assistant-turn"]', {
		hasText: 'xss'
	});
	await expect(bubble.first()).toBeVisible({ timeout: 6_000 });

	// The payload renders as CHARACTERS; no script/img element is created and
	// nothing executed (page.evaluate proves the runtime side).
	await expect(bubble.first()).toContainText('<script>');
	await expect(bubble.first().locator('script')).toHaveCount(0);
	await expect(bubble.first().locator('img')).toHaveCount(0);
	const fired = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss ?? 0);
	expect(fired).toBe(0);
});

test('13 · scroll-up auto-loads the older ledger page via beforeSeq', async ({ page }) => {
	// Listener FIRST — the sentinel auto-loads as soon as it approaches
	// the viewport top, so the history request can fire right at load.
	const historyReqs: string[] = [];
	page.on('request', (req) => {
		if (req.url().includes('/api/dsh/session/') && req.url().includes('/history')) historyReqs.push(req.url());
	});
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();

	// The stub tail reports hasMore → the sentinel mounts. Roll to the
	// top so the observer sees it (short transcripts already intersect)
	// — the page loads itself, no button, no click.
	await transcript.evaluate((el) => el.scrollTo({ top: 0 }));

	// GET history?beforeSeq=100 (first seq on screen) → the stub serves
	// the older page (seq 1–20, ends at 99); the page PREPENDS it.
	await expect(
		transcript.locator('[data-testid="message-bubble"][data-role="user"]', {
			hasText: STUB_OLDER_USER_TEXT
		})
	).toBeVisible({ timeout: 5_000 });
	expect(historyReqs.length).toBeGreaterThanOrEqual(1);
	expect(historyReqs[0]).toContain('beforeSeq=100');

	// The older page ends at the head (oldest=1) → hasMore:false → sentinel
	// HIDES; the tail truth survived the prepend — nothing vanished.
	await expect(page.getByTestId('load-older-sentinel')).toHaveCount(0, { timeout: 5_000 });
	await expect(transcript.locator('[data-testid="tool-chip"][data-kind="call"]').first()).toBeVisible();
	await expect(
		transcript.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: STUB_USER_HELLO }).first()
	).toBeVisible();
});

test('13d · icon color contract: global purple default, control-owned exceptions', async ({ page }) => {
	// 2026-08-26 revision: the blanket "button svg { color: inherit }" guard
	// suppressed the global purple icon default for EVERY control icon —
	// copy, image, chevrons all borrowed their button's grey. The guard is
	// gone; purple is the default again, and only the controls that own
	// their icon color (saturated send/cancel, back-to-top, pill on-states,
	// state-semantic toggles) carry scoped exceptions.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	const iconColor = (testid: string) =>
		page
			.locator(`[data-testid="${testid}"] svg`)
			.first()
			.evaluate((el) => getComputedStyle(el).color);

	// Generic affordances read the global purple identity (--color-accent-purple).
	const PURPLE = 'rgb(139, 92, 246)';
	expect(await iconColor('copy-text-button')).toBe(PURPLE); // lucide-copy
	expect(await iconColor('canvas-copy-button')).toBe(PURPLE); // lucide-image
	// Header chips (2026-08-26 follow-up): the agent chip's copy prefix
	// keeps the purple identity.
	expect(await iconColor('agent-chip-copy-id')).toBe(PURPLE);
	// The workspace chip's Folder is a control-owned exception since the
	// 2026-09-06 WorkspaceChip extraction: the chip owns its icon color
	// (the kind grammar — icon = dimension color), so the Folder wears
	// the chip's blue-deepened-toward-navy text mix, not the purple
	// default. Computed as color-mix(accent-blue 50%, #1e3a8a).
	expect(await iconColor('session-workspace')).toBe('color(srgb 0.17451 0.368627 0.752941)');

	// Control-owned: the saturated send surface keeps its white glyph.
	expect(await iconColor('send-button')).toBe('rgb(255, 255, 255)');
});

test.describe('short viewport (transcript overflows)', () => {
	// The stub conversation FITS the default 720px viewport — nothing
	// scrolls, and a fitting transcript honestly hides the scroll button.
	// A short viewport makes the transcript genuinely overflow.
	test.use({ viewport: { width: 1280, height: 320 } });

test('13b · scroll button is dual-mode: back to top ↔ scroll to bottom (OCI parity)', async ({ page }) => {
	// 2026-08-26 fix: the floating scroll button was ported top-only —
	// near the top of a long transcript it vanished, leaving no affordance
	// back to the live bottom (OCI's button flips direction instead).
	// Real-page proof: at the top the button offers the BOTTOM, deep it
	// offers the TOP, and each click lands on its far end.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();

	// Grow the transcript first (spec 13 prologue): scroll to top so the
	// sentinel loads the older ledger page — the stub's tail alone FITS
	// the viewport, and a fitting transcript honestly hides the button.
	await transcript.evaluate((el) => el.scrollTo({ top: 0 }));
	await expect(
		transcript.locator('[data-testid="message-bubble"][data-role="user"]', {
			hasText: STUB_OLDER_USER_TEXT
		})
	).toBeVisible({ timeout: 5_000 });

	// Pin to the very top (the prepend anchor moved the viewport) and
	// refresh the geometry: the button now offers the BOTTOM.
	await transcript.evaluate((el) => {
		el.scrollTop = 0;
		el.dispatchEvent(new Event('scroll'));
	});
	await expect(page.getByTestId('scroll-to-bottom')).toBeVisible();
	await expect(page.getByTestId('scroll-to-bottom')).toHaveAttribute('title', 'Scroll to bottom');
	await expect(page.getByTestId('back-to-top')).toHaveCount(0);

	// Click it — the viewport lands at (near) the bottom again, where
	// the SAME button has flipped back to "Back to top".
	await page.getByTestId('scroll-to-bottom').click();
	await expect(page.getByTestId('back-to-top')).toBeVisible({ timeout: 10_000 });
	// Title carries the Shift-drain affordance (2026-08-26): a mouse
	// modifier has no other discoverability surface — the tooltip is it.
	await expect(page.getByTestId('back-to-top')).toHaveAttribute(
		'title',
		'Back to top — Shift+click loads all history'
	);
	await expect.poll(
		async () => await transcript.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 48),
		{ timeout: 10_000 }
	).toBe(true);

	// And the round trip: click "Back to top" — lands at the top, button
	// flips to the bottom direction again.
	await page.getByTestId('back-to-top').click();
	await expect(page.getByTestId('scroll-to-bottom')).toBeVisible({ timeout: 10_000 });
	await expect.poll(
		async () => await transcript.evaluate((el) => el.scrollTop <= 48),
		{ timeout: 10_000 }
	).toBe(true);
});

test('13e · Shift+click back-to-top drains ALL older pages, then lands at the true head', async ({ page }) => {
	// 2026-08-26: a plain "Back to top" reaches only the top of the
	// LOADED window — the sentinel auto-loads one older page, the
	// prepend anchor parks the viewport, and a long conversation costs
	// one click per page. Shift+click drains every remaining page first,
	// then lands at the true head in ONE action.
	//
	// Multi-page truth: the stub's default page size serves the whole
	// older window (seq 1–20) in one page — shrink it to 10 so the
	// ledger genuinely pages (2 pages for the older window), then
	// restore in finally (sibling specs assume the 100 default).
	await fetch(`${stubCtl}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ historyPageSize: 10 })
	});
	try {
		await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
		const transcript = page.getByTestId('transcript');
		await expect(transcript).toBeVisible();

		// Grow the transcript: jump to top → the sentinel loads page 1
		// (seq 11–20, the seq-15 user bubble is its visible content) and
		// hasMore stays TRUE — the sentinel remains (page 2 is the head).
		await transcript.evaluate((el) => el.scrollTo({ top: 0 }));
		await expect(
			transcript.locator('[data-testid="message-bubble"][data-role="user"]', {
				hasText: STUB_OLDER_PAGE1_TEXT
			})
		).toBeVisible({ timeout: 5_000 });
		await expect(page.getByTestId('load-older-sentinel')).toBeVisible();

		// Park mid-list (deep mode) — the button offers the TOP.
		await transcript.evaluate((el) => {
			el.scrollTop = Math.floor(el.scrollHeight / 2);
			el.dispatchEvent(new Event('scroll'));
		});
		await expect(page.getByTestId('back-to-top')).toBeVisible();

		// Shift+click: drains BOTH older pages in one action and lands at
		// the TRUE head — the sentinel is gone (ledger head reached), the
		// oldest page's text is on screen, scrollTop is at the top, and
		// the button has flipped to the bottom direction.
		await page.getByTestId('back-to-top').click({ modifiers: ['Shift'] });
		await expect(page.getByTestId('load-older-sentinel')).toHaveCount(0, { timeout: 10_000 });
		await expect(
			transcript.locator('[data-testid="message-bubble"][data-role="user"]', {
				hasText: STUB_OLDER_USER_TEXT
			})
		).toBeVisible();
		await expect
			.poll(async () => await transcript.evaluate((el) => el.scrollTop), { timeout: 10_000 })
			.toBeLessThanOrEqual(48);
		await expect(page.getByTestId('scroll-to-bottom')).toBeVisible({ timeout: 10_000 });
	} finally {
		await fetch(`${stubCtl}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ historyPageSize: 100 })
		});
	}
});

test('13c · stick-to-bottom toggle: maroon live state, grey on release, click re-follows', async ({ page }) => {
	// 2026-08-26: the composer carries a stick-to-bottom indicator/switch
	// (ArrowDownToLine — the pinned lucide set has no layers-arrow-down)
	// directly above the submit button. Maroon (#800000) = following the
	// live bottom; grey = released. The state is LIVE: scroll events
	// flip it both ways, and a manual re-engage scrolls to the live end.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();

	// Grow the transcript past the viewport (spec 13b prologue).
	await transcript.evaluate((el) => el.scrollTo({ top: 0 }));
	await expect(
		transcript.locator('[data-testid="message-bubble"][data-role="user"]', {
			hasText: STUB_OLDER_USER_TEXT
		})
	).toBeVisible({ timeout: 5_000 });

	const toggle = page.getByTestId('stick-toggle');
	// The glyph color TRANSITIONS (150ms) — poll until it settles, never
	// read it once (a mid-transition read returns an interpolated rgb).
	const colorSettles = (expected: string): Promise<void> =>
		expect
			.poll(async () => await toggle.evaluate((el) => getComputedStyle(el).color), {
				timeout: 2_000
			})
			.toBe(expected);
	// Above the submit button: same column, toggle higher on screen.
	const send = page.getByTestId('send-button');
	const tb = await toggle.boundingBox();
	const sb = await send.boundingBox();
	expect(tb!.y).toBeLessThan(sb!.y);
	expect(tb!.x).toBeGreaterThanOrEqual(sb!.x - 4);

	// Return to the live bottom (the prologue left us at the top):
	// scrolling back re-engages the stick — the toggle must agree.
	await transcript.evaluate((el) => {
		el.scrollTop = el.scrollHeight;
		el.dispatchEvent(new Event('scroll'));
	});
	// At the bottom: maroon and pressed.
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await colorSettles('rgb(128, 0, 0)'); // maroon #800000

	// Scroll up: the stick breaks, the toggle greys — live state, no click.
	await transcript.evaluate((el) => el.scrollTo({ top: 0 }));
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await colorSettles('rgb(108, 117, 125)'); // grey rest

	// Click ON: re-engages AND jumps to the live end (the toggle's promise).
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await colorSettles('rgb(128, 0, 0)');
	await expect.poll(
		async () => await transcript.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 48),
		{ timeout: 10_000 }
	).toBe(true);

	// Explicit OFF from ON (we are at the bottom, pressed): the release
	// must NOT move the viewport — off is "stay where you are", not a jump.
	const beforeTop = await transcript.evaluate((el) => Math.round(el.scrollTop));
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	expect(await transcript.evaluate((el) => Math.round(el.scrollTop))).toBe(beforeTop);
});
});

test('14 · New chat from pill selection → create → navigate → prompt on the fresh session', async ({ page }) => {
	// 2026-08-24: no picker dialog — the SidebarSessionFilter pills ARE the
	// selection. Agent pill + workspace pill, then + New chat creates the
	// session with BOTH over the wire.
	await page.goto('/');
	await expect(page.getByTestId('sessions-list')).toBeVisible();

	// No selection yet → the button alerts and creates nothing.
	const createsBefore = (await stubState()).createCalls.length;
	await page.getByTestId('new-chat-button').click();
	await expect(page.getByTestId('new-chat-selection-alert')).toBeVisible();
	expect((await stubState()).createCalls.length).toBe(createsBefore);

	// Select agent (research) + workspace (harness), then create. The
	// filter row ships expanded (2026-09-18) — open it only if folded.
	{
		const t = page.getByTestId('filter-toggle');
		if ((await t.getAttribute('aria-expanded')) === 'false') await t.click(); // ensure open (expanded is the load default)
	}
	await expect(page.getByTestId('filter-all')).toBeVisible();
	await page.getByTestId('filter-preset-research').click();
	await page.getByTestId('filter-workspace-deepseek-harness').click();
	await page.getByTestId('new-chat-button').click();
	await page.waitForURL(/\/?sessionKey=e2e-created-/, { timeout: 5_000 });
	const created = (await stubState()).createCalls.at(-1);
	expect(created?.agentPreset).toBe('research');
	expect(created?.cwd).toBe('/Users/wharsojo/agentic-ai/deepseek-harness');

	// The fresh conversation is BLANK and carries the preset chip — then the
	// POC-1 loop works on it: prompt → receipt → stub turn streams back.
	await expect(page.getByTestId('transcript')).toBeVisible();
	// Display name parity: created with agentPreset 'research', chip reads
	// the host catalog's name for it.
	await expect(page.getByTestId('agent-chip')).toHaveText('Research');
	await expect(page.getByTestId('transcript-empty')).toBeVisible();
	await page.getByTestId('prompt-textarea').fill('first prompt on a fresh session');
	await page.getByTestId('send-button').click();
	await expect(
		page.getByTestId('transcript').locator('[data-testid="message-bubble"][data-role="user"]', {
			hasText: 'first prompt on a fresh session'
		})
	).toBeVisible({ timeout: 2_000 });
	await expect
		.poll(async () => (await stubState()).promptCalls.at(-1)?.text, { timeout: 5_000 })
		.toBe('first prompt on a fresh session');
});

test('15 · home cadence — running flips visible on an open tab within one tick', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByTestId('sessions-list')).toBeVisible();
	const card = page.locator('[data-testid="session-card"]').first();
	await expect(card.getByRole('status')).toHaveAttribute('aria-label', 'idle');

	// Flip running on the stub. No focus event fires — only the 5s tick
	// (HOME_REFRESH_MS) can bring the new state to the open tab.
	stubRuntime!.setRunning(true);
	await expect(card.getByRole('status')).toHaveAttribute('aria-label', 'running', { timeout: 10_000 });
	stubRuntime!.setRunning(false);
	await expect(card.getByRole('status')).toHaveAttribute('aria-label', 'idle', { timeout: 10_000 });
});

// ── POC-3 Wave 4 (task 4.1): the Answerer — when the harness asks, the page answers ──

test('16 · approval card renders tool+reason verbatim → Allow once → settled', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// Raise the approval over the mux wire (server-request push, stable rpcId).
	const rpc16 = stubAnswerer!.requestApproval();
	const card = page.getByTestId('approval-card');
	await expect(card).toBeVisible({ timeout: 6_000 });

	// BC-D: the card states EXACTLY what it approves — tool + reason verbatim,
	// nothing pre-selected, no "always allow" anywhere.
	await expect(card).toHaveAttribute('data-phase', 'waiting');
	await expect(card.getByTestId('approval-tool')).toContainText(`Tool approval: ${STUB_APPROVAL_TOOL}`);
	await expect(card.getByTestId('approval-reason')).toHaveText(STUB_APPROVAL_REASON);
	await expect(card.getByTestId('approval-allow')).toBeEnabled();
	await expect(card.getByTestId('approval-reject')).toBeEnabled();
	expect(await card.getByTestId('approval-allow').textContent()).toContain('Allow once');
	await expect(page.getByText('always allow', { exact: false })).toHaveCount(0);

	// One click: the wire answer posts through the respond carrier —
	// client-response envelope on /api/respond (NOT a unary method).
	const respondReqs: string[] = [];
	page.on('request', (req) => {
		if (req.url().includes('/api/dsh/session/') && req.url().includes('/respond')) respondReqs.push(req.postData() ?? '');
	});
	await card.getByTestId('approval-allow').click();

	// The stub host received the grant with the exact outcome + approvalId.
	await expect
		.poll(async () => (await stubState()).respondCalls.at(-1), { timeout: 5_000 })
		.toMatchObject({ rpcId: rpc16, payload: { approvalId: `appr-0001-${rpc16.split('-').at(-1)}`, outcome: 'allowed-once' } });
	expect(respondReqs.length).toBeGreaterThanOrEqual(1);

	// Settled by the resolved broadcast (first claimant = us): the card's
	// job is done and it UNMOUNTS entirely (2026-08-24 fix — refresh
	// parity; the dimmed settled copy used to linger until a manual
	// reload). The wire truth above is the outcome record; the transcript
	// chip owns the permanent view.
	await expect(card).toHaveCount(0, { timeout: 6_000 });
});

test('17 · reject path — the turn does not run, outcome names rejected', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	const rpc17 = stubAnswerer!.requestApproval();
	const card = page.getByTestId('approval-card');
	await expect(card).toBeVisible({ timeout: 6_000 });

	await card.getByTestId('approval-reject').click();

	// The wire answer carries the rejected outcome (verbatim payload arm).
	await expect
		.poll(async () => (await stubState()).respondCalls.at(-1)?.payload, { timeout: 5_000 })
		.toMatchObject({ approvalId: `appr-0001-${rpc17.split('-').at(-1)}`, outcome: 'rejected' });

	// Own answer settles → card unmounts (2026-08-24 contract, see 16).
	await expect(card).toHaveCount(0, { timeout: 6_000 });
});

test('18 · question card — single-select + multi-select + custom, validated before the wire', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	stubAnswerer!.requestQuestions();
	const card = page.getByTestId('question-card');
	await expect(card).toBeVisible({ timeout: 6_000 });
	await expect(card).toHaveAttribute('data-phase', 'waiting');

	// Both questions render verbatim; nothing is pre-selected (BC-D).
	const items = card.locator('[data-testid="question-item"]');
	await expect(items).toHaveCount(STUB_QUESTIONS.length);
	await expect(card.getByTestId('question-text').first()).toHaveText(STUB_QUESTIONS[0].question);
	await expect(card.locator('[data-testid="question-option"][data-checked="true"]')).toHaveCount(0);

	// The batch is incomplete → submit disabled (host rules, mirrored pre-send).
	await expect(card.getByTestId('question-submit')).toBeDisabled();
	await expect(card.getByTestId('question-submit-hint')).toContainText('every question needs an answer');

	// q1: single-select option + custom would conflict → the host mirror flags it.
	await card.locator('[data-testid="question-option"][data-label="Quick scan"]').click();
	await card.getByTestId('question-custom').first().fill(STUB_QUESTION_CUSTOM);
	await expect(card.getByTestId('question-invalid').first()).toContainText('choose either an option or your own answer');
	await expect(card.getByTestId('question-submit')).toBeDisabled();

	// Resolve honestly: keep the custom answer, clear the option (single-select
	// click on the selected option clears it).
	await card.locator('[data-testid="question-option"][data-label="Quick scan"]').click();
	// q2: multi-select — two selections allowed.
	await card.locator('[data-question-id="q2"] [data-testid="question-option"][data-label="Costs"]').click();
	await card.locator('[data-question-id="q2"] [data-testid="question-option"][data-label="Risks"]').click();
	await expect(card.getByTestId('question-submit')).toBeEnabled();

	await card.getByTestId('question-submit').click();

	// The wire answer: one batch, ids echoed, selected LABELS, custom present.
	// The value is the waterfall listener's return VERBATIM ({answers:[…]}) —
	// the legacy {answer:{answers}} wrapper crashed the live host's tool
	// (found live 2026-08-31); the stub now refuses it.
	await expect
		.poll(async () => (await stubState()).respondCalls.at(-1)?.payload, { timeout: 5_000 })
		.toMatchObject({
			sessionId: STUB_SESSION_ID,
			answers: [
				{ id: 'q1', selected: [], custom: STUB_QUESTION_CUSTOM },
				{ id: 'q2', selected: ['Costs', 'Risks'] }
			]
		});

	// Own answer settles → card unmounts (2026-08-24 contract, see 16);
	// the ask chip's QuestionBlock keeps the permanent record.
	await expect(card).toHaveCount(0, { timeout: 6_000 });
});

test('19 · answered-elsewhere — a lost race settles gracefully, never errors', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	const rpc19 = stubAnswerer!.requestApproval();
	const card = page.getByTestId('approval-card');
	await expect(card).toBeVisible({ timeout: 6_000 });

	// Another UI (DSH web) answers first: pending claimed, resolved broadcast
	// reaches us over the same mux.
	stubAnswerer!.settleElsewhere(rpc19, 'allowed-once');

	// The card settles answered-elsewhere — graceful, no error surface.
	await expect(card).toHaveAttribute('data-phase', 'answered-elsewhere', { timeout: 6_000 });
	await expect(card.getByTestId('approval-elsewhere')).toContainText('another window');
	await expect(card.getByTestId('approval-allow')).toHaveCount(0);
	await expect(page.getByTestId('conversation-error')).toHaveCount(0);

	// A late click is impossible (buttons gone) — and even a forced second
	// respond on the settled id returns not-pending (BC-B): the page must NOT
	// treat it as a transport error. Drive the carrier directly (the card's
	// own click path is already withdrawn; this pins the receipt arm).
	const res = await page.evaluate(async ([sessionId, rpcId, approvalId]) => {
		const r = await fetch(`/api/dsh/session/${sessionId}/respond`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ rpcId, payload: { approvalId, outcome: 'rejected' } })
		});
		return { status: r.status, body: await r.json() };
	}, [STUB_SESSION_ID, rpc19, `appr-0001-${rpc19.split('-').at(-1)}`] as const);
	expect(res.status).toBe(200); // refused ≠ error (BC-B)
	expect(res.body).toMatchObject({ ok: true, accepted: false, reason: 'not-pending' });
});

test('20 · reconnect replay — mux re-open re-delivers the same rpcId, card stays answerable', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	const rpc20 = stubAnswerer!.requestApproval();
	const card = page.getByTestId('approval-card');
	await expect(card).toBeVisible({ timeout: 6_000 });

	// Kill the mux downlink: the page must survive (connection layer owns it).
	stubRuntime!.forceMuxDrop();
	await page.waitForTimeout(500);

	// The stub still holds the request pending → re-open REPLAYS it with the
	// same rpcId (refresh-recovery baseline). The registry is idempotent by
	// rpcId: still exactly ONE card, still answerable (BC-C).
	await expect(card).toHaveCount(1);
	await expect(card).toHaveAttribute('data-phase', 'waiting');
	await expect(page.getByTestId('answerer-pending').locator('[data-testid="approval-card"]')).toHaveCount(1);

	// And the answer lands — one click still finishes the turn.
	await card.getByTestId('approval-allow').click();
	await expect
		.poll(async () => (await stubState()).respondCalls.at(-1)?.payload, { timeout: 5_000 })
		.toMatchObject({ approvalId: `appr-0001-${rpc20.split('-').at(-1)}`, outcome: 'allowed-once' });
	// Own answer settles → card unmounts (2026-08-24 contract, see 16).
	await expect(card).toHaveCount(0, { timeout: 6_000 });
});

test('21 · context-injection family — tailored producers + the open fall-through collapse to attributed chips', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// Push the FIVE tailored producers plus one open-family member
	// (plugin-kind 'tool-jobs') over the wire — kind/plugin/form markers
	// exactly as the live pins captured them. Seq rides the stub waterline
	// (spec 11 pushed a runtime-context chip earlier in the file's shared
	// stub — counting must stay deterministic against lastSeq).
	const injBase = (await stubState()).lastSeq + 1;
	const mk = (n: number, producer: keyof typeof STUB_INJECTIONS): StubLedgerEvent => ({
		type: 'user/message',
		seq: injBase + n,
		time: Date.now(),
		data: {
			id: `stub-inj-${n}`,
			source: STUB_INJECTIONS[producer].source as Record<string, unknown>,
			content: [{ type: 'text', text: STUB_INJECTIONS[producer].text }]
		}
	});
	await stubRuntime!.pushEvent(mk(1, 'instructions'));
	await stubRuntime!.pushEvent(mk(2, 'runtime-context'));
	await stubRuntime!.pushEvent(mk(3, 'skill-catalog'));
	await stubRuntime!.pushEvent(mk(4, 'skill-invocation'));
	await stubRuntime!.pushEvent(mk(5, 'compaction'));
	await stubRuntime!.pushEvent(mk(6, 'tool-jobs'));

	const transcript = page.getByTestId('transcript');
	// The shared stub ledger carries earlier specs' pushed runtime-context event
	// (spec 11) into THIS cold load — the family assertion is per-producer, not
	// a brittle total: every producer attributed, everything chip-shaped.
	await expect
		.poll(async () => await transcript.locator('[data-testid="context-injection-chip"]').count(), { timeout: 6_000 })
		.toBeGreaterThanOrEqual(6);

	// Each is attributed to its producer with its digest (collapsed one-liners).
	// (.first(): the shared stub ledger may carry spec 11's runtime-context chip
	// into this cold load — the family contract is the producer attribution.)
	const instr = transcript.locator('[data-testid="context-injection-chip"][data-producer="instructions"]').first();
	const rc = transcript.locator('[data-testid="context-injection-chip"][data-producer="runtime-context"]').first();
	const skills = transcript.locator('[data-testid="context-injection-chip"][data-producer="skill-catalog"]').first();
	const skillBody = transcript.locator('[data-testid="context-injection-chip"][data-producer="skill-invocation"]').first();
	const compact = transcript.locator('[data-testid="context-injection-chip"][data-producer="compaction"]').first();
	// The open-family member is attributed 'plugin' and TITLED by the wire
	// plugin string — DSH's own client labels these rows the same way.
	const jobs = transcript.locator('[data-testid="context-injection-chip"][data-producer="plugin"]').first();
	await expect(instr).toBeVisible();
	await expect(rc).toBeVisible();
	await expect(skills).toBeVisible();
	await expect(skillBody).toBeVisible();
	await expect(compact).toBeVisible();
	await expect(jobs).toBeVisible();
	await expect(instr).toContainText('instructions');
	await expect(rc).toContainText('context');
	await expect(skills).toContainText('skills');
	// The loaded skill's chip is NAMED after the invocation (wire source.name).
	await expect(skillBody).toContainText('skill:dsh-doc');
	// The /compact checkpoint chip is named after its command.
	await expect(compact).toContainText('compact');
	// The generic plugin chip is named after the injecting plugin.
	await expect(jobs).toContainText('tool-jobs');

	// Placement (The Turn Kept Whole, D1): bracket a FRESH notice with
	// assistant messages on a FRESH waterline (the family pushes above
	// already advanced it — seqs here must stay monotonic) — one wire
	// turn, ONE bubble, the notice a row member inside it, never a
	// bubble that splits the turn.
	const placeBase = (await stubState()).lastSeq + 1;
	await stubRuntime!.pushEvent({
		type: 'assistant/message',
		seq: placeBase,
		time: Date.now(),
		data: { turn: 21, step: 1, message: { content: [{ type: 'text', text: 'd1 · the turn stays whole' }] } }
	});
	await stubRuntime!.pushEvent({
		type: 'user/message',
		seq: placeBase + 1,
		time: Date.now(),
		data: {
			id: 'stub-inj-d1',
			source: STUB_INJECTIONS['tool-jobs'].source as Record<string, unknown>,
			content: [{ type: 'text', text: STUB_INJECTIONS['tool-jobs'].text }]
		}
	});
	await stubRuntime!.pushEvent({
		type: 'assistant/message',
		seq: placeBase + 2,
		time: Date.now(),
		data: { turn: 21, step: 2, message: { content: [{ type: 'text', text: 'd1 · the turn stays whole — after the notice' }] } }
	});
	const wholeTurn = transcript.locator('[data-testid="assistant-turn"]', { hasText: 'the turn stays whole' });
	await expect(wholeTurn).toHaveCount(1, { timeout: 6_000 });
	await expect(
		wholeTurn.locator('[data-testid="context-injection-chip"][data-producer="plugin"]').first()
	).toContainText('tool-jobs');

	// None of them renders as a giant message bubble (G4 collapsed).
	await expect(
		transcript.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: 'system-reminder' })
	).toHaveCount(0);
	await expect(
		transcript.locator('[data-testid="message-bubble"][data-role="user"]', { hasText: 'skill_content' })
	).toHaveCount(0);

	// Expand one: the FULL verbatim wire text rides the POPUP after the row
	// (honest, no summarizing; chip stays in place — no layout push).
	await instr.getByTestId('context-injection-toggle').click();
	await expect(transcript.getByTestId('context-injection-body')).toContainText('<system-reminder>');
});

test('22 · one chip per call — plain bash name, no summary on the row, no dup result chip, args once', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// Push a bash tool pair whose view title is distinctive (render intent on
	// the wire — the summary path DSH's own UI uses).
	await stubRuntime!.pushEvent({
		type: 'tool/call',
		seq: 960,
		time: Date.now(),
		data: { turn: 11, step: 1, callId: 'call_bash_e2e', name: 'bash', arguments: '{"cmd":"echo parity-check"}' },
		view: { for: 'call', view: { title: 'Echo parity-check', kind: 'terminal', rawInput: 'echo parity-check' } }
	} as StubLedgerEvent);
	await stubRuntime!.pushEvent({
		type: 'tool/result',
		seq: 961,
		time: Date.now() + 120,
		data: {
			turn: 11,
			step: 1,
			message: {
				source: { kind: 'tool', callId: 'call_bash_e2e' },
				content: [{ type: 'tool-result', toolCallId: 'call_bash_e2e', content: [{ type: 'text', text: 'parity-check' }], isError: false }],
				role: 'user',
				id: 'stub-result-bash'
			}
		},
		sourceEventSeqs: [960],
		surfaceOp: 'append'
	} as StubLedgerEvent & { sourceEventSeqs?: unknown; surfaceOp?: unknown });

	const transcript = page.getByTestId('transcript');
	// The paired row: ONE chip, plain wire name `bash` (chip simplification).
	const bashChip = transcript.locator('[data-testid="tool-chip"][data-kind="call"]', { hasText: 'bash' });
	await expect(bashChip).toHaveAttribute('data-status', 'pass', { timeout: 6_000 });
	// The view-title summary no longer rides the header (chip simplification).
	await expect(bashChip).not.toContainText('Echo parity-check');
	// NO standalone result chip for the paired callId (G5 double chip fixed).
	await expect(transcript.locator('[data-testid="tool-chip"][data-kind="result"]')).toHaveCount(0);

	// Expand once: the POPUP carries the args EXACTLY ONCE (no summary pane
	// repeating them) and the result rides the same popup.
	await bashChip.getByTestId('tool-chip-toggle').click();
	await expect(transcript.getByTestId('tool-chip-args')).toContainText('echo parity-check');
	await expect(transcript.locator('[data-testid="tool-chip-args"], [data-testid="tool-chip-detail"]')).toHaveCount(1);
	await expect(transcript.getByTestId('tool-chip-result')).toContainText('parity-check');
});

test('23 · reasoning section is labeled think (simple chip)', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible();

	// The stub's inspector scenario streams reasoning then finalizes it — the
	// collapsed section header says plain `think` (chip simplification).
	stubRuntime!.runInspectorScenario();
	const transcript = page.getByTestId('transcript');
	const section = transcript.getByTestId('reasoning-section');
	await expect(section.first()).toBeVisible({ timeout: 6_000 });
	await expect(section.first().getByTestId('reasoning-toggle')).toHaveText(/think/);
	await expect(transcript.getByTestId('reasoning-toggle')).toHaveCount(
		await transcript.getByTestId('reasoning-section').count()
	);
});

/**
 * Measure GET events-poll request gaps via network observation (the
 * orchestrator binds global fetch at creation, so window.fetch wrapping is
 * not observable — network events are).
 */
async function measureGaps(
	page: import('@playwright/test').Page,
	want: number
): Promise<number[]> {
	const stamps: number[] = [];
	const onReq = (req: import('@playwright/test').Request) => {
		if (req.method() === 'GET' && req.url().includes('/api/dsh/session/')) stamps.push(Date.now());
	};
	page.on('request', onReq);
	const start = Date.now();
	while (stamps.length < want + 1 && Date.now() - start < 12_000) {
		await page.waitForTimeout(100);
	}
	page.off('request', onReq);
	const gaps: number[] = [];
	for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
	return gaps;
}

function avg(xs: number[]): number {
	return xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
}

test('24 · tool peek — prefix button lists every chip before the row', async ({ page }) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();

	// Prefix button exists before the chips with the row's chip count.
	const peek = transcript.getByTestId('tool-peek-button');
	await expect(peek.first()).toBeVisible({ timeout: 6_000 });
	await expect(peek.first()).toContainText('1');

	// Click → peek list popup: status dot color class + tool name + args preview.
	await peek.first().click();
	const list = transcript.getByTestId('tool-peek-list');
	await expect(list).toBeVisible();
	const item = list.locator('li').first();
	await expect(item.locator('span.font-mono')).toHaveText('Search'); // toolTitle('grep')
	await expect(item).toContainText('/tmp/dsh'); // args preview — path ladder (OCI parity)
	await expect(item.locator('span.rounded-full')).toHaveClass(/bg-emerald-500/); // pass dot

	// Peek closes when a chip is opened — mutual exclusion (OCI contract).
	await transcript.locator('[data-testid="tool-chip-toggle"]').first().click();
	await expect(list).not.toBeVisible();
	await expect(transcript.getByTestId('chip-popup')).toBeVisible();
});

test('25 · plan review — the claimed intent renders the review; approve answers exactly the native decision', async ({ page }) => {
	// Setup (a means, not the subject — the New-chat journey is spec 14's):
	// run the review on a FRESH session. The long-lived stub session's event
	// buffer goes stale across the file (mux rebuilds seed its coverage floor
	// past the ledger tail), and a page on it gap-resyncs forever — the
	// resync path never applies pending state, so the card could not render
	// there (pre-existing finding, see the wave's completion notes). A fresh
	// session's buffer is new, so the page's delta polls run the normal path.
	await page.goto('/');
	await expect(page.getByTestId('sessions-list')).toBeVisible();
	{
		const t = page.getByTestId('filter-toggle');
		if ((await t.getAttribute('aria-expanded')) === 'false') await t.click(); // ensure open (expanded is the load default)
	}
	await page.getByTestId('filter-preset-research').click();
	await page.getByTestId('filter-workspace-deepseek-harness').click();
	await page.getByTestId('new-chat-button').click();
	await page.waitForURL(/\/?sessionKey=e2e-created-/, { timeout: 5_000 });
	await expect(page.getByTestId('transcript')).toBeVisible();
	const sessionId = (await stubState()).createdSessions.at(-1) as string;

	// The stub mints the exit_plan_mode-shaped waterfall (fixture pinned to
	// DSH plan-mode/src/index.ts — the Drifted Stand-in rule), addressed to
	// this session.
	stubAnswerer!.requestPlanReview({ sessionId });
	const card = page.getByTestId('question-card');
	await expect(card).toBeVisible({ timeout: 6_000 });
	await expect(card).toHaveAttribute('data-phase', 'waiting');

	// Review shape: the plan reads as a document, the two decision buttons
	// carry the asker's own labels, and NONE of the generic affordances exist.
	const body = card.getByTestId('plan-review-body');
	await expect(body).toBeVisible();
	await expect(body).toContainText('Approve this plan and leave plan mode?');
	await expect(body).toContainText('The Plan'); // the #-heading renders as markdown
	await expect(body).toContainText('Render the review');
	await expect(card.getByTestId('plan-review-approve')).toHaveText('Approve');
	await expect(card.getByTestId('plan-review-decline')).toHaveText('Keep planning');
	await expect(card.getByTestId('question-custom')).toHaveCount(0);
	await expect(card.locator('[data-testid="question-option"]')).toHaveCount(0);

	await card.getByTestId('plan-review-approve').click();

	// The wire answer is EXACTLY the native approve — one question, one
	// selected label, no `custom` key anywhere in the payload.
	await expect
		.poll(async () => (await stubState()).respondCalls.at(-1)?.payload, { timeout: 5_000 })
		.toEqual({
			sessionId,
			answers: [{ id: 'plan-review', selected: ['Approve'] }]
		});

	// Settles and unmounts; the transcript chip keeps the permanent record.
	await expect(card).toHaveCount(0, { timeout: 6_000 });
});

test('26 · plan review fallback — a three-option intent frame stays a generic question and still answers', async ({ page }) => {
	// Same setup as 25 (fresh session → delta polls apply pending state).
	await page.goto('/');
	await expect(page.getByTestId('sessions-list')).toBeVisible();
	{
		const t = page.getByTestId('filter-toggle');
		if ((await t.getAttribute('aria-expanded')) === 'false') await t.click(); // ensure open (expanded is the load default)
	}
	await page.getByTestId('filter-preset-research').click();
	await page.getByTestId('filter-workspace-deepseek-harness').click();
	await page.getByTestId('new-chat-button').click();
	await page.waitForURL(/\/?sessionKey=e2e-created-/, { timeout: 5_000 });
	await expect(page.getByTestId('transcript')).toBeVisible();
	const sessionId = (await stubState()).createdSessions.at(-1) as string;

	// The host's ask() would refuse to mint this (BAD_INTENT: an intent on a
	// frame its rules cannot claim) — DSI sits downstream of the wire and must
	// stay answerable regardless (PRD §1.3): the six arms refuse the claim at
	// the ≤2-options arm, and the generic flow keeps every answer reachable.
	stubAnswerer!.requestQuestions({
		sessionId,
		questions: [
			{
				id: 'plan-review',
				header: 'Plan review',
				question: 'Approve this plan and leave plan mode?',
				detail: '# The Plan\n\n1. Read the wire\n2. Render the review',
				options: [
					{ label: 'Approve', description: 'Leave plan mode; the plan is carried out from the next step.' },
					{ label: 'Keep planning', description: 'Stay in plan mode; feedback goes back to the model.' },
					{ label: 'Ask again later', description: 'Neither — park the decision.' }
				],
				intent: { kind: 'plan-review', approve: 'Approve' }
			}
		]
	});
	const card = page.getByTestId('question-card');
	await expect(card).toBeVisible({ timeout: 6_000 });

	// Generic card: tick boxes + custom present; no review body, no decision buttons.
	await expect(card.getByTestId('plan-review-body')).toHaveCount(0);
	await expect(card.getByTestId('plan-review-approve')).toHaveCount(0);
	await expect(card.locator('[data-testid="question-option"]')).toHaveCount(3);
	await expect(card.getByTestId('question-custom')).toBeVisible();

	// A generic answer still validates and lands on the wire.
	await card.locator('[data-testid="question-option"][data-label="Keep planning"]').click();
	await expect(card.getByTestId('question-submit')).toBeEnabled();
	await card.getByTestId('question-submit').click();
	await expect
		.poll(async () => (await stubState()).respondCalls.at(-1)?.payload, { timeout: 5_000 })
		.toEqual({
			sessionId,
			answers: [{ id: 'plan-review', selected: ['Keep planning'] }]
		});
	await expect(card).toHaveCount(0, { timeout: 6_000 });
});

test('27 · system prompt renders as a collapsed chip ABOVE the first prompt (2026-09-01)', async ({
	page
}) => {
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	const chip = transcript.locator('[data-testid="system-prompt-chip"]');
	await expect(chip).toBeVisible();

	// DSH anchor parity: the opening row sits ABOVE the first user bubble —
	// the transcript's FIRST group is the system-prompt group, and it rides
	// the prompt side (right-aligned, context tone) because the system
	// prompt IS sent to the LLM.
	const firstGroup = transcript.locator('[data-group-key]').first();
	await expect(firstGroup.locator('[data-testid="system-prompt-chip"]')).toBeVisible();
	// It rides ONE prompt-side bubble (context tone — the system prompt is
	// sent to the LLM) and no user text bubble sits in this group.
	await expect(firstGroup.locator('[data-testid="message-bubble"]')).toHaveCount(1);
	await expect(
		firstGroup.locator('[data-testid="message-bubble"][data-role="user"]', {
			hasText: STUB_USER_HELLO
		})
	).toHaveCount(0);

	// Collapsed by default; the toggle reveals the model-facing text.
	await expect(transcript.locator('[data-testid="system-prompt-body"]')).toHaveCount(0);
	await chip.getByTestId('system-prompt-toggle').click();
	const body = transcript.locator('[data-testid="system-prompt-body"]');
	await expect(body).toBeVisible();
	await expect(body).toContainText('stub host prompt');
});

// ── 28 · Dispatch-rendered Code Card (2026-09-05 ADR D1–D6) ──────────────────
// A run_code program with three sub-dispatches (two .md reads + one bash, plus
// one unsettled start) folds onto the chip: each part renders with the
// renderer its tool name and file extension select; the outer output
// collapses into the D6 footer. Events shaped from session 7ec16d54.
test('28 · run_code dispatches render per-file (markdown prose, terminal) with a collapsed output footer', async ({ page }) => {
	const CALL = 'call_e2e_run_code_0001';
	const base = (await stubState()).lastSeq + 1;
	const now = Date.now();
	const push = (n: number, type: string, data: Record<string, unknown>) =>
		stubRuntime!.pushEvent({ type, seq: base + n, time: now + n, data });

	await push(0, 'tool/call', {
		callId: CALL,
		name: 'run_code',
		arguments: JSON.stringify({
			description: 'Read AIP and OCI READMEs',
			code: 'const r1 = await tools.read({ file_path: "/x/AIP.md" });\nconst r2 = await tools.read({ file_path: "/x/OCI.md" });\nconst out = await tools.bash({ command: "ls /x" });'
		})
	});
	await push(1, 'tool/ptc-dispatch-start', {
		rootCallId: CALL, parentCallId: CALL, subCallId: `${CALL}:ptc:1`, name: 'read',
		arguments: { file_path: '/x/AIP.md', limit: 80 }
	});
	await push(2, 'tool/ptc-dispatch', {
		rootCallId: CALL, parentCallId: CALL, subCallId: `${CALL}:ptc:1`, name: 'read',
		arguments: { file_path: '/x/AIP.md', limit: 80 }, isError: false,
		content: [{ type: 'text', text: '<path>/x/AIP.md</path>\n<type>file</type>\n<content>\n1: # AIP README\n2: \n3: **Transparent proxy.**' }]
	});
	await push(3, 'tool/ptc-dispatch', {
		rootCallId: CALL, parentCallId: CALL, subCallId: `${CALL}:ptc:2`, name: 'read',
		arguments: { file_path: '/x/OCI.md', limit: 80 }, isError: false,
		content: [{ type: 'text', text: '<path>/x/OCI.md</path>\n<type>file</type>\n<content>\n1: # OCI README\n2: \n3: > What your agents actually did.' }]
	});
	await push(4, 'tool/ptc-dispatch', {
		rootCallId: CALL, parentCallId: CALL, subCallId: `${CALL}:ptc:3`, name: 'bash',
		arguments: { command: 'ls /x', description: 'List folder' }, isError: false,
		content: [{ type: 'text', text: 'AIP.md\nOCI.md' }]
	});
	await push(5, 'tool/ptc-dispatch-start', {
		rootCallId: CALL, parentCallId: CALL, subCallId: `${CALL}:ptc:4`, name: 'read',
		arguments: { file_path: '/x/PREREQ.md' }
	});
	await push(6, 'tool/result', {
		message: {
			source: { kind: 'tool', callId: CALL },
			content: [{ type: 'tool-result', content: [{ type: 'text', text: '--- AIP README ---\n# AIP README' }] }]
		}
	});

	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript).toBeVisible();

	// The run_code chip opens the CodeCard.
	const rcChip = transcript.locator('[data-testid="tool-chip"][data-kind="call"]', { hasText: 'run_code' }).first();
	await rcChip.getByTestId('tool-chip-toggle').click();
	await expect(transcript.getByTestId('code-card')).toBeVisible();

	// .md reads render as MARKDOWN PROSE (heading element, no N: gutter).
	const fileSections = transcript.locator('[data-testid="code-dispatch-file"]');
	await expect(fileSections).toHaveCount(2);
	await expect(fileSections.first()).toContainText('AIP README');
	await expect(fileSections.first().locator('h1')).toHaveCount(1);
	await expect(fileSections.first()).not.toContainText('1: #');

	// bash renders as the terminal block; the unsettled start keeps its placeholder.
	const terminal = transcript.getByTestId('code-dispatch-terminal');
	await expect(terminal).toBeVisible();
	await expect(terminal).toContainText('AIP.md');
	const pending = transcript.getByTestId('code-dispatch-pending');
	await expect(pending).toHaveCount(1);
	await expect(pending).toContainText('PREREQ.md');

	// D6: the model's own output is collapsed; expanding keeps it honest.
	await expect(transcript.getByTestId('code-result-pane')).toHaveCount(0);
	await transcript.getByTestId('code-result-footer-toggle').click();
	await expect(transcript.getByTestId('code-result-pane')).toContainText('--- AIP README ---');
});

// ── The Fold Gate (ADR-0010, 2026-09-09, task 4.1) ─────────────────────────
// Four cases over one two-turn fixture (turn 1: reasoning + narration + tool
// call + answer; turn 2 after a fresh prompt: tool-only): (a) default flags
// keep the flat transcript; (b) collapsable folds answered turns behind a
// disclosure row with reasoning pills outside (D6); (c) progressiveFold lets
// an in-flight turn fold mid-stream; (d) reload closes every fold (D4).
// Config rides the per-run DSI_CONFIG_PATH temp home (BC-10) — the operator's
// real settings.yaml is never touched, and the file is removed at the end so
// later suites in the same preview server see defaults again.

import { writeFileSync, rmSync } from 'node:fs';

const FOLD_CONFIG_PATH = process.env.DSI_CONFIG_PATH!;
/** Write conversation.* flags into the per-run settings home. */
async function setFoldFlags(flags: { collapsable?: boolean; progressiveFold?: boolean }) {
	const lines = ['conversation:'];
	if (flags.collapsable !== undefined) lines.push(`  collapsable: ${flags.collapsable}`);
	if (flags.progressiveFold !== undefined) lines.push(`  progressiveFold: ${flags.progressiveFold}`);
	writeFileSync(FOLD_CONFIG_PATH, lines.join('\n') + '\n', 'utf8');
}

/** Push the two-turn fold fixture on a fresh waterline; returns seq base. */
async function pushFoldFixture(): Promise<number> {
	const base = (await stubState()).lastSeq + 1;
	const t = Date.now();
	const mk = (n: number, type: string, data: Record<string, unknown>): StubLedgerEvent => ({
		type, seq: base + n, time: t + n, data
	});
	await stubRuntime!.pushEvent(mk(0, 'user/message', {
		id: 'e2e-fold-prompt', content: [{ type: 'text', text: 'fold fixture prompt' }]
	}));
	// Turn 1: reasoning + narration message, one tool pair, final answer.
	await stubRuntime!.pushEvent(mk(1, 'assistant/message', {
		turn: 31, step: 1,
		message: { content: [
			{ type: 'reasoning', text: 'fold-e2e thinking' },
			{ type: 'text', text: 'fold-e2e narration between calls' }
		] }
	}));
	await stubRuntime!.pushEvent(mk(2, 'tool/call', {
		turn: 31, step: 2, callId: 'call_fold_one', name: 'grep', arguments: '{"q":"fold"}'
	}));
	await stubRuntime!.pushEvent(mk(3, 'tool/result', {
		turn: 31, step: 2,
		message: {
			source: { kind: 'tool', callId: 'call_fold_one' },
			content: [{ type: 'tool-result', toolCallId: 'call_fold_one', content: [{ type: 'text', text: 'fold-one ok' }], isError: false }],
			role: 'user', id: 'stub-result-fold-one'
		}
	}));
	// ADR-0022 fixture member: an agent-instructions injection spliced into
	// turn 31 — the live-ledger shape (seq 63 of session f48767d8).
	await stubRuntime!.pushEvent(mk(4, 'user/message', {
		id: 'e2e-fold-inject',
		content: [{ type: 'text', text: '<system-reminder>\nAdditional instructions from: deepseek-insight/AGENTS.md\n\nThese instructions apply to work under `deepseek-insight`.\n</system-reminder>' }],
		source: { kind: 'agent-instructions', form: 'instructions', baseline: false, changes: [{ action: 'set', scope: 'deepseek-insight\u0000AGENTS.md', path: 'deepseek-insight/AGENTS.md', digest: 'e2e-d7' }] }
	}));
	await stubRuntime!.pushEvent(mk(5, 'assistant/message', {
		turn: 31, step: 3,
		message: { content: [{ type: 'text', text: 'fold-e2e final answer' }] }
	}));
	// Turn 2 (fresh prompt): tool-only — nothing to fold.
	await stubRuntime!.pushEvent(mk(6, 'user/message', {
		id: 'e2e-fold-prompt-2', content: [{ type: 'text', text: 'fold fixture prompt two' }]
	}));
	await stubRuntime!.pushEvent(mk(7, 'tool/call', {
		turn: 32, step: 1, callId: 'call_fold_two', name: 'grep', arguments: '{"q":"fold2"}'
	}));
	await stubRuntime!.pushEvent(mk(8, 'tool/result', {
		turn: 32, step: 1,
		message: {
			source: { kind: 'tool', callId: 'call_fold_two' },
			content: [{ type: 'tool-result', toolCallId: 'call_fold_two', content: [{ type: 'text', text: 'fold-two ok' }], isError: false }],
			role: 'user', id: 'stub-result-fold-two'
		}
	}));
	return base;
}

test('29 · fold (a) — default flags: the fixture renders flat, no disclosure rows', async ({ page }) => {
	rmSync(FOLD_CONFIG_PATH, { force: true });
	await pushFoldFixture();
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	await expect(transcript.locator('[data-testid="assistant-turn"]', { hasText: 'fold-e2e final answer' }))
		.toBeVisible({ timeout: 6_000 });
	// Flat: no disclosure row anywhere, both tool chips open, reasoning open.
	await expect(transcript.locator('[data-testid="turn-process-disclosure"]')).toHaveCount(0);
	await expect(transcript.locator('[data-testid="tool-chip"][data-kind="call"]', { hasText: 'grep' })
		.nth(1)).toBeVisible();
	await expect(transcript.getByTestId('reasoning-section').first()).toBeVisible();
	await expect(transcript.getByTestId('reasoning-body')).toHaveCount(0);
});

test('30 · fold (b) — collapsable: answered turn folds, tool-only stays flat, reasoning escapes (D6)', async ({ page }) => {
	await setFoldFlags({ collapsable: true });
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	const answerTurn = transcript.locator('[data-testid="assistant-turn"]', { hasText: 'fold-e2e final answer' });
	await expect(answerTurn).toBeVisible({ timeout: 6_000 });

	const row = answerTurn.getByTestId('turn-process-disclosure');
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute('aria-expanded', 'false');
	// DSH-parity label over the fixture counts: 1 tool call · 2 messages.
	await expect(row.getByTestId('turn-process-label')).toHaveText('1 tool call · 2 messages');
	// D6: the reasoning pill renders OUTSIDE the closed row — BELOW the
	// disclosure, whose position never swaps between states.
	const reasoning = answerTurn.getByTestId('reasoning-section').first();
	await expect(reasoning).toBeVisible();
	expect(await answerTurn.evaluate((el) => {
		const r = el.querySelector('[data-testid="reasoning-section"]');
		const d = el.querySelector('[data-testid="turn-process-disclosure"]');
		return r && d ? !!(r.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_PRECEDING) : false;
	})).toBe(true);
	// D7 (ADR-0022): the AGENTS.md injection chip is visible WITHOUT
	// expanding the fold — what the model was told never hides.
	const injChip = answerTurn.getByTestId('context-injection-chip');
	await expect(injChip).toBeVisible();
	await expect(injChip).toHaveAttribute('data-producer', 'instructions');
	// The label never counts injections (the ambient half of D3 stands).
	await expect(row.getByTestId('turn-process-label')).toHaveText('1 tool call · 2 messages');
	// Closed: the folded tool chip is hidden; the tool-only turn's chip is
	// not — the transcript's LAST turn is the tool-only fixture turn, and
	// it renders flat (no disclosure row of its own).
	await expect(answerTurn.locator('[data-testid="tool-chip"][data-kind="call"]', { hasText: 'grep' })).toHaveCount(0);
	const toolOnlyTurn = transcript.locator('[data-testid="assistant-turn"]').last();
	await expect(toolOnlyTurn.locator('[data-testid="tool-chip"][data-kind="call"]')).toBeVisible();
	await expect(toolOnlyTurn.getByTestId('turn-process-disclosure')).toHaveCount(0);
	// Answer stays open below the row; the NARRATION is folded with the
	// chips — hidden while closed (it is one of the counted messages).
	await expect(answerTurn).toContainText('fold-e2e final answer');
	await expect(answerTurn).not.toContainText('fold-e2e narration between calls');

	// Click opens: the folded runs render IN WIRE ORDER — the counted
	// narration message appears alongside the tool calls it narrates.
	await row.click();
	await expect(row).toHaveAttribute('aria-expanded', 'true');
	await expect(answerTurn.locator('[data-testid="tool-chip"][data-kind="call"]', { hasText: 'grep' })).toBeVisible();
	await expect(answerTurn).toContainText('fold-e2e narration between calls');
	// The reasoning pill moved INTO the expanded body at its wire position:
	// still exactly ONE section — the escaped strip is gone, no duplicate.
	await expect(answerTurn.getByTestId('reasoning-section')).toHaveCount(1);
	// D7 open state: the chip replays at its wire position — exactly ONE
	// (the closed-only escape strip emptied, never doubled).
	await expect(answerTurn.getByTestId('context-injection-chip')).toHaveCount(1);
});

test('31 · fold (c) — progressiveFold: an in-flight turn folds mid-stream', async ({ page }) => {
	await setFoldFlags({ collapsable: true, progressiveFold: true });
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	await expect(page.getByTestId('transcript')).toBeVisible({ timeout: 6_000 });
	// A turn whose tool call is still PENDING (no result) already folds:
	// the call chips run lands BEFORE the narration text, so the fold
	// boundary (everything before the last text run) holds it closed while
	// the turn is in flight — the run-shaped boundary ADR-0010 D3 accepts.
	const base = (await stubState()).lastSeq + 1;
	const t = Date.now();
	await stubRuntime!.pushEvent({
		type: 'user/message', seq: base, time: t,
		data: { id: 'e2e-fold-prompt-3', content: [{ type: 'text', text: 'fold live prompt' }] }
	});
	await stubRuntime!.pushEvent({
		type: 'tool/call', seq: base + 1, time: t + 1,
		data: { turn: 33, step: 1, callId: 'call_fold_live', name: 'grep', arguments: '{"q":"live"}' }
	});
	await stubRuntime!.pushEvent({
		type: 'assistant/message', seq: base + 2, time: t + 2,
		data: { turn: 33, step: 2, message: { content: [{ type: 'text', text: 'fold-e2e live narration' }] } }
	});
	const transcript = page.getByTestId('transcript');
	const liveTurn = transcript.locator('[data-testid="assistant-turn"]', { hasText: 'fold-e2e live narration' });
	await expect(liveTurn).toBeVisible({ timeout: 6_000 });
	const row = liveTurn.getByTestId('turn-process-disclosure');
	await expect(row).toBeVisible();
	await expect(row).toHaveAttribute('aria-expanded', 'false');
	await expect(liveTurn.locator('[data-testid="tool-chip"][data-kind="call"]', { hasText: 'grep' })).toHaveCount(0);
});

test('32 · fold (d) — reload closes every fold (open state is session-only, D4)', async ({ page }) => {
	// (b) left turn 31 open in ITS page; a fresh load starts all-closed.
	await page.goto(`/?sessionKey=${STUB_SESSION_ID}`);
	const transcript = page.getByTestId('transcript');
	const answerTurn = transcript.locator('[data-testid="assistant-turn"]', { hasText: 'fold-e2e final answer' });
	await expect(answerTurn.getByTestId('turn-process-disclosure')).toHaveAttribute('aria-expanded', 'false', { timeout: 6_000 });
	// Restore defaults for any suite that shares this preview server.
	rmSync(FOLD_CONFIG_PATH, { force: true });
});
