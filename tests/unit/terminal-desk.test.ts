/**
 * TerminalDesk tests (Terminal Desk Wave 2, tasks 2.1-T / 2.3-T): the
 * structure trees of input Scenarios 1.1 / 1.1.1 / 1.2 / 1.2.1 verbatim,
 * the D5 close cascades (tab x kills its rows; last tab removes the
 * desk), and the one-desk invariant + action forward pinned at the floor
 * source level. Same mock harness as terminal-panel-coverage: xterm,
 * addon-fit, EventSource, ResizeObserver mocked; fetch routed by URL.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';
import { readFileSync } from 'node:fs';

// The first test in this file pays the one-time Svelte compile of
// TerminalDeskHost — under a loaded machine that alone can exceed the 5s
// default. A timed-out test skips h.cleanup(), leaking a live desk that
// then fires phantom session opens into the NEXT test's fetch route
// (observed 2026-09-26: postOpens 2->3 + unhandled rejection at
// TerminalDesk.svelte:139). Give the compile room; leaks are the poison.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const { xtermInstances } = vi.hoisted(() => ({ xtermInstances: [] as Array<{ dataHandler?: (d: string) => void }> }));

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		calls: string[] = [];
		constructor() {
			xtermInstances.push(this);
		}
		open() { this.calls.push('open'); }
		loadAddon() { this.calls.push('loadAddon'); }
		write() { this.calls.push('write'); }
		// recorded so adoption tests can SIMULATE the operator's first
		// keystroke (the claim-on-contact path, ADR 2026-11-24 D3)
		dataHandler?: (d: string) => void;
		onData(fn?: (d: string) => void) {
			this.calls.push('onData');
			if (fn) this.dataHandler = fn;
		}
		onResize(fn?: unknown) { this.calls.push('onResize'); void fn; }
		focus() { this.calls.push('focus'); }
		dispose() { this.calls.push('dispose'); }
	}
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	}
}));

interface FakeES {
	url: string;
	close(): void;
	addEventListener(kind: string, fn: (e: MessageEvent) => void): void;
	emit(kind: string, data?: string): void;
}

const eventSources: FakeES[] = [];

class FakeEventSource implements FakeES {
	url: string;
	listeners = new Map<string, Array<(e: MessageEvent) => void>>();
	constructor(url: string) {
		this.url = url;
		// The Job Bridge (ADR-0081): the desk opens one roster-push stream on mount — out
		// of this registry's scope, which pins the terminal hub sources (ADR-0053).
		if (!url.includes('/api/dsh/jobs/stream')) eventSources.push(this);
	}
	close() {}
	addEventListener(kind: string, fn: (e: MessageEvent) => void) {
		const arr = this.listeners.get(kind) ?? [];
		arr.push(fn);
		this.listeners.set(kind, arr);
	}
	emit(kind: string, data?: string) {
		// the hub wire ALWAYS tags frames with sessionId (ADR-0053); the fake
		// injects this source's first id so test literals stay terse
		let payload = data ?? '';
		try {
			const o = JSON.parse(payload) as Record<string, unknown>;
			if (o && typeof o === 'object' && !('sessionId' in o)) {
				const ids = JSON.parse(new URL('http://x' + this.url).searchParams.get('ids') ?? '[]') as string[];
				o.sessionId = ids[0];
				payload = JSON.stringify(o);
			}
		} catch { /* torn frame stays torn */ }
		for (const fn of this.listeners.get(kind) ?? []) fn({ data: payload } as MessageEvent);
	}
}

class FakeResizeObserver {
	constructor(cb: () => void) {
		void cb;
	}
	observe() {}
	disconnect() {}
}

type FetchRoute = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let fetchRoute: FetchRoute = () => undefined;
let postOpens = 0;
const closeCalls: string[] = [];

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

let deskRef: { applyAction: (a: 'new-tab' | 'split-down') => void } | null = null;

async function mountDesk(): Promise<{ target: HTMLElement; cleanup: () => void }> {
	postOpens = 0;
	closeCalls.length = 0;
	eventSources.length = 0;
	const { default: Host } = await import('./TerminalDeskHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, {
		target,
		props: {
			register: (d: unknown) => {
				deskRef = d as { applyAction: (a: 'new-tab' | 'split-down') => void };
			},
			onShellExit: () => {}
		}
	});
	flushSync();
	await tick();
	flushSync();
	return { target, cleanup: () => { unmount(app); target.remove(); } };
}

function route(): FetchRoute {
	let n = 0;
	return (url, init) => {
		if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
		if (url === '/api/terminal' && init) {
			postOpens++;
			return Promise.resolve(jsonResponse({ sessionId: 'desk-' + ++n, token: 'tok-' + n, totalBytes: 0 }));
		}
		if (url.includes('/send')) {
			const body = JSON.parse(String(init?.body ?? '{}')) as { token?: string; action?: string };
			closeCalls.push((body.token ?? '?') + ':' + (body.action ?? '?'));
			return Promise.resolve(jsonResponse({ ok: true }));
		}
		return Promise.resolve(jsonResponse({}));
	};
}

beforeEach(() => {
	resetStreamHubForTests();
	postOpens = 0;
	closeCalls.length = 0;
	eventSources.length = 0;
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver);
	vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => fetchRoute(String(url), init)));
	deskRef = null;
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('TerminalDesk — scenario structure trees (Wave 2)', () => {
	it('Scenario 1.1 — bare create: one tab, one row, both selected', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="terminal-tab-button-1"]')).toBeNull();
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')?.getAttribute('data-selected')).toBe('true');
		expect(h.target.querySelector('[data-testid="terminal-tab-container-0"]')?.getAttribute('data-visible')).toBe('true');
		expect(h.target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		h.cleanup();
	});

	it('Scenario 1.1.1 — split-down: two rows in tab[0], second selected host', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('split-down');
		await tick();
		flushSync();
		const c0 = h.target.querySelector('[data-testid="terminal-tab-container-0"]')!;
		expect(c0.getAttribute('data-visible')).toBe('true');
		expect(c0.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(2);
		expect(c0.querySelector('[data-testid="terminal-split-container"]')?.getAttribute('data-rows')).toBe('2');
		expect(h.target.querySelectorAll('[data-testid="terminal-tab-button-1"]').length).toBe(0);
		// a split-down NEVER re-attaches: the desk minted a fresh session
		// (two POSTs total: row[0]'s solo self-open + the desk's split-down mint)
		expect(postOpens).toBe(2);
		h.cleanup();
	});

	it('Scenario 1.2 — new-tab: tab[1] selected, tab[0] hidden and alive', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('new-tab');
		await tick();
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-tab-button-1"]')?.getAttribute('data-selected')).toBe('true');
		expect(h.target.querySelector('[data-testid="terminal-tab-container-0"]')?.getAttribute('data-visible')).toBe('false');
		expect(h.target.querySelector('[data-testid="terminal-tab-container-1"]')?.getAttribute('data-visible')).toBe('true');
		h.cleanup();
	});

	it('Scenario 1.2.1 — split-down on the 2nd tab: two rows in container[1]', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('new-tab');
		await tick();
		deskRef!.applyAction('split-down');
		await tick();
		flushSync();
		const c1 = h.target.querySelector('[data-testid="terminal-tab-container-1"]')!;
		expect(c1.getAttribute('data-visible')).toBe('true');
		expect(c1.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(2);
		const c0 = h.target.querySelector('[data-testid="terminal-tab-container-0"]')!;
		expect(c0.getAttribute('data-visible')).toBe('false');
		expect(c0.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		h.cleanup();
	});
});

describe('TerminalDesk — D5 close cascades', () => {
	it('tab x ladder-closes its rows and moves selection to the left neighbor', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('new-tab');
		await tick();
		flushSync();
		// ADR-0053: both rows ride ONE hub source (the old per-row pair is the wound this fixes)
		const before = eventSources.length;
		expect(before).toBe(1);
		(h.target.querySelector('[data-testid="terminal-tab-close-1"]') as HTMLElement).click();
		flushSync();
		expect(closeCalls.filter((c) => c.endsWith('close')).length).toBeGreaterThanOrEqual(1);
		expect(h.target.querySelector('[data-testid="terminal-tab-button-1"]')).toBeNull();
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')?.getAttribute('data-selected')).toBe('true');
		h.cleanup();
	});

	it('closing the LAST tab removes the desk (onShellExit — the floor unmounts the slot)', async () => {
		fetchRoute = route();
		let exited = false;
		const { default: Host } = await import('./TerminalDeskHost.svelte');
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(Host, { target, props: { register: (d: unknown) => { deskRef = d as never; }, onShellExit: () => { exited = true; } } });
		flushSync();
		await tick();
		(target.querySelector('[data-testid="terminal-tab-close-0"]') as HTMLElement).click();
		flushSync();
		await tick();
		expect(exited).toBe(true);
		unmount(app);
		target.remove();
	});
});

describe('TerminalDesk — 2.3-T floor pin (one-desk invariant + action forward, source level)', () => {
	it('the floor keeps the one-desk grammar and forwards the action into the desk', () => {
		// ADR-0019 W1: the one-desk grammar lives in the floor service now;
		// the route keeps the desk mount + the action-forwarding dep seam.
		const src = readFileSync('src/routes/+page.svelte', 'utf8');
		// ADR-0022 W4: the one-desk grammar moved WHOLE to floor-registry/grammar.ts;
		// the shell re-exports the surface (orchestrator-owned pin re-point).
		const svc = readFileSync('src/lib/services/panels/floor-registry/grammar.ts', 'utf8');
		// ONE desk: the open terminal takes the FOCUS; only a miss inserts.
		expect(svc).toContain("panels.find((p) => p.kind === 'terminal')");
		// the parsed command action reaches the desk's applyAction (dep seam)
		expect(svc).toContain('d().applyTerminalDeskAction(request.action)');
		expect(src).toContain('applyTerminalDeskAction: (a) => terminalDeskRef?.applyAction(a)');
		// the floor renders the DESK, not a bare panel, in the terminal branch
		expect(src).toContain('bind:this={terminalDeskRef}');
		// the rebuild ladder's remembered half rides the entry into the desk
		expect(src).toContain('restored={panel.desk ?? null}');
	});
});

describe('TerminalDesk — 3.2-T reload rebuild ladder (Terminal Desk ADR D3)', () => {
	function restoreRoute(live: Array<{ id: string; exited: boolean }>): FetchRoute {
		let n = 0;
		return (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: live }));
			if (url.endsWith('/reattach')) {
				const id = String(url).split('/')[3];
				return Promise.resolve(jsonResponse({ token: 'rt-' + id, fromByte: 4096 }));
			}
			if (url === '/api/terminal' && init) {
				postOpens++;
				return Promise.resolve(jsonResponse({ sessionId: 'fresh-' + ++n, token: 'ft-' + n, totalBytes: 0 }));
			}
			if (url.includes('/send')) {
				const body = JSON.parse(String(init?.body ?? '{}')) as { token?: string; action?: string };
				closeCalls.push((body.token ?? '?') + ':' + (body.action ?? '?'));
				return Promise.resolve(jsonResponse({ ok: true }));
			}
			return Promise.resolve(jsonResponse({}));
		};
	}

	async function mountRestored(restored: unknown): Promise<{ target: HTMLElement; cleanup: () => void }> {
		const { default: Host } = await import('./TerminalDeskHost.svelte');
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(Host, {
			target,
			props: {
				register: (d: unknown) => { deskRef = d as never; },
				restored: restored as never,
				onShellExit: () => {}
			}
		});
		flushSync();
		await tick();
		flushSync();
		await tick();
		return { target, cleanup: () => { unmount(app); target.remove(); } };
	}

	it('survivors re-attach at byte 0; the exited session drops; tab grouping and selection restore', async () => {
		fetchRoute = restoreRoute([
			{ id: 'sess-a', exited: false },
			{ id: 'sess-b', exited: true },
			{ id: 'sess-c', exited: false }
		]);
		const h = await mountRestored({
			tabs: [{ sessionIds: ['sess-a'] }, { sessionIds: ['sess-b', 'sess-c'] }],
			selectedTab: 1
		});
		// three remembered ids, one exited: two rows survive, grouped as remembered
		expect(h.target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(2);
		const c0 = h.target.querySelector('[data-testid="terminal-tab-container-0"]')!;
		const c1 = h.target.querySelector('[data-testid="terminal-tab-container-1"]')!;
		expect(c0.getAttribute('data-visible')).toBe('false');
		expect(c1.getAttribute('data-visible')).toBe('true'); // selection RESTORED to tab 1
		expect(c0.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		expect(c1.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		// survivors RE-ATTACH through the HUB: one source whose id set settles
		// to both remembered sessions (replay resumes from byte 0 per row)
		await tick(320); // the 300ms set-diff debounce settles the second row in
		expect(eventSources.length).toBe(2);
		const lastUrl = eventSources[eventSources.length - 1].url;
		const ids = JSON.parse(new URL('http://x' + lastUrl).searchParams.get('ids') ?? '[]') as string[];
		expect(ids.sort()).toEqual(['sess-a', 'sess-c']);
		expect(postOpens).toBe(0);
		h.cleanup();
	});

	it('all remembered sessions dead ⇒ one fresh self-open row (never a dead frame)', async () => {
		fetchRoute = restoreRoute([{ id: 'sess-a', exited: true }]);
		const h = await mountRestored({ tabs: [{ sessionIds: ['sess-a'] }], selectedTab: 0 });
		await tick();
		expect(h.target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		// the fallback row SELF-OPENS through the mint path (a fresh session)
		expect(postOpens).toBe(1);
		h.cleanup();
	});

	it('the desk PUBLISHES its mirror as the tree settles (task 3.2-T, onMirror)', async () => {
		fetchRoute = route();
		const mirrors: unknown[] = [];
		const { default: Host } = await import('./TerminalDeskHost.svelte');
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(Host, {
			target,
			props: {
				register: (d: unknown) => { deskRef = d as never; },
				onMirror: (m: unknown) => mirrors.push(m),
				onShellExit: () => {}
			}
		});
		flushSync();
		await tick();
		deskRef!.applyAction('new-tab');
		await tick();
		flushSync();
		const last = mirrors[mirrors.length - 1] as { tabs: Array<{ sessionIds: string[] }>; selectedTab: number };
		expect(last.tabs.length).toBe(2);
		expect(last.selectedTab).toBe(1);
		// every remembered row carries a session id (self-open reported via onAssigned)
		expect(last.tabs[0].sessionIds.length).toBe(1);
		expect(last.tabs[1].sessionIds.length).toBe(1);
		unmount(app);
		target.remove();
	});
});


describe('TerminalDesk — 4.1-T full cascade matrix (Terminal Desk ADR D5)', () => {
	it('exit in the LAST shell cascades: row → tab → desk (onShellExit)', async () => {
		fetchRoute = route();
		let exited = false;
		const { default: Host } = await import('./TerminalDeskHost.svelte');
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(Host, {
			target,
			props: { register: (d: unknown) => { deskRef = d as never; }, onShellExit: () => { exited = true; } }
		});
		flushSync();
		await tick();
		// the shell runs to its end: the row's stream settles with session_exit
		const es = eventSources[0] as unknown as { emit(kind: string, data?: string): void };
		es.emit('settled', JSON.stringify({ reason: 'session_exit' }));
		// the panel holds the badge readable for 1500 ms before auto-closing
		await new Promise((r2) => setTimeout(r2, 1700));
		flushSync();
		expect(exited).toBe(true);
		expect(target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(0);
		unmount(app);
		target.remove();
	});

	it('column close (unmount while the page lives) kills every row session', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('split-down');
		await tick();
		flushSync();
		closeCalls.length = 0;
		h.cleanup(); // the floor unmounted the desk — panel close IS terminal close
		expect(closeCalls.filter((c) => c.endsWith('close')).length).toBe(2);
	});

	it('pagehide spares every session (the lease rule, desk-wide)', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('split-down');
		await tick();
		flushSync();
		closeCalls.length = 0;
		window.dispatchEvent(new Event('pagehide'));
		h.cleanup();
		expect(closeCalls.filter((c) => c.endsWith('close')).length).toBe(0);
	});
});

describe('TerminalDesk — 4.2-T session cap refusal (Terminal Desk ADR D6)', () => {
	it('MAX_SESSIONS renders the refusal and opens NO row', async () => {
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
			if (url === '/api/terminal' && init) return Promise.resolve(new Response(JSON.stringify({ error: 'MAX_SESSIONS' }), { status: 429, headers: { 'content-type': 'application/json' } }));
			return Promise.resolve(jsonResponse({}));
		};
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('split-down');
		await tick();
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-desk-capped"]')).not.toBeNull();
		expect(h.target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		h.cleanup();
	});
});


describe('TerminalDesk — the grown-up strip (2026-11-03 amendment D5b/D5c/D5d)', () => {
	it('Clear terminals ladder-closes every shell, then mints a FRESH T1 — the desk slot survives', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('new-tab'); // two shells, two sessions
		await tick();
		flushSync();
		const before = closeCalls.length;
		expect(h.target.querySelectorAll('[data-testid="terminal-tab-button-0"]')).not.toBeNull();

		// open the popover and fire Clear terminals
		click(h.target, '[data-testid="terminal-tabstrip-clear"]');
		click(h.target, '[data-testid="terminal-tabstrip-clear-terminals"]');
		await tick(30);
		flushSync();

		// both old sessions were ladder-closed, and ONE fresh session was minted
		const closes = closeCalls.slice(before);
		expect(closes.filter((c) => c.endsWith(':close')).length).toBeGreaterThanOrEqual(2);
		const freshMints = postOpens - 2; // 2 initial mints (row + new-tab), fresh T1 adds 1
		expect(freshMints).toBe(1);
		// the fresh T1 exists and is selected — the desk did NOT remove its slot
		expect(h.target.querySelector('[data-testid="terminal-desk"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')?.getAttribute('data-selected')).toBe('true');
		h.cleanup();
	});

	it('the popover has three verbs and NO Cancel (D5b)', async () => {
		fetchRoute = route();
		const h = await mountDesk();
		await tick();
		click(h.target, '[data-testid="terminal-tabstrip-clear"]');
		expect(h.target.querySelector('[data-testid="terminal-tabstrip-clear-all"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="terminal-tabstrip-clear-jobs"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="terminal-tabstrip-clear-terminals"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="terminal-tabstrip-clear-cancel"]')).toBeNull();
		// outside click cancels (direct element dispatch — the backdrop covers
		// the viewport in the browser, so any real outside click lands on it)
		const bd = h.target.querySelector('.backdrop');
		(bd as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(h.target.querySelector('[data-testid="terminal-tabstrip-clear-pop"]')).toBeNull();
		h.cleanup();
	});
	it("D5d′ — the job-ROW loop is INSIDE its tab, after the shell rows (source-level pin)", () => {
		// readFileSync pattern per this file's house style. Successor of the
		// job-TAB pin (the shipped bug once nested each job tab inside the shell
		// loop): The Job Bridge 4.1 retired the Tn-J species, so what is pinned
		// now is its replacement's geometry — a job ROW belongs to its TAB. The
		// row loop sits INSIDE the tabs loop, after the shell `{#each tab.rows`
		// loop's close (stacked under the shells); no job-tab loop remains.
		const source = readFileSync('src/lib/components/terminal/TerminalDesk.svelte', 'utf8');
		const tabsOpen = source.indexOf('{#each tabs as tab, i (tab.key)}');
		const shellOpen = source.indexOf('{#each tab.rows as row (row.key)}', tabsOpen);
		const shellClose = source.indexOf('{/each}', shellOpen);
		const rowOpen = source.indexOf('{#each tab.jobRows as jobRow (jobRow.key)}');
		const rowClose = source.indexOf('{/each}', rowOpen);
		const tabsClose = source.indexOf('{/each}', rowClose + 1);
		expect(tabsOpen).toBeGreaterThan(-1);
		expect(shellOpen).toBeGreaterThan(tabsOpen);
		expect(rowOpen).toBeGreaterThan(shellClose); // AFTER the shell rows
		expect(rowClose).toBeLessThan(tabsClose); // INSIDE its tab
		expect(source).not.toContain('{#each jobTabs'); // the tab species is gone
	});
});

function click(target: HTMLElement, sel: string): void {
	(target.querySelector(sel) as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}
/* ============================================================
 * Wave 3 — adoption of wire-born sessions (ADR 2026-11-24
 * The Headless Split, D2/D3/D4). The born frame rides the ONE hub
 * (session-born event); the desk adopts DISPLAY-FIRST: no token mint,
 * no {} reattach at adoption; the first keystroke claims.
 * ============================================================ */

type AdoptMirror = { tabs: Array<{ sessionIds: string[] }>; selectedTab: number };

describe('TerminalDesk — adoption of wire-born sessions (Wave 3)', () => {
	let mirrors: AdoptMirror[];
	let reattachCalls: string[];
	let mintCalls: number;
	let sendBodies: string[];

	function adoptRoute(listSessions: Array<{ id: string; exited: boolean; deskIntent?: string }>): FetchRoute {
		return (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: listSessions }));
			if (url === '/api/terminal' && init) {
				mintCalls++;
				return Promise.resolve(jsonResponse({ sessionId: 'desk-' + mintCalls, token: 'tok-' + mintCalls, totalBytes: 0 }));
			}
			if (url.includes('/reattach')) {
				reattachCalls.push(url);
				return Promise.resolve(jsonResponse({ token: 'healed-tok', fromByte: 0 }));
			}
			if (url.includes('/send')) {
				const body = JSON.parse(String(init?.body ?? '{}')) as { token?: string; action?: string };
				sendBodies.push(String(init?.body ?? '{}'));
				// the fence: a tokenless write (adopted row pre-claim) 403s
				if (!body.token) return Promise.resolve(new Response(JSON.stringify({ error: 'FOREIGN_SESSION' }), { status: 403 }));
				return Promise.resolve(jsonResponse({ ok: true }));
			}
			return Promise.resolve(jsonResponse({}));
		};
	}

	async function mountAdoptDesk(restored?: AdoptMirror | null): Promise<{ target: HTMLElement; cleanup: () => void }> {
		postOpens = 0;
		closeCalls.length = 0;
		eventSources.length = 0;
		xtermInstances.length = 0;
		mirrors = [];
		reattachCalls = [];
		mintCalls = 0;
		sendBodies = [];
		const { default: Host } = await import('./TerminalDeskHost.svelte');
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(Host, { target, props: { onShellExit: () => undefined, onMirror: (m: AdoptMirror) => mirrors.push(m), restored: restored ?? null } });
		flushSync();
		await tick();
		flushSync();
		return { target, cleanup: () => { unmount(app); target.remove(); } };
	}

	function bornFrom(payload: Record<string, unknown>): void {
		const es = eventSources[eventSources.length - 1];
		if (!es) throw new Error('no hub EventSource open');
		es.emit('session-born', JSON.stringify(payload));
	}

	beforeEach(() => {
		fetchRoute = () => undefined;
	});

	it('D2+D3: a session-born with new-tab intent adopts as a NEW SELECTED tab — no mint, no reattach', async () => {
		fetchRoute = adoptRoute([]);
		const h = await mountAdoptDesk();
		await tick();
		expect(h.target.querySelectorAll('[data-testid^="terminal-tab-button-"]').length).toBe(1);
		bornFrom({ sessionId: 't-77', deskIntent: 'new-tab', baton: { holder: 'automation', holderId: 'lead', since: 1 } });
		await tick();
		flushSync();
		expect(h.target.querySelectorAll('[data-testid^="terminal-tab-button-"]').length).toBe(2);
		expect(h.target.querySelector('[data-testid="terminal-tab-button-1"]')?.getAttribute('data-selected')).toBe('true');
		expect(mintCalls).toBe(1); // only the desk's own self-open row — adoption minted NOTHING
		expect(reattachCalls).toHaveLength(0); // D3: adoption never claims
		h.cleanup();
	});

	it('D2+D3: split-down intent stacks a row on the SELECTED tab', async () => {
		fetchRoute = adoptRoute([]);
		const h = await mountAdoptDesk();
		await tick();
		bornFrom({ sessionId: 't-88', deskIntent: 'split-down', baton: { holder: 'automation', holderId: 'lead', since: 1 } });
		await tick();
		flushSync();
		const c0 = h.target.querySelector('[data-testid="terminal-tab-container-0"]')!;
		expect(c0.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(2);
		expect(c0.querySelector('[data-testid="terminal-split-container"]')?.getAttribute('data-rows')).toBe('2');
		expect(mintCalls).toBe(1);
		expect(reattachCalls).toHaveLength(0);
		h.cleanup();
	});

	it('D4: the adopted sessionId rides the mirror publish', async () => {
		fetchRoute = adoptRoute([]);
		const h = await mountAdoptDesk();
		await tick();
		bornFrom({ sessionId: 't-99', deskIntent: 'split-down', baton: { holder: 'automation', holderId: 'lead', since: 1 } });
		await tick();
		flushSync();
		const flat = mirrors.flatMap((m) => m.tabs.flatMap((tb) => tb.sessionIds));
		expect(flat).toContain('t-99');
		h.cleanup();
	});

	it('D2: an intent-less birth is IGNORED (the headless ghost stays invisible)', async () => {
		fetchRoute = adoptRoute([]);
		const h = await mountAdoptDesk();
		await tick();
		bornFrom({ sessionId: 't-2', baton: { holder: 'automation', holderId: 'lead', since: 1 } });
		await tick();
		flushSync();
		expect(h.target.querySelectorAll('[data-testid^="terminal-tab-button-"]').length).toBe(1);
		h.cleanup();
	});

	it('D3: the FIRST operator keystroke claims via the existing heal — exactly once', async () => {
		fetchRoute = adoptRoute([]);
		const h = await mountAdoptDesk();
		await tick();
		bornFrom({ sessionId: 't-55', deskIntent: 'split-down', baton: { holder: 'automation', holderId: 'lead', since: 1 } });
		await tick();
		flushSync();
		expect(reattachCalls).toHaveLength(0);
		await tick();
		flushSync();
		// simulate the operator typing into the adopted row
		// the xterm surface attaches through a dynamic import — POLL for the
		// keystroke handler instead of a fixed sleep (skill 3.5.3)
		let term: { dataHandler?: (d: string) => void } | undefined;
		for (let i = 0; i < 50; i++) {
			term = xtermInstances[xtermInstances.length - 1] as { dataHandler?: (d: string) => void };
			if (typeof term?.dataHandler === 'function') break;
			await tick(10);
		}
		// poll loop above guarantees a handler is attached; fail loudly if not
		const dataHandler = term?.dataHandler;
		if (typeof dataHandler !== 'function') throw new Error('xterm keystroke handler never attached');
		dataHandler('uname -sr\n');
		await tick(30);
		// one heal reattach (the claim) — adoption fired none, so 1 total
		expect(reattachCalls).toHaveLength(1);
		// the retried write carried the healed token
		const writes = sendBodies
			.map((b) => JSON.parse(b) as { action?: string; token?: string })
			.filter((b) => b.action === 'write');
		expect(writes.some((w) => w.token === 'healed-tok')).toBe(true);
		h.cleanup();
	});

	it('branch I: a birth from BEFORE the mount (intent in the registry, no mirror) is adopted on rebuild — display-first', async () => {
		// a dead intent session proves the exited guard; t-40 proves adoption
		fetchRoute = adoptRoute([{ id: 't-7', exited: false }, { id: 't-40', exited: false, deskIntent: 'new-tab' }, { id: 't-41', exited: true, deskIntent: 'split-down' }]);
		const h = await mountAdoptDesk({ tabs: [{ sessionIds: ['t-7'] }], selectedTab: 0 });
		await tick(320); // probe + reattach + restore settle
		flushSync();
		// the mirror-remembered t-7 restored (reattach), the intent-carrying
		// t-40 adopted WITHOUT reattach, the exited t-41 ignored
		expect(reattachCalls.some((u) => u.includes('t-7'))).toBe(true);
		expect(reattachCalls.some((u) => u.includes('t-40'))).toBe(false);
		const labels = [...h.target.querySelectorAll('[data-testid^="terminal-tab-button-"]')].map((b) => b.textContent ?? '');
		expect(labels.some((l) => l.includes('40'))).toBe(true);
		expect(labels.some((l) => l.includes('41'))).toBe(false);
		h.cleanup();
	});
});
