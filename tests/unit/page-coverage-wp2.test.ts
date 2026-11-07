/**
 * page-coverage-wp2 — branch-hitting tests for src/routes/+page.svelte
 * (coverage gap pass WP2). Same harness conventions as
 * page-arm-gaps.test.ts (reactiveTestPage + settle, stubbed fetch,
 * stubbed EventSource). Branch sites covered (istanbul lines):
 *  - 410 if: chordPaletteRows' Alt+T arm (prefix 't') AND Alt+S arm.
 *  - 403 binary-expr: deskSessionCount's per-mirror tabs reduce (a
 *    restored desk mirror publishes >=1 session so the reduce arm runs).
 *  - 430 switch arms: verb 'g' (454) and 'k' (459).
 *  - 457/462 cond-expr: the toggle add/remove arms for plugin-rack and
 *    skill-shelf (each verb fired twice).
 *  - 442 if: the 'a' sweep's subagent-conversation removal arm.
 *  - 471 if: verb 'n' with no focused conversation (anchor miss -> return).
 *  - 478 cond-expr: the spawn body's workspace-present arm and 496 both
 *    permission-probe arms.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';

class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	readyState = 1;
	frames = new Map<string, (ev: MessageEvent) => void>();
	onerror: ((ev: unknown) => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (ev: MessageEvent) => void): void {
		this.frames.set(type, cb);
	}
	fire(type: string, data: unknown): void {
		const cb = this.frames.get(type);
		if (!cb) return;
		try {
			cb({ data: JSON.stringify(data) } as MessageEvent);
		} catch {
			/* happy-dom canvas ops can throw */
		}
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

/** Configurable fetch doubles + a call ledger the spawn assertions read. */
let sessionsRows: Array<Record<string, unknown>> = [SESSION_ROW];
let permOk = true;
let calls: Array<{ method: string; url: string }> = [];
let spawnBodies: unknown[] = [];
let terminalSessions: Array<{ id: string; exited: boolean }> = [];

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? 'GET').toUpperCase();
			calls.push({ method, url });
			let body: unknown;
			if (url.includes('/api/dsh/sessions') && method === 'POST') {
				spawnBodies.push(JSON.parse(String(init?.body)));
				body = { ok: true, sessionId: 's-new', agentPreset: null };
			} else if (url.includes('/permission') && method === 'GET') {
				body = permOk
					? { ok: true, permission: { current: 'workspace-write' } }
					: { ok: false, permission: null };
			} else if (url.includes('/api/dsh/sessions')) {
				body = { ok: true, sessions: sessionsRows, workspaces: [] };
			} else if (url.includes('/api/a2a')) {
				body = { ok: true, rows: [] };
			} else if (url.includes('/events')) {
				body = { ok: true, entries: [], lastSeq: -1, running: false };
			} else if (url.includes('/models')) {
				body = { ok: true, current: null };
			} else if (url.includes('/reattach')) {
				body = { ok: true, token: 'tk-1' };
			} else if (url.includes('/api/terminal') && method === 'POST') {
				// mintSession: the fresh self-open row gets a live assignment so
				// the desk's published mirror carries a counted sessionId
				body = { sessionId: 't-new', token: 'tk-new' };
			} else if (url.includes('/api/terminal')) {
				body = { ok: true, enabled: true, sessions: terminalSessions };
				body = { ok: true, enabled: true, sessions: [] };
			} else if (url.includes('/api/prompts')) {
				body = { ok: true, prompts: [] };
			} else if (url.includes('/api/skills')) {
				body = { ok: true, skills: [], categories: [] };
			} else if (url.includes('/api/plugins')) {
				body = { ok: true, plugins: [], marketplace: [] };
			} else if (url.includes('/api/config')) {
				body = { ok: true };
			} else {
				body = { ok: true, entries: [], hasMore: false };
			}
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
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

function press(init: { key: string; code?: string; altKey?: boolean }): void {
	window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
	flushSync();
}

/** Alt+S arm + verb letter — the capture-phase chord hears window events. */
function verb(letter: string): void {
	press({ key: 's', code: 'KeyS', altKey: true });
	press({ key: letter, code: 'Key' + letter.toUpperCase() });
}

async function mountWith(
	panels: Array<Record<string, unknown>>,
	opts: { seeded?: boolean } = {}
): Promise<{ target: HTMLElement; instance: Record<string, unknown> }> {
	localStorage.setItem(
		'dsi-panels',
		JSON.stringify({ panels, selectedPanelId: panels[0]?.id ?? null, panelWidth: 600, zoom: 1 })
	);
	const target = document.createElement('div');
	document.body.appendChild(target);
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL(opts.seeded ? 'http://dsi/?sessionKey=s-floor' : 'http://dsi/');
	reactiveTestPage.data = opts.seeded
		? { sessionId: 's-floor', entries: [], lastSeq: -1, running: false, workspace: '/ws/x' }
		: {};
	const instance = mount(Page, { target }) as unknown as Record<string, unknown>;
	await settle();
	await settle();
	return { target, instance };
}

function storedKinds(): string[] {
	const raw = localStorage.getItem('dsi-panels');
	if (!raw) return [];
	const blob = JSON.parse(raw) as { panels?: Array<{ kind?: string }> };
	return (blob.panels ?? []).map((p) => p.kind ?? '');
}

function paletteKeys(target: HTMLElement): string[] {
	return [...target.querySelectorAll('[data-testid="chord-palette-row"]')].map(
		(el) => (el as HTMLElement).dataset.chordKey ?? ''
	);
}

beforeEach(() => {
	installFetch();
	vi.stubGlobal('EventSource', StubEventSource);
	localStorage.clear();
	sessionsRows = [SESSION_ROW];
	permOk = true;
	calls = [];
	spawnBodies = [];
	terminalSessions = [];
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	resetSpineFeedForTests();
	resetStreamHubForTests();
	resetPanelRegistryForTests();
	localStorage.clear();
	document.body.innerHTML = '';
});

describe('+page.svelte WP2 — chord palette rows (410) + deskSessionCount (403)', () => {
	it('Alt+S arm renders the FLOOR verb table — the prefix!==t arm of chordPaletteRows (410 false)', async () => {
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { target, instance } = await mountWith(conv);
		press({ key: 's', code: 'KeyS', altKey: true });
		const keys = paletteKeys(target);
		expect(keys).toContain('g'); // D25: g/k/p/t always live in the Alt+S table
		expect(keys).toContain('k');
		expect(keys).toContain('s');
		unmount(instance);
	});

	it('Alt+T arm renders the TERMINAL table with s/c only when a desk holds sessions (410 true, 403 reduce arm)', async () => {
		// the restored desk mirror re-binds 'sh-1' (live per the probe) and
		// publishes it back through onMirror — deskSessionCount then reduces
		// over mir.tabs (the 403 binary-expr reduce arm, count = 1).
		sessionsRows = [{ ...SESSION_ROW, sessionId: 'sh-1', title: 'Shell' }];
		terminalSessions = [{ id: 'sh-1', exited: false }];
		const entry = [{ id: 'pt', kind: 'terminal', width: 600, desk: { tabs: [{ sessionIds: ['sh-1'] }], selectedTab: 0 } }];
		const { target, instance } = await mountWith(entry);
		await settle();
		await settle();
		press({ key: 't', code: 'KeyT', altKey: true });
		const keys = paletteKeys(target);
		expect(keys).toContain('t');
		expect(keys).toContain('s'); // truthful s row: deskSessionCount() >= 1
		expect(keys).toContain('c');
		unmount(instance);
	});
});

describe('+page.svelte WP2 — dispatchChordVerb toggle arms (430 arms 454/459, cond 457/462)', () => {
	it("verb 'g' ADDs then REMOVEs the plugin rack — switch arm 454 + both 457 cond arms", async () => {
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { instance } = await mountWith(conv);
		verb('g');
		await settle();
		expect(storedKinds()).toContain('plugin-rack'); // 457 falsy arm -> doAdd
		verb('g');
		await settle();
		expect(storedKinds()).not.toContain('plugin-rack'); // 457 truthy arm -> removePanel
		unmount(instance);
	});

	it("verb 'k' ADDs then REMOVEs the skill shelf — switch arm 459 + both 462 cond arms", async () => {
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { instance } = await mountWith(conv);
		verb('k');
		await settle();
		expect(storedKinds()).toContain('skill-shelf'); // 462 falsy arm -> doAdd
		verb('k');
		await settle();
		expect(storedKinds()).not.toContain('skill-shelf'); // 462 truthy arm -> removePanel
		unmount(instance);
	});
});

describe('+page.svelte WP2 — the a sweep + the n sibling spawn', () => {
	it("the 'a' sweep removes a SUBAGENT conversation panel — the 442 if true arm", async () => {
		sessionsRows = [{ ...SESSION_ROW, sessionId: 's-sub', origin: 'subagent', parentSessionId: 's-floor' }];
		const panels = [
			{ id: 'p1', kind: 'conversation', sessionId: 's-sub', agentPreset: null, width: 600 },
			{ id: 'p2', kind: 'skill-shelf', width: 400 }
		];
		const { instance } = await mountWith(panels);
		await settle();
		verb('a');
		await settle();
		const kinds = storedKinds();
		expect(kinds).not.toContain('conversation'); // 442 true arm fired
		expect(kinds).not.toContain('skill-shelf');
		unmount(instance);
	});

	it("verb 'n' with NO focused conversation returns early — the 471 if true arm (no spawn POST)", async () => {
		const entry = [{ id: 'pt', kind: 'skill-shelf', width: 400 }];
		const { instance } = await mountWith(entry);
		calls = [];
		verb('n');
		await settle();
		expect(calls.some((c) => c.method === 'POST' && c.url.includes('/api/dsh/sessions'))).toBe(false);
		unmount(instance);
	});

	it("verb 'n' spawns the sibling WITH cwd (478 truthy) and re-applies the preset (496 truthy arm)", async () => {
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { instance } = await mountWith(conv, { seeded: true });
		await settle();
		calls = [];
		spawnBodies = [];
		verb('n');
		await settle();
		await settle();
		const spawn = calls.find((c) => c.method === 'POST' && c.url.includes('/api/dsh/sessions'));
		expect(spawn).toBeDefined();
		// 478 truthy arm: the resolved workspace rides the POST body
		expect(spawnBodies[0]).toEqual({ agentPreset: null, cwd: '/ws/x' });
		// 496 truthy arm: permission probe ok + non-custom -> the preset line POST
		const preset = calls.find((c) => c.method === 'POST' && c.url.includes('/s-new/permission'));
		expect(preset).toBeDefined();
		// the sibling landed next to the anchor on the floor
		expect(storedKinds().filter((k) => k === 'conversation').length).toBe(2);
		unmount(instance);
	});

	it("verb 'n': a failed permission probe leaves the preset unset (496 falsy arm), the sibling still lands", async () => {
		permOk = false;
		const conv = [{ id: 'p1', kind: 'conversation', sessionId: 's-floor', agentPreset: null, width: 600 }];
		const { instance } = await mountWith(conv, { seeded: true });
		await settle();
		calls = [];
		verb('n');
		await settle();
		await settle();
		expect(calls.some((c) => c.method === 'POST' && c.url.includes('/s-new/permission'))).toBe(false);
		expect(storedKinds().filter((k) => k === 'conversation').length).toBe(2);
		unmount(instance);
	});
});