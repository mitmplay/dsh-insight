/**
 * page-coverage-wp3 — the dispatchChordVerb / onChordKeyDown branch arms
 * istanbul flagged (WP3, line numbers from the coverage report):
 *  - L506  binary-expr: body.agentPreset ?? anchor.agentPreset (the 'n'
 *          sibling-spawn fallback when the POST returns no preset).
 *  - L517  switch arm: case 'term-new-tab' (Alt+T, t).
 *  - L518  switch arm: case 'term-split-down' (Alt+T, s).
 *  - L528  if: plan.kind === 'apply' — desk live with ≥1 assigned tab.
 *  - L529  if: plan.kind === 'add' — closed desk, term-new-tab.
 *  - L530  if: plan.kind === 'add-then-split' — closed desk, split-down.
 *  - L534  if: the settle interval sees deskSessionCount() >= 1.
 *  - L537  if: the settle interval's 10s give-up arm.
 *  - L544  switch arm: case 'term-clear-tab' (Alt+T, c).
 *  - L552  cond-expr: the 't' toggle (remove | add both arms).
 *  - L583  if: laneWrites.width !== undefined (sidebar width preset).
 * Same mounting conventions as root-page-branches-coverage.test.ts and
 * page-branch-mop3.test.ts (reactiveTestPage + settle, stubbed fetch,
 * stubbed EventSource, real window keydowns through the capture listener).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { floorSeam } from '$lib/services/panels/floor-registry.svelte';
import * as floorApi from '$lib/services/panels/floor-registry.svelte';
import { pagePrefs } from '$lib/services/workspace/page-prefs.svelte';
import {
	loadAppConfig,
	resetAppConfigForTests
} from '$lib/services/config/app-config.svelte';

class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	readyState = 1;
	handlers = new Map<string, Set<(ev: MessageEvent) => void>>();
	onerror: ((ev: unknown) => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
		if (!this.handlers.has(type)) this.handlers.set(type, new Set());
		this.handlers.get(type)!.add(cb);
	}
	close(): void {
		this.closed = true;
	}
}

const SESSION_ROW = {
	sessionId: 's-floor',
	title: 'Floor',
	agentPreset: null,
	running: false,
	blank: false,
	updatedAt: 0,
	workspace: '/ws/x',
	turns: null
};

/** Tunable per test. */
let newSessionBody: Record<string, unknown> = { ok: true, sessionId: 's-new', agentPreset: 'main' };
let newSessionStatus = 200;
let terminalPostStatus = 200;
/** When true the POST /api/terminal mint NEVER resolves — the desk's
 *  self-open row can never take a session (the give-up-arm fixture). */
let hangTerminalMint = false;
const dbg: string[] = [];
let configBody: Record<string, unknown> = {};

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? 'GET').toUpperCase();
			let body: unknown;
			let status = 200;
			if (url.includes('/api/terminal')) dbg.push(method + ' ' + url);
			if (url.includes('/api/terminal') && method === 'POST') {
				if (hangTerminalMint) return new Promise<Response>(() => undefined); // dangles forever
				// the desk's mint path: a fresh session lease (or a refusal)
				if (terminalPostStatus !== 200) {
					status = terminalPostStatus;
					body = { error: 'MAX_SESSIONS' };
				} else {
					body = { sessionId: 't-' + (StubEventSource.instances.length + 1), token: 'tok', totalBytes: 0 };
				}
			} else if (url.includes('/api/terminal')) {
				body = { enabled: true, sessions: [] };
			} else if (url.includes('/api/dsh/sessions') && method === 'POST') {
				status = newSessionStatus;
				body = newSessionBody;
			} else if (url.includes('/permission') && method === 'POST') {
				body = { ok: true };
			} else if (url.includes('/permission')) {
				body = { ok: true, permission: { current: 'default' } };
			} else if (url.includes('/api/config')) {
				body = { ok: true, ...configBody };
			} else if (url.includes('/api/dsh/sessions')) {
				body = { ok: true, sessions: [SESSION_ROW], presets: [] };
			} else if (url.includes('/api/a2a')) {
				body = { ok: true, rows: [] };
			} else if (url.includes('/events')) {
				body = { ok: true, entries: [], lastSeq: -1, running: false };
			} else if (url.includes('/models')) {
				body = { ok: true, current: null };
			} else if (url.includes('/api/browser')) {
				body = { ok: true, sessions: [] };
			} else if (url.includes('/api/prompts')) {
				body = { ok: true, rows: [] };
			} else if (url.includes('/api/skills')) {
				body = { ok: true, skills: [], categories: [] };
			} else if (url.includes('/api/plugins')) {
				body = { ok: true, plugins: [], marketplace: [] };
			} else {
				body = { ok: true, entries: [], hasMore: false };
			}
			return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		})
	);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** Seeded mount: one conversation panel for ?sessionKey=s-floor. */
async function mountSeeded() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL('http://dsi/?sessionKey=s-floor');
	reactiveTestPage.data = { sessionId: 's-floor', entries: [], lastSeq: -1, running: false, workspace: '/ws/x' };
	const instance = mount(Page, { target });
	livePages.push(instance);
	await settle();
	return { target, instance };
}

/** One chord step: a real keydown through the page's capture listener. */
function pressKey(init: { key: string; code?: string; altKey?: boolean }): KeyboardEvent {
	const ev = new KeyboardEvent('keydown', {
		key: init.key,
		code: init.code ?? (init.key.length === 1 ? 'Key' + init.key.toUpperCase() : init.key),
		altKey: init.altKey ?? false,
		ctrlKey: false,
		metaKey: false,
		cancelable: true,
		bubbles: true
	});
	window.dispatchEvent(ev);
	return ev;
}

/** Arm Alt+S then fire the verb/digit key. */
function chord(key: string, code?: string): void {
	pressKey({ key: 's', code: 'KeyS', altKey: true });
	pressKey({ key, code: code ?? (key.length === 1 ? 'Key' + key.toUpperCase() : key) });
}

/** Arm Alt+T then fire the terminal verb key. */
function chordT(key: string): void {
	pressKey({ key: 't', code: 'KeyT', altKey: true });
	pressKey({ key, code: 'Key' + key.toUpperCase() });
}

/** Microtask-only drain: lets the desk's self-open row mint its session
 *  (fetch + mirror publish) WITHOUT advancing any timer — the settle
 *  ladder tests need the interval to stay pending until they choose. */
async function drainMint(): Promise<void> {
	for (let i = 0; i < 24; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** Wait until the desk's self-open row has minted its session (a POST
 *  /api/terminal mint landed), then drain the mirror publish. Real
 *  macrotask yields so every async hop of the mint ladder completes. */
async function waitDeskLive(): Promise<void> {
	const before = dbg.filter((d) => d.startsWith('POST')).length;
	for (let i = 0; i < 60 && dbg.filter((d) => d.startsWith('POST')).length === before; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 10));
	}
	await drainMint();
	await new Promise((r) => setTimeout(r, 10));
	flushSync();
}

/** Spy the page's terminal-desk action forward (L528/L536/L548 seam). */
function spyDeskAction(): string[] {
	const actions: string[] = [];
	const seam = floorSeam() as { applyTerminalDeskAction: (a: string) => void };
	const orig = seam.applyTerminalDeskAction.bind(seam);
	seam.applyTerminalDeskAction = (a: string) => {
		actions.push(a);
		orig(a as never);
	};
	return actions;
}

const livePages: unknown[] = [];

beforeEach(() => {
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
	localStorage.clear();
	newSessionBody = { ok: true, sessionId: 's-new', agentPreset: 'main' };
	newSessionStatus = 200;
	terminalPostStatus = 200;
	hangTerminalMint = false;
	configBody = {};
});

afterEach(() => {
	while (livePages.length > 0) unmount(livePages.pop() as never);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetSpineFeedForTests();
	resetPanelRegistryForTests();
	resetAppConfigForTests();
	pagePrefs.sidebarCollapsed = false;
	pagePrefs.sidebarWidth = 320;
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('+page.svelte WP3 — the t toggle and the Alt+T add plan', () => {
	it("L552 cond-expr both arms + L529 'add' plan: chord t adds then removes; Alt+T,t on a closed desk re-adds", async () => {
		const { target } = await mountSeeded();
		// first chord: no terminal open → the doAdd arm (552 false branch)
		chord('t');
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
		// second chord: the desk is open → the removePanel arm (552 true branch)
		chord('t');
		await settle();
		expect(target.querySelector('[data-testid="panel-terminal"]')).toBeNull();
		// Alt+T + t on a CLOSED desk → resolveTerminalChordPlan 'add' (L529;
		// L528's if stays false) — the virgin self-open row IS the new tab.
		chordT('t');
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
	});
});

describe('+page.svelte WP3 — the Alt+T apply plans (desk live with a tab)', () => {
	it("L517/L518 switch arms + L528 apply plan: Alt+T,t → new-tab; Alt+T,s → split-down", async () => {
		const { target } = await mountSeeded();
		// open the desk the ordinary way; its virgin self-open row mints a
		// session (stubbed POST /api/terminal), the mirror publishes, and
		// deskSessionCount() climbs to 1.
		chord('t');
		await waitDeskLive();
		const actions = spyDeskAction();
		// Alt+T + t with a live, populated desk → the 'apply' plan (L528),
		// routed through case 'term-new-tab' (L517)
		chordT('t');
		flushSync();
		expect(actions).toContain('new-tab');
		expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
		// Alt+T + s with a live, populated desk → case 'term-split-down' (L518)
		chordT('s');
		flushSync();
		expect(actions).toContain('split-down');
	});

	it("L544 switch arm: Alt+T,c forwards the clear-tab verb", async () => {
		const { target } = await mountSeeded();
		chord('t');
		await waitDeskLive();
		const actions = spyDeskAction();
		chordT('c');
		flushSync();
		expect(actions).toContain('clear-tab');
	});
});

describe('+page.svelte WP3 — the add-then-split settle ladder', () => {
	it("L530/L534: closed desk + Alt+T,s adds the desk and splits once the mirror publishes a session", async () => {
		vi.useFakeTimers(); // own the settle interval from creation
		try {
			const { target } = await mountSeeded();
			const actions = spyDeskAction();
			chordT('s'); // no desk → the 'add-then-split' plan (L530)
			flushSync();
			expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
			// let the self-open row mint its session (microtask-only — the
			// settle interval must stay pending until we advance it)
			await drainMint();
			await drainMint();
			vi.advanceTimersByTime(200); // one settle tick
			await Promise.resolve();
			// the desk settled (≥1 assigned tab) → split-down applies (L534)
			expect(actions).toContain('split-down');
		} finally {
			vi.useRealTimers();
		}
	});

	it("L537: a desk that never settles gives up silently after 10s", async () => {
		terminalPostStatus = 429; // every mint refuses → count stays 0
		const { target } = await mountSeeded();
		const actions = spyDeskAction();
		chordT('s'); // 'add-then-split' again, but the desk can never settle
		flushSync();
		expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
		vi.useFakeTimers();
		try {
			vi.advanceTimersByTime(10_500); // past the give-up deadline
			await Promise.resolve();
			expect(actions).not.toContain('split-down'); // L537's arm fired instead
			expect(target.querySelector('[data-testid="panel-terminal"]')).not.toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('+page.svelte WP3 — the sibling spawn fallback and the sidebar width lane', () => {
	it('L506: a preset-less POST body falls back to the anchor session agentPreset', async () => {
		newSessionBody = { ok: true, sessionId: 's-new', agentPreset: null }; // the ?? right operand
		const { target } = await mountSeeded();
		chord('n');
		await settle();
		await settle();
		// the sibling landed below the anchor even with no preset in the body
		expect(target.querySelectorAll('[data-testid="panel-column"]').length).toBe(2);
	});

	it("L583 both arms: an agent-only preset leaves the sidebar lane alone; a width lane writes it", async () => {
		configBody = { panel: { presets: { agent: { 1: 640 }, sidebar: { 2: { width: 340 } } } } };
		await loadAppConfig();
		await mountSeeded();
		pagePrefs.panelWidth = 600; // a known baseline before any preset
		// slot 1: agent only — applySidebarLane yields no width (L583 false arm)
		chord('1', 'Digit1');
		flushSync();
		expect(pagePrefs.panelWidth).toBe(640);
		expect(pagePrefs.sidebarWidth).not.toBe(340);
		// slot 2: sidebar width lane → laneWrites.width defined (L583 true arm)
		chord('2', 'Digit2');
		flushSync();
		expect(pagePrefs.sidebarWidth).toBe(340);
		expect(pagePrefs.sidebarCollapsed).toBe(false); // width implies expand (D28)
	});
});
