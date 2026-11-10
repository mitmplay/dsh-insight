/**
 * TerminalDesk arm-gap mop (2026-11-10): the close-cascade arms the main
 * suites do not reach — Same mock harness as terminal-desk.test.ts /
 * terminal-desk-clear-chord.test.ts (xterm + EventSource + ResizeObserver
 * mocked, fetch routed by URL):
 *  - destroyRowSession: a DELETE that REJECTS at the transport level is
 *    swallowed (res undefined) and the clear-tab still closes the tab;
 *  - destroyRowSession: the 403 heal where the REATTACH itself fails —
 *    no retry delete, the tab still closes (body?.token falsy arm);
 *  - clearScope('all'): the strip's Clear-all verb closes job tabs AND
 *    ladders the shells into ONE fresh T1;
 *  - clearScope('jobs'): the Clear-jobs verb removes ONLY job tabs —
 *    shells untouched.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStreamHubForTests } from '$lib/services/terminal/stream-hub.svelte';
import { __resetFollowClientForTests, openJobTab } from '$lib/services/jobs/follow-client.svelte';
import { appConfig } from '$lib/services/config/app-config.svelte';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		open() {}
		loadAddon() {}
		write() {}
		onData() {}
		focus() {}
		dispose() {}
	}
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	}
}));

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}
	close(): void {
		this.closed = true;
	}
	addEventListener(kind: string, fn: (e: MessageEvent) => void): void {
		if (kind === 'message') this.onmessage = (e) => fn(e as MessageEvent);
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
const deleteCalls: Array<{ id: string; token: string }> = [];
let reattachCalls = 0;
const closeCalls: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

type DeskRef = { applyAction: (a: 'new-tab' | 'split-down' | 'clear-tab') => void };
let deskRef: DeskRef | null = null;

async function mountDesk(): Promise<{ target: HTMLElement; cleanup: () => void }> {
	const { default: Host } = await import('../../TerminalDeskHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, {
		target,
		props: {
			register: (d: unknown) => {
				deskRef = d as DeskRef;
			},
			onShellExit: () => {}
		}
	});
	flushSync();
	await tick();
	flushSync();
	return { target, cleanup: () => { unmount(app); target.remove(); } };
}

function baseRoute(): FetchRoute {
	let n = 0;
	return (url, init) => {
		if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
		if (url === '/api/terminal' && init) {
			return Promise.resolve(jsonResponse({ sessionId: 'desk-' + ++n, token: 'tok-' + n, totalBytes: 0 }));
		}
		if (url.includes('/reattach')) {
			reattachCalls++;
			return Promise.resolve(jsonResponse({ token: 'tok-fresh', fromByte: 0 }));
		}
		if (url.includes('/delete') && init) {
			const m = url.match(new RegExp('terminal/([^/]+)/delete'));
			deleteCalls.push({
				id: m ? m[1] : '?',
				token: (JSON.parse(String(init.body ?? '{}')) as { token?: string }).token ?? ''
			});
			return Promise.resolve(jsonResponse({ pruned: true }));
		}
		if (url.includes('/send')) {
			const body = JSON.parse(String(init?.body ?? '{}')) as { token?: string; action?: string };
			closeCalls.push((body.token ?? '?') + ':' + (body.action ?? '?'));
			return Promise.resolve(jsonResponse({ ok: true }));
		}
		return Promise.resolve(jsonResponse({}));
	};
}

function click(target: HTMLElement, sel: string): void {
	(target.querySelector(sel) as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}

beforeEach(() => {
	resetStreamHubForTests();
	deleteCalls.length = 0;
	closeCalls.length = 0;
	reattachCalls = 0;
	deskRef = null;
	FakeEventSource.instances = [];
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver);
	vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => fetchRoute(String(url), init)));
});

afterEach(() => {
	__resetFollowClientForTests();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('TerminalDesk — destroyRowSession transport arms', () => {
	it('a DELETE that REJECTS is swallowed and the clear-tab still closes the tab', async () => {
		let n = 0;
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
			if (url === '/api/terminal' && init) {
				return Promise.resolve(jsonResponse({ sessionId: 'desk-' + ++n, token: 'tok-' + n, totalBytes: 0 }));
			}
			if (url.includes('/delete')) {
				const m = url.match(new RegExp('terminal/([^/]+)/delete'));
				deleteCalls.push({
					id: m ? m[1] : '?',
					token: (JSON.parse(String(init?.body ?? '{}')) as { token?: string }).token ?? ''
				});
				return Promise.reject(new Error('socket gone')); // transport death
			}
			return Promise.resolve(jsonResponse({}));
		};
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('clear-tab');
		await tick(30);
		flushSync();
		expect(deleteCalls.length).toBe(1); // the delete WAS attempted
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')).toBeNull(); // the tab still closed
		h.cleanup();
	});

	it('a 403 heal whose REATTACH fails does NOT retry the delete; the tab still closes', async () => {
		let n = 0;
		fetchRoute = (url, init) => {
			if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: [] }));
			if (url === '/api/terminal' && init) {
				return Promise.resolve(jsonResponse({ sessionId: 'desk-' + ++n, token: 'tok-' + n, totalBytes: 0 }));
			}
			if (url.includes('/reattach')) return Promise.resolve(jsonResponse({ error: 'NO_SESSION' }, 404)); // heal fails
			if (url.includes('/delete') && init) {
				deleteCalls.push({ id: '?', token: (JSON.parse(String(init.body ?? '{}')) as { token?: string }).token ?? '' });
				return Promise.resolve(jsonResponse({ error: 'FOREIGN_SESSION' }, 403)); // stale token
			}
			return Promise.resolve(jsonResponse({}));
		};
		const h = await mountDesk();
		await tick();
		deskRef!.applyAction('clear-tab');
		await tick(30);
		flushSync();
		expect(deleteCalls.map((c) => c.token)).toEqual(['tok-1']); // no second delete
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')).toBeNull();
		h.cleanup();
	});
});

describe('TerminalDesk — clearScope verbs', () => {
	it("Clear ALL closes job tabs AND ladders the shells into ONE fresh T1", async () => {
		fetchRoute = baseRoute();
		appConfig().jobs.autoClose = false;
		const h = await mountDesk();
		await tick();
		openJobTab('session-a', 'j1', 'cov');
		flushSync();
		expect(h.target.textContent).toContain('-J'); // the job tab is present
		const shellsBefore = closeCalls.length;
		click(h.target, '[data-testid="terminal-tabstrip-clear"]');
		click(h.target, '[data-testid="terminal-tabstrip-clear-all"]');
		await tick(30);
		flushSync();
		// the job tab is gone...
		expect(h.target.textContent).not.toContain('-J');
		// ...and the shells were ladder-closed into one fresh T1 (selected)
		const closes = closeCalls.slice(shellsBefore).filter((c) => c.endsWith(':close'));
		expect(closes.length).toBeGreaterThanOrEqual(1);
		expect(h.target.querySelector('[data-testid="terminal-tab-button-0"]')?.getAttribute('data-selected')).toBe('true');
		h.cleanup();
	});

	it('Clear JOBS removes only the job tabs — shells untouched', async () => {
		fetchRoute = baseRoute();
		appConfig().jobs.autoClose = false;
		const h = await mountDesk();
		await tick();
		openJobTab('session-a', 'j1', 'cov');
		flushSync();
		const before = closeCalls.length;
		click(h.target, '[data-testid="terminal-tabstrip-clear"]');
		click(h.target, '[data-testid="terminal-tabstrip-clear-jobs"]');
		await tick(30);
		flushSync();
		expect(h.target.textContent).not.toContain('-J');
		expect(closeCalls.slice(before).filter((c) => c.endsWith(':close'))).toEqual([]); // no shell killed
		expect(h.target.querySelectorAll('[data-testid="terminal-panel"]').length).toBe(1);
		h.cleanup();
	});
});
