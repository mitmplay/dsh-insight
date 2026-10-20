/**
 * ConversationPanel × Slash Menu wiring (task 2.3-T): the panel bridges
 * the session's host catalog to the composer (onslashopen → directoryFor,
 * fetched on first menu open — never at mount) and routes BOTH command
 * surfaces through the ONE executeHostCommand rung (D2):
 *
 *  - menu pick → POST …/command with the canonical line, banner note,
 *    draft cleared on admit
 *  - submit ladder (after parseCommand declines) → POST …/command with
 *    the draft VERBATIM; an admission miss keeps the draft and banners
 *    honestly — never a fallback prompt POST (the RCA incident)
 *  - unknown /nope submits as chat (the ladder's last rung unchanged)
 *  - dead session → mapped session-not-found banner verbatim, draft kept
 *  - DSI gestures keep absolute priority over the ladder
 *  - menu state dies with the panel; the per-session cache survives it
 *
 * Fetch is stubbed at the route seam (stubPanelRoutes pattern); the
 * slash-directory cache is session-keyed module state, so every test
 * mounts its own session id and afterEach invalidates all.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Static on purpose: the panel must bind to the SAME svelte runtime as
// mount/flushSync below (second-instance binding → effect_orphan).
import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';
import { invalidateAll } from '../../src/lib/services/chat/slash-directory.svelte';
import { registerAddPanel } from '../../src/lib/services/panels/panel-registry';

function coldProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		agent: null,
		entries: [],
		lastSeq: -1,
		running: false,
		...overrides
	};
}

interface Route {
	test: (url: string, init?: RequestInit) => boolean;
	respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
}

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function stubPanelRoutes(routes: Route[]): Array<{ url: string; method: string; body?: string }> {
	const calls: Array<{ url: string; method: string; body?: string }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			calls.push({
				url,
				method: init?.method ?? 'GET',
				body: init?.body === undefined ? undefined : String(init.body)
			});
			for (const r of routes) if (r.test(url, init)) return await r.respond(url, init);
			return jsonRes({ ok: true, entries: [], lastSeq: -1, running: false, gap: false });
		})
	);
	return calls;
}

const CATALOG = {
	ok: true,
	commands: [{ name: 'compact', description: 'Compact the session context' }],
	skills: [{ name: 'dsh-doc', description: 'Answer from the DSH docs', modelInvocable: true }]
};

const catalogRoute = (sessionId: string): Route => ({
	test: (url) => url.endsWith(`/api/dsh/session/${sessionId}/catalog`),
	respond: () => jsonRes(CATALOG)
});

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
	// Response.json() settles on a MACROtask in happy-dom (the suggest
	// file's flushMicro lesson): a real 0ms timer hop releases it without
	// waiting on wall-clock time (fake-timer-safe — advanceTimersByTimeAsync
	// would need fake timers armed; a real setTimeout(0) hop works either way).
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

/** Mount one panel on its own session (the module cache is session-keyed). */
async function mountPanel(sessionId: string, routes: Route[]) {
	const calls = stubPanelRoutes([catalogRoute(sessionId), ...routes]);
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ConversationPanel, {
		target,
		props: coldProps({ sessionId }) as never
	});
	await settle();
	const composer = () => target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	/** Type a draft WITHOUT submitting (the menu rides the live draft). */
	const typeDraft = (text: string): void => {
		const ta = composer();
		ta.value = text;
		ta.selectionStart = ta.selectionEnd = text.length;
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	};
	/** Press Enter on the composer (the real submit path). */
	const pressEnter = async (): Promise<void> => {
		composer().dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
		);
		await settle();
		await settle();
	};
	const noteOf = (): string =>
		(target.querySelector('[data-testid="command-note"]') as HTMLElement | null)?.textContent ?? '';
	// Unmount + DOM removal — an abandoned panel keeps polling and bleeds
	// fetches into the NEXT test's stub.
	const cleanup = (): void => {
		unmount(instance);
		target.remove();
	};
	return { target, instance, calls, composer, typeDraft, pressEnter, noteOf, cleanup };
}

beforeEach(() => {
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			observe(): void {}
			disconnect(): void {}
			unobserve(): void {}
		}
	);
});

afterEach(() => {
	invalidateAll(); // the module-level session cache must not leak between tests
	registerAddPanel(null); // the floor handler is a per-test registration
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Slash Panel wiring — the catalog bridge (fetched on open, never at mount)', () => {
	it('mounting the panel fetches nothing; opening the menu kicks one catalog fetch', async () => {
		const { target, calls, typeDraft, cleanup } = await mountPanel('s-bridge', []);
		const catalogFetches = () => calls.filter((c) => c.url.endsWith('/catalog'));
		expect(catalogFetches()).toHaveLength(0); // mount is silent — cold sessions stay cold
		typeDraft('/');
		expect(target.querySelector('[data-testid="slash-menu"]')).not.toBeNull(); // opens at once
		await vi.waitFor(() => {
			expect(catalogFetches()).toHaveLength(1); // single-flight first read
			expect(target.querySelectorAll('[data-testid="slash-command-row"]')).toHaveLength(1);
		});
		const rows = target.querySelectorAll('[data-testid="slash-command-row"]');
		expect(rows[0].getAttribute('data-name')).toBe('compact');
		typeDraft('/c'); // re-query on a ready cache — no second fetch
		await settle();
		expect(catalogFetches()).toHaveLength(1);
		cleanup();
	});

	it('menu state dies with the panel; the per-session cache survives the remount', async () => {
		const first = await mountPanel('s-dies', []);
		first.typeDraft('/');
		await settle();
		expect(first.target.querySelector('[data-testid="slash-menu"]')).not.toBeNull();
		unmount(first.instance);
		first.target.remove();
		// A fresh panel on the SAME session: menu state starts gone, and
		// the re-read is SERVED BY THE CACHE — rows render with no second
		// catalog fetch (one fetch per session, ADR §3.3).
		const second = await mountPanel('s-dies', []);
		expect(second.calls.filter((c) => c.url.endsWith('/catalog'))).toHaveLength(0);
		second.typeDraft('/');
		await settle();
		expect(second.target.querySelector('[data-testid="slash-menu"]')).not.toBeNull();
		expect(second.target.querySelectorAll('[data-testid="slash-command-row"]')).toHaveLength(1);
		expect(second.calls.filter((c) => c.url.endsWith('/catalog'))).toHaveLength(0);
		unmount(second.instance);
		second.target.remove();
	});
});

describe('Slash Panel wiring — menu command pick', () => {
	it('a pick POSTs the canonical line to …/command, banners the receipt, clears the draft', async () => {
		const { target, calls, typeDraft, noteOf, composer, cleanup } = await mountPanel('s-pick', [
			{
				test: (url, init) => url.endsWith('/command') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, executed: true, text: 'context compacted' })
			}
		]);
		typeDraft('/');
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="slash-command-row"]')).not.toBeNull();
		});
		(target.querySelector('[data-testid="slash-command-row"]') as HTMLElement).click();
		await settle();
		const commandPosts = calls.filter((c) => c.url.endsWith('/command'));
		expect(commandPosts).toHaveLength(1);
		expect(commandPosts[0].body).toBe(JSON.stringify({ line: '/compact' }));
		expect(noteOf()).toContain('context compacted'); // the banner note IS the receipt
		expect(composer().value).toBe(''); // admitted execution clears the draft
		expect(calls.some((c) => c.url.endsWith('/prompt'))).toBe(false); // never the model
		cleanup();
	});
});

describe('Slash Panel wiring — the submit ladder (after parseCommand declines)', () => {
	it('a known host command routes VERBATIM through …/command and clears the draft', async () => {
		const { calls, typeDraft, pressEnter, composer, noteOf, cleanup } = await mountPanel('s-ladder', [
			{
				test: (url, init) => url.endsWith('/command') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, executed: true, text: 'compacted' })
			}
		]);
		typeDraft('/'); // open the menu — the bridge warms the cache
		await settle();
		typeDraft('/COMPACT'); // case-insensitive token, typed verbatim
		await pressEnter();
		const commandPosts = calls.filter((c) => c.url.endsWith('/command'));
		expect(commandPosts).toHaveLength(1);
		expect(commandPosts[0].body).toBe(JSON.stringify({ line: '/COMPACT' })); // never re-cased
		expect(noteOf()).toContain('compacted');
		expect(composer().value).toBe('');
		cleanup();
	});

	it('an admission miss keeps the draft, banners honestly, and never falls back to the model', async () => {
		const { calls, typeDraft, pressEnter, composer, noteOf, cleanup } = await mountPanel('s-miss', [
			{
				test: (url, init) => url.endsWith('/command') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, executed: false })
			}
		]);
		typeDraft('/');
		await settle();
		typeDraft('/compact now');
		await pressEnter();
		expect(noteOf()).toContain('unknown command: /compact');
		expect(noteOf()).toContain('nothing was sent');
		expect(composer().value).toBe('/compact now'); // the draft is the operator's to fix
		expect(calls.some((c) => c.url.endsWith('/prompt'))).toBe(false); // the RCA incident stays impossible
		cleanup();
	});

	it('an unknown /nope submits as chat (prompt POST, no command POST)', async () => {
		const { calls, typeDraft, pressEnter, cleanup } = await mountPanel('s-nope', []);
		typeDraft('/');
		await settle();
		typeDraft('/nope the plan');
		await pressEnter();
		expect(calls.some((c) => c.url.endsWith('/command'))).toBe(false);
		const promptPosts = calls.filter((c) => c.url.endsWith('/prompt') && c.method === 'POST');
		expect(promptPosts).toHaveLength(1);
		expect(JSON.parse(promptPosts[0].body as string)).toMatchObject({ text: '/nope the plan' });
		cleanup();
	});
});

describe('Slash Panel wiring — honesty on a dead session', () => {
	it('a pick on a dead session banners the mapped error verbatim and keeps the draft', async () => {
		const { target, calls, typeDraft, noteOf, composer, cleanup } = await mountPanel('s-dead', [
			{
				test: (url, init) => url.endsWith('/command') && init?.method === 'POST',
				respond: () =>
					jsonRes(
						{ ok: false, error: { code: 'session-not-found', message: 'session not found: s-dead' } },
						404
					)
			}
		]);
		typeDraft('/');
		await vi.waitFor(() => {
			expect(target.querySelector('[data-testid="slash-command-row"]')).not.toBeNull();
		});
		(target.querySelector('[data-testid="slash-command-row"]') as HTMLElement).click();
		await settle();
		expect(noteOf()).toContain('session not found: s-dead');
		expect(composer().value).toBe('/'); // kept — the honest banner is the whole story
		expect(calls.filter((c) => c.url.endsWith('/command'))).toHaveLength(1);
		expect(target.querySelector('[data-testid="slash-menu"]')).toBeNull(); // memo-closed
		cleanup();
	});
});

describe('Slash Panel wiring — DSI gestures keep absolute priority', () => {
	it('/permission hits the typed route, never the ladder', async () => {
		const { calls, typeDraft, pressEnter, noteOf, cleanup } = await mountPanel('s-gesture-perm', [
			{
				test: (url, init) => url.endsWith('/permission') && init?.method === 'POST',
				respond: () => jsonRes({ ok: true, text: 'preset: read-only' })
			}
		]);
		typeDraft('/'); // catalog ready — the ladder is armed
		await settle();
		typeDraft('/permission read-only'); // a parser hit — the menu never even opened
		await pressEnter();
		expect(calls.some((c) => c.url.endsWith('/command'))).toBe(false);
		const permPosts = calls.filter((c) => c.url.endsWith('/permission'));
		expect(permPosts).toHaveLength(1);
		expect(noteOf()).toContain('preset: read-only');
		cleanup();
	});

	it('/new is claimed by the parser (no catalog consult, no command POST)', async () => {
		const { calls, typeDraft, pressEnter, noteOf, cleanup } = await mountPanel('s-gesture-new', []);
		typeDraft('/');
		await settle();
		typeDraft('/new');
		await pressEnter();
		expect(calls.some((c) => c.url.endsWith('/command'))).toBe(false);
		expect(calls.some((c) => c.url.endsWith('/api/dsh/sessions'))).toBe(false); // no floor → the usage path
		expect(noteOf()).toContain('/new');
		cleanup();
	});

	it('a mention is claimed by the parser (no command POST)', async () => {
		// The mention resolves the target against the spine and hands the
		// panel-open to the floor — both are means, not the subject here.
		registerAddPanel(() => true);
		const { target, calls, typeDraft, pressEnter, cleanup } = await mountPanel('s-gesture-mention', [
			{
				test: (url) => url.endsWith('/api/dsh/sessions'),
				respond: () =>
					jsonRes({
						ok: true,
						sessions: [
							{
								sessionId: 'session-12345678-1234-5678-1234-123456789012',
								title: 'target',
								agentPreset: 'main',
								running: false,
								turns: 0
							}
						]
					})
			}
		]);
		typeDraft('/');
		await vi.waitFor(() => {
			// the ladder is armed once the catalog read lands
			expect(target.querySelector('[data-testid="slash-menu"]')).not.toBeNull();
		});
		typeDraft('@session-12345678-1234-5678-1234-123456789012 hello over there');
		await pressEnter();
		expect(calls.some((c) => c.url.endsWith('/command'))).toBe(false);
		expect(calls.some((c) => c.url.endsWith('/prompt') && c.method === 'POST')).toBe(true); // delivered to the target
		cleanup();
	});
});
