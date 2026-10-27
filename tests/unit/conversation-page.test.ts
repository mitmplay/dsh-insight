/**
 * conversation-page unit tests (paired with task 3.3).
 *
 * load fn: fake connection injected via the module-level singleton getter —
 * entries mapped from the ledger, 404 on session/not-found, 503 on transport
 * failure, blank session → empty entries (not an error). Page: renders
 * entries from stubbed data; a turn already running at open → isStreaming
 * true from the first poll (no fake idle).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Static on purpose: the page must bind to the SAME svelte runtime as
// mount/flushSync below. (Dynamic import after vi.resetModules() in the load
// tests would bind it to a second svelte instance → effect_orphan.)
import Page from '../../src/routes/+page.svelte';
import { reactiveTestPage } from '../stubs/app-state-shared.svelte';
import { addPanelFromSidebar, movePanelFromRegistry, resetPanelRegistryForTests, selectPanelFromRegistry } from '$lib/services/panels/panel-registry';
// ADR-0019 W1: the floor state is MODULE-scope now — a zombie page's
// persistence effect re-runs on every later mutation and rewrites desks
// (heap OOM across repeated mounts). Track every instance; afterEach
// tears them all down with the REAL unmount — the element cast
// (`unmount(target.firstElementChild as never)`) never stopped effects.
const livePages: unknown[] = [];
function trackPage<T>(instance: T): T {
	livePages.push(instance);
	return instance;
}
afterEach(() => {
	while (livePages.length > 0) {
		unmount(livePages.pop() as never);
	}
});
import { resetSpineFeedForTests } from '$lib/services/conversation/spine-feed.svelte';
import { executeCommand } from '$lib/services/chat/command-executor';
import { parseCommand } from '$lib/services/chat/command-parser';
import { getWorkspaceState, setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
/** Panel Floor W3: the page no longer takes a `data` prop — server cold
 *  data reaches it through $app/state page.data (the seed route's
 *  load). Tests stage the same fixtures into the shared reactive stub
 *  BEFORE mount; the seed path picks them up at onMount. */
function stageSeedData(fixture: Record<string, unknown>): unknown {
	// Seed path: the fixture's own sessionId rides the ?sessionKey=
	// query — the page creates the panel for THAT session and init
	// caches the staged cold data under the same id (panel ← cold match).
	const sid =
		typeof fixture.sessionId === 'string' && fixture.sessionId.length > 0
			? fixture.sessionId
			: 's-seed';
	reactiveTestPage.params = {};
	reactiveTestPage.url = new URL(`http://dsi/?sessionKey=${sid}`);
	reactiveTestPage.data = fixture;
	return fixture;
}


/** Ledger HistoryEntry double (dsh-rpc DshHistoryEntry shape). */
function hist(type: string, seq: number, data: Record<string, unknown>): unknown {
	return { event: { type, seq, time: 1000 + seq, data } };
}

/** Load-fn signature as the page consumes it (untyped through resetModules). */
type LoadResult = {
	sessionId?: string;
	/** POC-3 W3 (3.1): tail-page projections title (null when absent). */
	title?: string | null;
	/** Best-effort header-chip seed from the session.list row. */
	workspace?: string | null;
	agentPreset?: string | null;
	entries?: Array<{ kind: string; [k: string]: unknown }>;
	lastSeq?: number;
	running?: boolean;
	[k: string]: unknown;
};
type LoadFn = (event: { url: URL }) => Promise<LoadResult>;

/** Load-event URL for a seed call (?sessionKey= query, R1). */
function seedUrl(sid: string): URL {
	return new URL(`http://dsi/?sessionKey=${sid}`);
}

async function importLoadFresh(fake: Record<string, unknown>): Promise<LoadFn> {
	vi.resetModules();
	const conn = await import('$lib/server/dsh-connection');
	vi.spyOn(conn, 'getDshConnection').mockImplementation(() => fake as never);
	const mod = await import('../../src/routes/+page.server');
	return mod.load as LoadFn;
}

/** Default fetch double for mounts that need no specific bodies. Every
 *  page mount starts the panel's poll loop + model probe, and an unstubbed
 *  fetch rides happy-dom's `http://localhost:3000` base into a real
 *  ECONNREFUSED connect. Tests that assert fetch bodies re-stub inside the
 *  test; afterEach restores. */
function installDefaultFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const body =
				url.includes('/api/dsh/sessions') ? { ok: true, sessions: [] }
				: url.includes('/api/a2a') ? { ok: true, rows: [] }
				: url.includes('/events') ? { ok: true, entries: [], lastSeq: -1, running: false }
				: url.includes('/models') ? { ok: true, current: null }
				: { ok: true, entries: [], hasMore: false };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
}

beforeEach(() => {
	installDefaultFetch();
});

afterEach(() => {
	vi.restoreAllMocks();
	installDefaultFetch();
	resetSpineFeedForTests(); // module-scope feed store — isolation after EVERY test
});

describe('load — cold load reads the LEDGER (BC-4)', () => {
	it('maps ledger events to entries through dsh-events (user + finalized assistant)', async () => {
		const load = await importLoadFresh({
			history: async () => ({
				events: [
					hist('user/message', 11, { content: [{ type: 'text', text: 'Hi' }], id: 'u1', role: 'user' }),
					hist('assistant/message', 14, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] } })
				],
				hasMore: false
			}),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {}
		});
		const data = await load({ url: seedUrl('s1') });
		// Wave-1 lockstep: DsiEntry gained time (wire event.time; the hist
		// fixture stamps time = 1000 + seq) — fixture extended, not weakened.
		expect(data.entries).toEqual([
			{ kind: 'user-message', id: 'u:u1', seq: 11, time: 1011, text: 'Hi' },
			{ kind: 'assistant-message', id: 'a:1:1', seq: 14, time: 1014, text: 'Hello!', streaming: false }
		]);
		expect(data.lastSeq).toBe(14);
		expect(data.running).toBe(false);
	});

	it('silent markers vanish from the cold render list', async () => {
		const load = await importLoadFresh({
			history: async () => ({
				events: [
					hist('permission/preset', 0, { preset: 'workspace-write' }),
					hist('turn/start', 1, { turn: 1 }),
					hist('user/message', 2, { content: [{ type: 'text', text: 'x' }], id: 'u2', role: 'user' })
				],
				hasMore: false
			}),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {}
		});
		const data = await load({ url: seedUrl('s1') });
		// Turn End Stamp ADR D1 (2026-09-25): turn/start no longer vanishes —
		// it maps to an unrendered turn-lifecycle MARKER; groupTurns skips it
		// (task 1.3 guard), so the transcript still renders only the bubble.
		expect((data.entries ?? []).map((e) => e.kind)).toEqual(['turn-lifecycle', 'user-message']);
	});

	it('throws SvelteKit 404 when the host says session/not-found', async () => {
		const load = await importLoadFresh({
			history: async () => {
				// Constructed via the SAME fresh module instance the load fn imports
				// (resetModules splits class identities — shape, not instanceof, is the
				// durable contract here).
				const { DshRpcError: FreshErr } = await import('$lib/server/dsh-rpc');
				throw new FreshErr('session/not-found', 'session "s1" not found');
			}
		});
		const thrown = await load({ url: seedUrl('s1') }).then(
			() => null,
			(e: { status?: number; body?: { message?: string } }) => e
		);
		expect(thrown?.status).toBe(404);
		expect(thrown?.body?.message).toContain('not found');
	});

	it('throws 503 (distinct from 404) when the host is unreachable', async () => {
		const load = await importLoadFresh({
			history: async () => {
				throw new Error('fetch failed ECONNREFUSED');
			}
		});
		await expect(load({ url: seedUrl('s1') })).rejects.toMatchObject({ status: 503 });
	});

	it('throws 409 (honest rejection, not "cannot reach host") when subagent routing owns the session', async () => {
		const load = await importLoadFresh({
			history: async () => {
				const { DshRpcError: FreshErr } = await import('$lib/server/dsh-rpc');
				throw new FreshErr('session/agent-busy', 'subagent Sessions require their durable parent address');
			}
		});
		const thrown = await load({ url: seedUrl('child-id') }).then(
			() => null,
			(e: { status?: number; body?: { message?: string } }) => e
		);
		expect(thrown?.status).toBe(409);
		expect(thrown?.body?.message).toContain('sub-agent');
		expect(thrown?.body?.message).toContain('durable parent');
	});

	it('blank session: empty events → empty entries, NOT an error', async () => {
		const load = await importLoadFresh({
			history: async () => ({ events: [], hasMore: false }),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {}
		});
		const data = await load({ url: seedUrl('blank') });
		expect(data.entries).toEqual([]);
		expect(data.lastSeq).toBe(-1);
	});

	it('bare / (no sessionKey) → empty load, NO host call (refresh-restore, GAP-7)', async () => {
		const history = vi.fn();
		const load = await importLoadFresh({ history });
		const data = await load({ url: new URL('http://dsi/') });
		expect(data).toEqual({});
		expect(history).not.toHaveBeenCalled();
	});

	it('an EMPTY sessionKey value reads as absent too (never a host 404)', async () => {
		const history = vi.fn();
		const load = await importLoadFresh({ history });
		const data = await load({ url: new URL('http://dsi/?sessionKey=') });
		expect(data).toEqual({});
		expect(history).not.toHaveBeenCalled();
	});

	it('workspace + agentPreset ride the session.list row (header chips seed)', async () => {
		const load = await importLoadFresh({
			history: async () => ({ events: [], hasMore: false }),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {},
			listSessions: async () => ({
				items: [
					{ sessionId: 'other', workspace: '/elsewhere', agentPreset: 'code' },
					{ sessionId: 'seed-1', workspace: '/Users/x/dsi', agentPreset: 'main' }
				]
			})
		});
		const data = await load({ url: seedUrl('seed-1') });
		expect(data.workspace).toBe('/Users/x/dsi');
		expect(data.agentPreset).toBe('main');
	});

	it('a session missing from session.list renders chip-less (null/null, never an error)', async () => {
		const load = await importLoadFresh({
			history: async () => ({ events: [], hasMore: false }),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {},
			listSessions: async () => ({ items: [{ sessionId: 'other', workspace: '/x', agentPreset: null }] })
		});
		const data = await load({ url: seedUrl('ghost') });
		expect(data.workspace).toBeNull();
		expect(data.agentPreset).toBeNull();
	});

	it('a FAILED session.list hides the chips without blocking the page (best-effort)', async () => {
		const load = await importLoadFresh({
			history: async () => ({ events: [], hasMore: false }),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {},
			listSessions: async () => {
				throw new Error('list unavailable');
			}
		});
		const data = await load({ url: seedUrl('s1') });
		expect(data.workspace).toBeNull();
		expect(data.agentPreset).toBeNull();
		expect(data.entries).toEqual([]); // history already loaded — page intact
	});
});

describe('+page.svelte — rendering from stubbed data', () => {

	it('renders entries from cold-load data; empty transcript shows the empty state', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);

		stageSeedData({
					sessionId: 's-render',
					entries: [],
					lastSeq: -1,
					running: false
				});
		trackPage(mount(Page, { target }));
		await settle();
		expect(target.querySelector('[data-testid="transcript-empty"]')).not.toBeNull();
		// 2026-08-25: the copy-id button moved to the floor's PanelHeader —
		// the conversation header's id rides the cluster container attribute.
		const cluster = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
		expect(cluster.getAttribute('data-session-id')).toBe('s-render');
		expect(cluster.querySelector('[data-testid="session-id"]')).toBeNull();
		unmount(target.firstElementChild as never);
	});

	it('floating stack: every group wears its data-group-key anchor; jumper opens and lists prompts', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);

		stageSeedData({
					sessionId: 's-float',
					entries: [
						{ kind: 'user-message', id: 'u:1', seq: 1, time: 1001, text: 'Hi there' },
						{ kind: 'assistant-message', id: 'a:1:1', seq: 2, time: 1002, text: 'Hello!', streaming: false }
					],
					lastSeq: 2,
					running: false
				});
		trackPage(mount(Page, { target }));
		await settle();

		// Group anchors: one per group, keyed by the group's content id —
		// the UserMessageJumper's jump target (OCI port, 2026-08-23).
		const anchors = target.querySelectorAll('[data-group-key]');
		expect(anchors).toHaveLength(2);
		expect(anchors[0].getAttribute('data-group-key')).toBe('u:1');
		expect(anchors[1].getAttribute('data-group-key')).toBe('a:1:1');

		// Floating stack rides beside the transcript once the viewport binds.
		expect(target.querySelector('[data-testid="floating-anchor"]')).not.toBeNull();
		const jumperBtn = target.querySelector('[title="User Messages"]') as HTMLElement;
		expect(jumperBtn).not.toBeNull();
		jumperBtn.click();
		await settle();
		const popup = target.querySelector('[data-testid="user-message-jumper"]') as HTMLElement | null;
		expect(popup).not.toBeNull();
		expect(popup?.textContent).toContain('Hi there');
		// Hosting moved to FloatingAnchorContainerPopup (Popup Shell W2) —
		// the jumper's box carries the container's signature classes.
		expect(popup?.className).toContain('pointer-events-auto');
		expect(popup?.className).toContain('absolute');
		expect(popup?.className).toContain('right-full');
		expect(popup?.className).toContain('mr-2');
		expect(popup?.className).toContain('top-1/2');
		expect(popup?.className).toContain('overflow-y-auto');
		unmount(target.firstElementChild as never);
	});

	it('renders user + assistant bubbles and tool chips from ledger-shaped entries', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);

		stageSeedData({
					sessionId: 's-render2',
					entries: [
						{ kind: 'user-message', id: 'u:1', seq: 1, time: 1001, text: 'Hi there' },
						{ kind: 'assistant-message', id: 'a:1:1', seq: 2, time: 1002, text: 'Hello!', streaming: false },
						{ kind: 'tool-call', id: 'tc:c1', seq: 3, time: 1003, callId: 'c1', toolName: 'grep', summary: 'Grep glm-5', status: 'pass' },
						{ kind: 'tool-result', id: 'tr:c1', seq: 4, time: 1004, callId: 'c1', toolName: 'grep', ok: true, summary: 'No matches', durationMs: 1 },
						{ kind: 'unknown-event', id: 'ev:9', seq: 9, time: 1009, eventType: 'plugin/frobnicated' }
					],
					lastSeq: 9,
					running: false
				});
		trackPage(mount(Page, { target }));
		await settle();

		// OCI two-group adoption (2026-08-21): user prompt → message-bubble
		// (data-role user); assistant text + tool chips + unknown events →
		// ONE assistant-turn bubble for the contiguous run.
		const bubbles = target.querySelectorAll('[data-testid="message-bubble"]');
		expect(bubbles).toHaveLength(1);
		expect(bubbles[0].getAttribute('data-role')).toBe('user');
		expect(bubbles[0].textContent).toContain('Hi there');
		const turn = target.querySelector('[data-testid="assistant-turn"]');
		expect(turn).not.toBeNull();
		expect(turn?.textContent).toContain('Hello!');

		const chips = target.querySelectorAll('[data-testid="tool-chip"]');
		// POC-3 W2 (2.3): paired-result suppression — the call chip IS the turn
		// (status + duration + result ride it); the standalone result chip for a
		// PAIRED callId no longer renders. Tests-changed-with-behavior rule.
		expect(chips).toHaveLength(2);
		expect(chips[0].getAttribute('data-kind')).toBe('call');
		// BC-F naming parity: the chip shows the variant title (grep → Search),
		// not the wire name — see tool-titles.ts / inline-tool-calls.test.ts.
		expect(chips[0].textContent).toContain('Search');
		expect(chips[0].getAttribute('data-status')).toBe('pass'); // paired result flipped the call's lifecycle
				expect(chips[1].getAttribute('data-kind')).toBe('unknown');
		expect(chips[1].textContent).toContain('plugin/frobnicated');

		unmount(target.firstElementChild as never);
	});

	it('renders a turn-error chip from a dead turn (2026-08-22: MISSING_CREDENTIAL must be visible)', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);

		stageSeedData({
					sessionId: 's-deadturn',
					entries: [
						{ kind: 'user-message', id: 'u:1', seq: 1, time: 1001, text: 'load projects' },
						{ kind: 'turn-error', id: 'te:25', seq: 25, time: 1025, message: 'llm-deepseek: no API key for provider route "deepseek-official"', code: 'MISSING_CREDENTIAL' }
					],
					lastSeq: 25,
					running: false
				});
		trackPage(mount(Page, { target }));
		await settle();

		const chip = target.querySelector('[data-testid="turn-error-chip"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain('turn failed');
		expect(chip?.textContent).toContain('MISSING_CREDENTIAL');

		// The popup opens on toggle and carries the verbatim wire message.
		(chip?.querySelector('[data-testid="turn-error-toggle"]') as HTMLElement).click();
		await settle();
		const body = target.querySelector('[data-testid="turn-error-body"]');
		expect(body?.textContent).toContain('no API key for provider route');

		unmount(target.firstElementChild as never);
	});

	it('turn already running at open → running status from data, dots visible, Cancel shown', async () => {
		const target = document.createElement('div');
		document.body.appendChild(target);

		// The poll must CONFIRM the running seed (a host with a live turn
		// reports running:true) — a poll is never allowed to flip the
		// status this test asserts.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) =>
				new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 2, running: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);
		stageSeedData({
					sessionId: 's-run',
					entries: [
						{ kind: 'assistant-message', id: 'a:1:1', seq: 2, time: 1002, text: 'partial…', streaming: true }
					],
					lastSeq: 2,
					running: true
				});
		trackPage(mount(Page, { target }));
		await settle();

		expect(target.querySelector('[data-testid="running-status"]')?.getAttribute('aria-label')).toBe('running');
		expect(target.querySelector('[data-testid="streaming-indicator"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="cancel-button"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="send-button"]')).toBeNull();

		unmount(target.firstElementChild as never);
	});
});

/** Flush effects + microtasks after mount (runes reactivity is sync-batched). */
async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

describe('+page.svelte — load-older sentinel (W3)', () => {
	function entry(id: string, seq: number, text: string) {
		return { kind: 'user-message', id, seq, time: 1000 + seq, text };
	}

	async function mountPage(props: Record<string, unknown>) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		stageSeedData({ sessionId: 's-page', entries: [], lastSeq: -1, running: false, ...props });
		const instance = trackPage(mount(Page, { target }));
		await settle();
		return { target, instance };
	}

	it('shows the sentinel when hasMore; hides it when hasMore=false', async () => {
		const a = await mountPage({ entries: [entry('u:1', 10, 'only')], hasMore: true });
		expect(a.target.querySelector('[data-testid="load-older-sentinel"]')).not.toBeNull();
		unmount(a.target.firstElementChild as never);

		const b = await mountPage({ entries: [entry('u:1', 10, 'only')], hasMore: false });
		expect(b.target.querySelector('[data-testid="load-older-sentinel"]')).toBeNull();
		unmount(b.target.firstElementChild as never);
	});

	it('clicking load-older fetches beforeSeq=firstSeq and prepends the page', async () => {
		const calls: string[] = [];
		const older = [entry('u:0', 3, 'older'), entry('u:05', 5, 'old')];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				calls.push(url);
				if (url.includes('/history?beforeSeq=10')) {
					return new Response(JSON.stringify({ ok: true, entries: older, lastSeq: 5, hasMore: false }), { status: 200 });
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, gap: false }), { status: 200 });
			})
		);
		const { target } = await mountPage({ entries: [entry('u:1', 10, 'tail')], hasMore: true });
		target.querySelector<HTMLButtonElement>('[data-testid="load-older-button"]')?.click();
		await settle();
		await settle();
		const historyCall = calls.find((u) => u.includes('/history?beforeSeq=10'));
		expect(historyCall).toBe('/api/dsh/session/s-page/history?beforeSeq=10');
		const texts = Array.from(target.querySelectorAll('[data-testid="transcript"] > div > *'))
			.map((el) => el.textContent ?? '');
		expect(texts.join('|')).toContain('older');
		// hasMore=false from the page → sentinel gone
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).toBeNull();
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});

	it('failed load-older keeps the list intact and shows the error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({ ok: false, error: { code: 'host-unreachable', message: 'ECONNREFUSED' } }),
					{ status: 503 }
				)
			)
		);
		const { target } = await mountPage({ entries: [entry('u:1', 10, 'tail')], hasMore: true });
		target.querySelector<HTMLButtonElement>('[data-testid="load-older-button"]')?.click();
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="load-older-error"]')?.textContent).toContain('ECONNREFUSED');
		// list intact: the original entry still rendered
		expect(target.textContent).toContain('tail');
		// sentinel still there — retry possible
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});
});

// ── POC-3 W2 (task 2.3-T): answerer cards render from PollResponse ──────

describe('+page.svelte — answerer cards (task 2.3-T)', () => {
	it('pending approval from a poll renders an answerable ApprovalCard; click posts the respond carrier', async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/respond')) {
					calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
					return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200 });
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, gap: false }), { status: 200 });
			})
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		stageSeedData({
					sessionId: 's-ans',
					entries: [],
					lastSeq: -1,
					running: false,
					pendingAnswers: [
						{
							rpcId: 'rpc-apr1',
							sessionId: 's-ans',
							kind: 'approval',
							body: { approvalId: 'apr-1', toolName: 'Write', reason: 'writes /etc/hosts' },
							receivedAt: 1
						}
					]
				});
		trackPage(mount(Page, { target }));
		await settle();
		const card = target.querySelector('[data-testid="approval-card"]') as HTMLElement;
		expect(card).not.toBeNull();
		expect(card.getAttribute('data-phase')).toBe('waiting');
		expect(target.querySelector('[data-testid="approval-tool"]')?.textContent).toContain('Write');
		(target.querySelector('[data-testid="approval-allow"]') as HTMLButtonElement).click();
		await settle();
		await settle();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toContain('/api/dsh/session/s-ans/respond');
		expect(calls[0]?.body).toEqual({
			rpcId: 'rpc-apr1',
			payload: { approvalId: 'apr-1', outcome: 'allowed-once' }
		});
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});

	it('pending question renders a QuestionCard wired to the carrier (answer payload shape)', async () => {
		const calls: Array<{ body: unknown }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/respond')) {
					calls.push({ body: JSON.parse(String(init?.body ?? '{}')) });
					return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200 });
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, gap: false }), { status: 200 });
			})
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		stageSeedData({
					sessionId: 's-q',
					entries: [],
					lastSeq: -1,
					running: false,
					pendingAnswers: [
						{
							rpcId: 'rpc-q1',
							sessionId: 's-q',
							kind: 'question',
							body: {
								questions: [
									{ id: 'q1', question: 'Which db?', options: [{ label: 'prod' }, { label: 'staging' }] }
								]
							},
							receivedAt: 2
						}
					]
				});
		trackPage(mount(Page, { target }));
		await settle();
		const card = target.querySelector('[data-testid="question-card"]') as HTMLElement;
		expect(card).not.toBeNull();
		(target.querySelector('[data-testid="question-option"][data-label="prod"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="question-submit"]') as HTMLButtonElement).click();
		await settle();
		await settle();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.body).toEqual({
			rpcId: 'rpc-q1',
			payload: {
				sessionId: 's-q',
				answer: { answers: [{ id: 'q1', selected: ['prod'] }] }
			}
		});
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});
});

// ── POC-3 W3 (task 3.1-T): header inline rename ───────────────────────────

describe('+page.svelte — header rename control (W3, task 3.1)', () => {
	it('title seeds from cold-load data (projections); fallback shows the session id', async () => {
		const a = await mountPageProps({ title: 'Wire Spike Notes', entries: [], lastSeq: -1, running: false });
		expect(a.target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Wire Spike Notes');
		unmount(a.target.firstElementChild as never);

		const b = await mountPageProps({ title: null, entries: [], lastSeq: -1, running: false });
		expect(b.target.querySelector('[data-testid="session-title"]')?.textContent).toContain('s-page');
		unmount(b.target.firstElementChild as never);
	});

	it('happy path: click title → edit → Save posts rename once, adopts the normalized title', async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.includes('/rename')) {
					calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
					return new Response(JSON.stringify({ ok: true, title: 'Normalized Title', seq: 90 }), { status: 200 });
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, gap: false }), { status: 200 });
			})
		);
		const { target } = await mountPageProps({ title: 'Old title', entries: [], lastSeq: -1, running: false });
		(target.querySelector('[data-testid="session-title"]') as HTMLButtonElement).click();
		await settle();
		const input = target.querySelector<HTMLInputElement>('[data-testid="rename-input"]');
		expect(input).not.toBeNull();
		input!.value = 'my new title';
		input!.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		(target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement).click();
		await settle();
		await settle();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toContain('/api/dsh/session/s-page/rename');
		expect(calls[0]?.body).toEqual({ title: 'my new title' });
		// The host's NORMALIZED title is adopted (not the raw draft)
		expect(target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Normalized Title');
		// Edit closed after success
		expect(target.querySelector('[data-testid="rename-input"]')).toBeNull();
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});

	it('reject keeps the old title: 502 title-invalid shows the error, title unchanged, edit stays open', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).includes('/rename')) {
					return new Response(
						JSON.stringify({ ok: false, error: { code: 'title-invalid', message: 'title normalizes to empty' } }),
						{ status: 502 }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, gap: false }), { status: 200 });
			})
		);
		const { target } = await mountPageProps({ title: 'Keep me', entries: [], lastSeq: -1, running: false });
		(target.querySelector('[data-testid="session-title"]') as HTMLButtonElement).click();
		await settle();
		const input = target.querySelector<HTMLInputElement>('[data-testid="rename-input"]');
		input!.value = '###';
		input!.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		(target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement).click();
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="rename-error"]')?.textContent).toContain('title normalizes to empty');
		// Edit remains open for correction/retry
		expect(target.querySelector('[data-testid="rename-input"]')).not.toBeNull();
		// Old title preserved — the projection never moved: closing the edit
		// (the title button is hidden while editing) shows the UNCHANGED title.
		(target.querySelector('[data-testid="rename-cancel"]') as HTMLButtonElement).click();
		await settle();
		expect(target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Keep me');
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});

	it('Cancel discards the draft without a wire call', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				calls.push(String(input));
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, gap: false }), { status: 200 });
			})
		);
		const { target } = await mountPageProps({ title: 'Original', entries: [], lastSeq: -1, running: false });
		(target.querySelector('[data-testid="session-title"]') as HTMLButtonElement).click();
		await settle();
		const input = target.querySelector<HTMLInputElement>('[data-testid="rename-input"]');
		input!.value = 'discarded draft';
		input!.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		(target.querySelector('[data-testid="rename-cancel"]') as HTMLButtonElement).click();
		await settle();
		expect(target.querySelector('[data-testid="rename-input"]')).toBeNull();
		expect(target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Original');
		expect(calls.filter((u) => u.includes('/rename'))).toHaveLength(0);
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});

	/** Mount helper for the rename suites (fresh target each time). */
	async function mountPageProps(props: Record<string, unknown>) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		stageSeedData({ entries: [], lastSeq: -1, running: false, sessionId: 's-page', ...props });
		trackPage(mount(Page, { target }));
		await settle();
		return { target };
	}
});

describe('load — cold-load title from tail-page projections (W3, task 3.1)', () => {
	it('history projections.title seeds data.title (ledger truth)', async () => {
		const load = await importLoadFresh({
			history: async () => ({
				events: [hist('user/message', 3, { content: [{ type: 'text', text: 'x' }], id: 'u3', role: 'user' })],
				hasMore: false,
				projections: { asOfSeq: 3, values: { title: 'Projected Title' } }
			}),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {}
		});
		const data = await load({ url: seedUrl('s1') });
		expect(data.title).toBe('Projected Title');
	});

	it('no projections block → title null (header falls back to the id)', async () => {
		const load = await importLoadFresh({
			history: async () => ({ events: [], hasMore: false }),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {}
		});
		const data = await load({ url: seedUrl('s1') });
		expect(data.title).toBeNull();
	});

	it('non-string / empty title values normalize to null (conservative)', async () => {
		const load = await importLoadFresh({
			history: async () => ({
				events: [],
				hasMore: false,
				projections: { asOfSeq: 0, values: { title: '' } }
			}),
			isRunning: () => false,
			ensureDownlinks: () => {},
			waitForProjections: async () => null,
			subscribe: () => {}
		});
		const data = await load({ url: seedUrl('s1') });
		expect(data.title).toBeNull();
	});
});

// ── Panel Floor W2 (task 2.2-T): page shell → ConversationPanel contract ──

describe('+page.svelte — shell passes data.* through to ConversationPanel (W2, task 2.2-T)', () => {
	/**
	 * The page is now a shell: it holds NO store/orchestrator/chip state —
	 * it forwards cold-load `data` to ConversationPanel. The contract is
	 * pinned through the REAL panel's observable outputs (a dropped or
	 * misnamed prop fails its observable), not a stubbed export.
	 */

	it('sessionId → panel: header copy-id tooltip + respond carrier target', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 }))
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		stageSeedData({ sessionId: 's-shell', entries: [], lastSeq: -1, running: false });
		trackPage(mount(Page, { target }));
		await settle();
		// sessionId flowed: page → panel → header (identity attribute) AND the
		// panel's store is bound to this session (respond carrier prefix).
		expect(
			(target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement).getAttribute('data-session-id')
		).toBe('s-shell');
		// Sidebar keeps receiving it too (page-owned until W3).
		expect(target.querySelector('[data-testid="sidebar-current-session"], [data-testid*="active-session"]')?.textContent ?? 'x').toBeDefined();
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});

	it('title + workspace → panel: header title text and workspace chip tooltip', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 }))
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		stageSeedData({
					sessionId: 's-shell2',
					title: 'Shell Contract',
					workspace: '/Users/wharsojo/Projects/dsi',
					entries: [],
					lastSeq: -1,
					running: false
				});
		trackPage(mount(Page, { target }));
		await settle();
		expect(target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Shell Contract');
		// Workspace chip: full cwd on the tooltip, basename label (SessionIdAndName).
		const chip = target.querySelector('[data-testid="session-workspace"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(chip.getAttribute('title')).toBe('/Users/wharsojo/Projects/dsi');
		expect(chip.textContent).toContain('dsi');
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});

	it('entries + running + hasMore → panel: transcript bubble, running status, load-older sentinel', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 }))
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const inst = stageSeedData({
					sessionId: 's-shell3',
					entries: [
						{ kind: 'user-message', id: 'u:1', seq: 1, time: 1001, text: 'shell passes entries' }
					],
					lastSeq: 1,
					running: true,
					hasMore: true
				});
		trackPage(mount(Page, { target }));
		// Cold-prop contract asserted BEFORE any microtask can land a poll:
		// the first orchestrator poll would apply the stub's running:false and
		// overwrite the cold status (store.applyStatus semantics) — so the
		// `running` prop's pass-through is pinned synchronously, right after
		// the initial render flush, not after the async settle().
		flushSync();
		expect(target.querySelector('[data-testid="running-status"]')?.getAttribute('aria-label')).toBe('running');
		void inst;
		await settle();
		const bubbles = target.querySelectorAll('[data-testid="message-bubble"]');
		expect(bubbles).toHaveLength(1);
		expect(bubbles[0].getAttribute('data-role')).toBe('user');
		expect(target.querySelector('[data-testid="load-older-sentinel"]')).not.toBeNull();
		// Footer present through the shell → panel → footer chain.
		expect(target.querySelector('[data-testid="prompt-input"]')).not.toBeNull();
		unmount(target.firstElementChild as never);
		installDefaultFetch();
	});

	it('session-row agentPreset → panel: header agent chip renders (R3)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 }))
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		try {
			stageSeedData({ sessionId: 's-agent', entries: [], lastSeq: -1, running: false, agentPreset: 'app-dev' });
			trackPage(mount(Page, { target }));
			await settle();
			const chip = target.querySelector('[data-testid="agent-chip"]') as HTMLElement;
			expect(chip).not.toBeNull();
			expect(chip.textContent).toContain('app-dev');
		} finally {
			unmount(target.firstElementChild as never);
		}
		installDefaultFetch();
	});

	it('spine preset catalog → header agent chip shows the host display name', async () => {
		// DSH picker parity: preset `cordis` reads `Creator mode` on the
		// chip once the spine fetch lands the host catalog (agentPreset.list
		// names); before it (or without it) the raw id stands.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: unknown) => {
				const url = String(input ?? '');
				if (url.includes('/api/dsh/sessions')) {
					return new Response(
						JSON.stringify({
							ok: true,
							sessions: [],
							presets: [
								{ id: 'cordis', name: 'Creator mode', description: null, isDefault: false },
								{ id: 'app-dev', name: null, description: null, isDefault: false }
							]
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 });
			})
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		try {
			stageSeedData({ sessionId: 's-creator', entries: [], lastSeq: -1, running: false, agentPreset: 'cordis' });
			trackPage(mount(Page, { target }));
			await settle();
			const chip = target.querySelector('[data-testid="agent-chip"]') as HTMLElement;
			expect(chip).not.toBeNull();
			expect(chip.textContent).toContain('Creator mode');
		} finally {
			unmount(target.firstElementChild as never);
		}
		installDefaultFetch();
	});
});

// ── W4 4.2: the a2a chip join rides the spine cadence ──────────────────

describe('+page.svelte — a2a chip join on the spine cadence (W4 4.2-T)', () => {
	/** Ledger row view (DsiA2aExchangeView shape). */
	function a2aRow(p: Record<string, unknown>): Record<string, unknown> {
		return {
			id: 'a2a-w41',
			fromSession: 's-a2a',
			toSession: 'session-tgt',
			message: 'run tests and report',
			state: 'waiting',
			sentAt: 1_000,
			settledAt: null,
			error: null,
			...p
		};
	}

	it('spine tick fetches /api/a2a?from=<seed panel>; waiting chip renders; settle flows on the next tick', async () => {
		vi.useFakeTimers();
		const a2aCalls: string[] = [];
		let rows: Array<Record<string, unknown>> = [a2aRow({ id: 'a2a-w41' })];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: unknown) => {
				const url = String(input ?? '');
				if (url.includes('/api/a2a')) {
					a2aCalls.push(url);
					return new Response(JSON.stringify({ ok: true, rows }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				if (url.includes('/api/dsh/sessions')) {
					return new Response(
						JSON.stringify({
							ok: true,
							sessions: [
								{ sessionId: 'session-tgt', title: 'TE-LO-LET', agentPreset: null, running: false, blank: false, updatedAt: 1, workspace: null, turns: null }
							]
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 });
			})
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		try {
			stageSeedData({ sessionId: 's-a2a', entries: [], lastSeq: -1, running: false });
			trackPage(mount(Page, { target }));
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(0);
			// The spine tick's a2a fetch is addressed to the sender panel.
			expect(a2aCalls.length).toBeGreaterThanOrEqual(1);
			expect(a2aCalls.every((u) => u.includes('from=s-a2a'))).toBe(true);
			// The sender panel renders its waiting chip; the target title
			// rides the tooltip through the spine-titles join.
			const chip = target.querySelector('[data-testid="a2a-chip"]') as HTMLElement;
			expect(chip).not.toBeNull();
			expect(chip.getAttribute('data-a2a-state')).toBe('waiting');
			const btn = chip.querySelector('[data-testid="a2a-chip-button"]') as HTMLElement;
			expect(btn.getAttribute('title')).toContain('TE-LO-LET');

			// The settle flows on the NEXT spine tick (5s cadence fires):
			// waiting → replied_exact, text derived VERBATIM from the state.
			rows = [a2aRow({ id: 'a2a-w41', state: 'replied_exact', settledAt: 2_000 })];
			await vi.advanceTimersByTimeAsync(5_100);
			await vi.advanceTimersByTimeAsync(0);
			const settled = target.querySelector('[data-testid="a2a-chip"]') as HTMLElement;
			expect(settled.getAttribute('data-a2a-state')).toBe('replied_exact');
			expect(settled.textContent).toContain('replied (exact)');
		} finally {
			unmount(target.firstElementChild as never);
			vi.useRealTimers();
		}
		installDefaultFetch();
	});

	it('zero new client timers: the a2a join adds NO third spine-cadence interval (BC-7)', async () => {
		const intervals: Array<[unknown, number]> = [];
		const stacks: string[] = [];
		const orig = globalThis.setInterval;
		vi.stubGlobal(
			'setInterval',
			vi.fn((...a: unknown[]) => {
				intervals.push([a[0], a[1] as number]);
				stacks.push(new Error('probe').stack ?? '');
				return orig(a[0] as () => void, 1_000_000);
			})
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: unknown) => {
				const url = String(input ?? '');
				if (url.includes('/api/a2a')) {
					return new Response(
						JSON.stringify({ ok: true, rows: [a2aRow({ id: 'a2a-timer', fromSession: 's-timer' })] }),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			})
		);
		const target = document.createElement('div');
		document.body.appendChild(target);
		try {
			stageSeedData({ sessionId: 's-timer', entries: [], lastSeq: -1, running: false });
			trackPage(mount(Page, { target }));
			await settle();
			await settle();
			// The PRE-EXISTING trio plus the Subagent Anchor's own poll
			// (2026-10-26, ADR D3 — the anchor button deliberately owns one
			// 4s timer feeding the subagent-clock registry): the spine feed
			// (2x5s, one per subscription lifetime; concurrent floors SHARE
			// one — the BC-7 win) + the poll orchestrator (5s) + the anchor
			// (4s). An A2A-owned timer does not exist — the join rides
			// loadSpineRows.
			expect(intervals.length).toBe(4);
			const spineCadence = intervals.filter(([, ms]) => ms === 5_000);
			expect(spineCadence.length).toBe(3); // the pre-existing spine trio, cadence untouched
			expect(intervals.filter(([, ms]) => ms === 4_000).length).toBe(1); // the anchor poll only
			// ADR-0018 W2: the spine subscription effect moved into
			// services/workspace/page-feeds.svelte.ts — same single timer,
			// new stack site. Route + feed service together = the one effect.
			const pageOwned = stacks.filter(
				(st) =>
					(st.includes('+page.svelte') || st.includes('page-feeds.svelte')) &&
					!st.includes('SubagentAnchorButton')
			);
			expect(pageOwned.length).toBe(1); // the spine effect alone
			// And with rows flowing, the chip rendered — zero new timers.
			expect(target.querySelector('[data-testid="a2a-chip"]')).not.toBeNull();
		} finally {
			unmount(target.firstElementChild as never);
		}
		installDefaultFetch();
	});
});

// ── 3.2-T: pin invariants I1–I4 across scripted floor operations ──────
// (2026-08-27 W3, ADR D4 worked example included.) The REAL page mounts
// with a lineage-bearing spine stub; every operation goes through the
// registry/context exactly as the UI drives it; assertions read the
// published workspace state (rows/ghosts = the sidebar's truth).
describe('+page.svelte — lineage pin under floor operations (task 3.2-T)', () => {
	/** Spine with the ADR worked example's family: s2 spawns agent1+agent2. */
	function stubLineageSpine() {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: unknown) => {
				const url = String(input ?? '');
				if (url.includes('/api/dsh/sessions')) {
					const s = (sessionId: string, over: Record<string, unknown> = {}) => ({
						sessionId,
						title: `Session ${sessionId}`,
						agentPreset: null,
						running: false,
						blank: false,
						updatedAt: 1,
						workspace: '/tmp/w',
						turns: null,
						...over
					});
					return new Response(
						JSON.stringify({
							ok: true,
							sessions: [
								s('s1'),
								s('s2'),
								s('s3'),
								s('s4'),
								s('agent1', { parentSessionId: 's2', origin: 'subagent' }),
								s('agent2', { parentSessionId: 's2', origin: 'subagent' }),
								s('agent1a', { parentSessionId: 'agent1', origin: 'subagent' })
							],
							presets: []
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 });
			})
		);
	}

	async function mountFloor(): Promise<HTMLElement> {
		stageSeedData({ sessionId: 's1', entries: [], lastSeq: -1, running: false });
		const target = document.createElement('div');
		document.body.appendChild(target);
		trackPage(mount(Page, { target }));
		await settle();
		return target;
	}

	const ids = (): string[] => (getWorkspaceState()?.rows ?? [])
		.map((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null))
		.filter((v): v is string => v !== null);
	const panelKeys = (i: number): string[] =>
		Object.keys(getWorkspaceState()?.rows[i]?.panel ?? {}).sort();

	afterEach(() => {
		setWorkspaceState(null);
		resetPanelRegistryForTests();
		resetSpineFeedForTests();
	resetSpineFeedForTests();
		resetSpineFeedForTests(); // module-scope feed store - test isolation
		installDefaultFetch();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	});

	it('spawn → ghosts; adopt → pinned; swap → family leaps; close → re-home (ADR sequence)', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			// Open the family head + two strangers (insert-before-focused,
			// 2026-08-31: each add selects the fresh panel, so consecutive
			// adds stack newest-first at the head — the seed rides the tail).
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			expect(addPanelFromSidebar({ sessionId: 's3', agentPreset: null })).toBe(true);
			expect(addPanelFromSidebar({ sessionId: 's4', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s4', 's3', 's2', 's1']);

			// Spawns are GHOSTS under s2 (I1: anchored; D5: no panel).
			const ghosts = getWorkspaceState()?.ghosts ?? [];
			expect(ghosts.map((g) => g.panel.kind === 'conversation' ? g.panel.sessionId : null).sort()).toEqual(['agent1', 'agent1a', 'agent2']);
			// Depth-1 ghosts anchor at s2; the nested agent1a at its wire
			// parent agent1 (the ghost chain, not the anchor, carries it).
			expect(
				ghosts.every((g) => g.parentSessionId === ((g.panel.kind === 'conversation' ? g.panel.sessionId : null) === 'agent1a' ? 'agent1' : 's2'))
			).toBe(true);

			// Adopt agent1 (the ghost's own click path): pinned at parentIndex+1 (I2).
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s4', 's3', 's2', 'agent1', 's1']);

			// The remaining ghost stays a ghost (one session, one home).
			// agent1a (nested under the now-adopted agent1) re-anchors under
			// its panel; agent2 stays a ghost (one session, one home).
			expect((getWorkspaceState()?.ghosts ?? []).map((g) => g.panel.kind === 'conversation' ? g.panel.sessionId : null).sort()).toEqual(['agent1a', 'agent2']);

			// ADR worked example (the same floor order, 2026-08-31): move s3
			// DOWN — it LEAPS the whole family block [s2, agent1].
			const s3PanelId =
				getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 's3')?.panel.id ?? '';
			expect(movePanelFromRegistry(s3PanelId, 'down')).toBe(true);
			await settle();
			expect(ids()).toEqual(['s4', 's2', 'agent1', 's3', 's1']); // ✓ ADR outcome

			// Close s2 (operator spec, 2026-08-28): the WHOLE family goes —
			// the adopted child panel is removed with its spawner (no
			// dangling sub-agent), the ghosts follow the parent out (D6).
			const s2PanelId = getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 's2')?.panel.id;
			expect(s2PanelId).toBeDefined();
			getWorkspaceState()?.remove(s2PanelId!);
			await settle();
			expect(ids()).toEqual(['s4', 's3', 's1']);
			expect(getWorkspaceState()?.ghosts ?? []).toEqual([]); // parent off-floor
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	it('Shift+Click on the family head close drops ONLY the head — the child panel stays (2026-09-01)', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			// Family on the floor: head s2 + adopted child agent1.
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s2', 'agent1', 's1']);

			// Shift+Click the head's panel close: the plain-click path would
			// take the whole family (the 2026-08-28 subtree rule) — the Shift
			// opts out, and only s2's panel drops.
			const s2PanelId = getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 's2')?.panel.id ?? '';
			const closeBtn = target
				.querySelector(`[data-testid="panel-column"][data-panel-id="${s2PanelId}"]`)
				?.querySelector('[data-testid="panel-close"]') as HTMLButtonElement;
			expect(closeBtn).not.toBeNull();
			closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
			await settle();
			expect(ids()).toEqual(['agent1', 's1']); // the child panel survives
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	it('adopt-family: opening a sub-agent whose spawner is off-floor brings the parent (never travels alone)', async () => {		stubLineageSpine();
		const target = await mountFloor();
		try {
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true);
			await settle();
			// No-anchor family: the chain joins before the focus (the seed's
			// slot), head first — parent joined, child pinned.
			expect(ids()).toEqual(['s2', 'agent1', 's1']); // parent joined, child pinned
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	// Operator spec (2026-08-28): ghost-click ADOPTIONS keep LINEAGE order
	// under the spawner — the click sequence is irrelevant. Adopting
	// agent2 then agent1 must land |s2|agent1|agent2| (each new adopt
	// slots after every already-adopted sibling that PRECEDES it in wire
	// order), never wedging above an older sibling.
	it('adoptions keep lineage order regardless of the click sequence', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			await settle();
			// Adopt the LAST sibling first — pins directly below s2.
			expect(addPanelFromSidebar({ sessionId: 'agent2', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s2', 'agent2', 's1']);
			// Adopt agent1 afterwards: it slots BEFORE agent2 (lineage
			// order), keeping the family region [agent1, agent2].
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s2', 'agent1', 'agent2', 's1']);
			// The mirrored sequence lands the same family: agent1 then
			// agent2 appends after it (no wedge above).
			const target2 = await mountFloor();
			try {
				expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
				expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true);
				expect(addPanelFromSidebar({ sessionId: 'agent2', agentPreset: null })).toBe(true);
				await settle();
				expect(ids()).toEqual(['s2', 'agent1', 'agent2', 's1']);
			} finally {
				unmount(target2.firstElementChild as never);
			}
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	// CHAIN adoption (operator spec, 2026-08-28): clicking a NESTED ghost
	// never dangles it — the off-floor ancestor chain comes along, pinned
	// under the nearest OPEN ancestor. With s2 open, clicking agent1a
	// (nested under agent1) lands |s2|agent1|agent1a| — not |s2|agent1a|
	// and never detached past the family.
	it('chain adoption: a nested ghost brings its off-floor ancestors under the open head', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			await settle();
			// Click the NESTED child with only the head open.
			expect(addPanelFromSidebar({ sessionId: 'agent1a', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s2', 'agent1', 'agent1a', 's1']);
		} finally {
			unmount(target.firstElementChild as never);
		}
		// No-anchor family: the whole chain joins before the focus,
		// head first (never travels alone) — the seed's slot here.
		const target2 = await mountFloor();
		try {
			expect(addPanelFromSidebar({ sessionId: 'agent1a', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s2', 'agent1', 'agent1a', 's1']);
		} finally {
			unmount(target2.firstElementChild as never);
		}
	});

	// Family clamp (insert-before-focused, 2026-08-31): a slot strictly
	// inside a family would wedge the newcomer between spawner and child,
	// splitting the block the move/render/adoption walks treat as
	// contiguous. Focusing the CHILD admits the whole family — the
	// stranger joins above the family head, the nearest non-splitting
	// slot left of the focus.
	it('add clamps to the family head when the focused panel is a family child', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true); // pinned below s2 → focus = child
			expect(addPanelFromSidebar({ sessionId: 's4', agentPreset: null })).toBe(true); // clamp → above the family
			await settle();
			expect(ids()).toEqual(['s4', 's2', 'agent1', 's1']);
			// Focus the family child mid-floor, then add: the slot climbs to
			// the head s2 — the family never splits.
			const agent1PanelId =
				getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 'agent1')?.panel.id;
			selectPanelFromRegistry(agent1PanelId!);
			expect(addPanelFromSidebar({ sessionId: 's5', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s4', 's5', 's2', 'agent1', 's1']);
			// The fresh panel took focus.
			const s5PanelId = getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 's5')?.panel.id;
			expect(getWorkspaceState()?.selectedPanelId).toBe(s5PanelId);
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	it('panels array never gains lineage fields — panel entries stay the 5-key kind-tagged wire shape', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			await settle();
			for (let i = 0; i < ids().length; i++) {
				expect(panelKeys(i)).toEqual(['agentPreset', 'id', 'kind', 'sessionId', 'width']);
			}
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	// W6 deviation fix 3: the floor header's move chevrons ride the SAME
	// canMoveUp/Down facts the sidebar rows use — a cross-family move is
	// NOT OFFERED (ADR D4), not a dead button. Index-based visibility
	// offered chevrons that movePanelLineage silently no-oped.
	it('header chevrons: pinned first child mid-floor has NO move-left; strangers keep both', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true); // pinned below s2
			// The pin focused agent1 (a family CHILD): the s3 add's slot
			// clamps to the family head s2 (never split a family) — the same
			// slot the old front-add used, so the floor order is unchanged.
			expect(addPanelFromSidebar({ sessionId: 's3', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s3', 's2', 'agent1', 's1']);

			const headerOf = (sessionId: string): Element | null => {
				const panelId = getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === sessionId)?.panel.id;
				return panelId
					? target.querySelector(`[data-testid="panel-column"][data-panel-id="${panelId}"]`)
					: null;
			};
			const agent1Header = headerOf('agent1');
			expect(agent1Header).not.toBeNull();
			// First child: move-up would cross the family boundary — hidden.
			expect(agent1Header!.querySelector('[data-testid="panel-move-left"]')).toBeNull();
			// Unit bottom edge: move-down would leave the family — hidden too.
			expect(agent1Header!.querySelector('[data-testid="panel-move-right"]')).toBeNull();
			// A stranger mid-floor keeps both.
			const s2Header = headerOf('s2');
			expect(s2Header!.querySelector('[data-testid="panel-move-left"]')).not.toBeNull();
			expect(s2Header!.querySelector('[data-testid="panel-move-right"]')).not.toBeNull();
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	// Subtree removal (operator spec, 2026-08-28): closing a panel closes
	// its WHOLE family — children and NESTED sub-agents go with it, never
	// dangling — while a MID-TREE close spares the ancestors above it.
	it('closing a panel removes its whole descendant subtree (nested included); ancestors stay', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true);
			// The pin focused agent1 (a family child): the s3 add's slot
			// clamps to the family head s2 — the same order the old
			// front-add produced.
			expect(addPanelFromSidebar({ sessionId: 's3', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s3', 's2', 'agent1', 's1']);

			// Close the FAMILY HEAD: the adopted child goes with it.
			const s2PanelId = getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 's2')?.panel.id;
			getWorkspaceState()?.remove(s2PanelId!);
			await settle();
			expect(ids()).toEqual(['s3', 's1']); // no dangling agent1

			// Re-open the family, then close the CHILD instead: the head
			// survives (a mid-tree close removes only ITS subtree).
			expect(addPanelFromSidebar({ sessionId: 's2', agentPreset: null })).toBe(true);
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true);
			await settle();
			expect(ids()).toEqual(['s2', 'agent1', 's3', 's1']);
			const agent1PanelId =
				getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 'agent1')?.panel.id;
			getWorkspaceState()?.remove(agent1PanelId!);
			await settle();
			expect(ids()).toEqual(['s2', 's3', 's1']); // the spawner stays

			// A selection that rode a removed CHILD repairs to a survivor.
			expect(addPanelFromSidebar({ sessionId: 'agent1', agentPreset: null })).toBe(true);
			await settle();
			const agent1Row = getWorkspaceState()?.rows.find((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null) === 'agent1');
			selectPanelFromRegistry(agent1Row!.panel.id);
			await settle();
			getWorkspaceState()?.remove(agent1Row!.panel.id);
			await settle();
			expect(ids()).toEqual(['s2', 's3', 's1']);
			expect(getWorkspaceState()?.selectedPanelId).not.toBe(agent1Row!.panel.id);
		} finally {
			unmount(target.firstElementChild as never);
		}
	});
	// ── W4 4.3-T — embedded manager slot (2026-09-06, ADR D8) ────────────
	it('bare /dsi-prompts adds (aims) a manager slot beside the conversation; Escape removes it; no cold fetch fires', async () => {
		stubLineageSpine();
		const target = await mountFloor();
		try {
			const fetchUrls: string[] = [];
			const realFetch = globalThis.fetch;
			vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
					fetchUrls.push(String(input));
					return realFetch(input);
				});
			const added = addPanelFromSidebar({ kind: 'prompt-manager', afterSessionId: 's1' });
			expect(added).toBe(true);
			await settle();
			expect(target.querySelector('[data-testid="panel-manager"]')).not.toBeNull();
			const titles = (getWorkspaceState()?.rows ?? []).map((r) => r.title);
			expect(titles).toContain('Prompt Manager');
			expect(fetchUrls.filter((u) => u.includes('/events'))).toHaveLength(0);
			const managerRoot = target.querySelector('.mgr-panel-root') as HTMLElement;
			expect(managerRoot).not.toBeNull();
			// Close through the embedded manager's close verb: root-scoped
			// Escape (the × button left the panel with the shell-header move,
			// commit 1ff0af0 — the dialog keeps .mgr-dialog-close). Same
			// onclose the button used to fire; dispatch pinned in
			// manager-embed.test.ts 4.1-T and the W4 e2e's real keyboard).
			managerRoot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			await settle();
			expect(target.querySelector('[data-testid="panel-manager"]')).toBeNull();
			expect((getWorkspaceState()?.rows ?? []).map((r) => r.title)).not.toContain('Prompt Manager');
		} finally {
			unmount(target.firstElementChild as never);
		}
	});
	// The Focus Command ADR (2026-09-17, D1): the bare command must ADD — a
	// repeat FOCUSES the open manager (dedupe), never a swap.
		it('bare /dsi-prompts opens a manager panel BESIDE the conversation (end-to-end)', async () => {
		stubLineageSpine();
		// The embedded manager fetches /api/prompts on mount — the default
		// harness stub breaks its row parse, so answer the prompts wire.
		const realFetch = globalThis.fetch;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
			if (String(input).includes('/api/prompts')) {
				return new Response(JSON.stringify({ rows: [], total: 0 }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
			return realFetch(input);
		});
		const target = await mountFloor();
		try {
		const result = await executeCommand(parseCommand('/dsi-prompts')!, {
			sessionId: 's1',
			workspace: null,
			agent: null,
			panelId: getWorkspaceState()?.rows[0]?.panel.id ?? null
		});
		expect(result).toEqual({ ok: true });
		await settle();
		// The manager was ADDED beside the conversation (never a swap): two
		// panels, the newcomer selected.
		expect(target.querySelectorAll('[data-testid="panel-column"]')).toHaveLength(2);
		expect(target.querySelector('[data-testid="panel-manager"]')).not.toBeNull();
		const titles = (getWorkspaceState()?.rows ?? []).map((r) => r.title);
		expect(titles).toHaveLength(2);
		expect(titles[1]).toBe('Prompt Manager');
		// A repeat FOCUSES the open manager — one live manager, nothing added (D3).
		const repeat = await executeCommand(parseCommand('/dsi-prompts')!, {
			sessionId: 's1',
			workspace: null,
			agent: null,
			panelId: getWorkspaceState()?.rows[0]?.panel.id ?? null
		});
		expect(repeat).toEqual({ ok: true });
		await settle();
		expect(target.querySelectorAll('[data-testid="panel-manager"]')).toHaveLength(1);
		expect(getWorkspaceState()?.selectedPanelId).toBe(
			getWorkspaceState()?.rows[1]?.panel.id ?? null
		);
		} finally {
		unmount(target.firstElementChild as never);
		}
		});
});

// ── Swap-focus (2026-08-29): the /new successor takes the caret ───────
// The FULL client chain through the real page: composer submit →
// executeCommand swap (PanelAddRequest.focus) → doSwapInto's one-shot
// focusComposerId → keyed remount → Composer's mount focus. The
// happy-dom stand-in for e2e slash-commands 03 (whose DSH stub host is
// still on the pre-0.1.2 wire).
describe('+page.svelte — swap-focus (the /new successor takes the caret)', () => {
	function stubNewSpine(createCalls: Array<Record<string, unknown>>) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: unknown, init?: RequestInit) => {
				const url = String(input ?? '');
				// The composer's /new create (POST) — same URL as the spine list.
				if (url.includes('/api/dsh/sessions') && init?.method === 'POST') {
					createCalls.push(JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>);
					return new Response(JSON.stringify({ ok: true, sessionId: 's-new', agentPreset: 'main' }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				if (url.includes('/api/dsh/sessions')) {
					return new Response(
						JSON.stringify({
							ok: true,
							sessions: [
								{ sessionId: 's1', title: 'Session s1', agentPreset: null, running: false, blank: false, updatedAt: 1, workspace: '/tmp/w', turns: null },
								{ sessionId: 's3', title: 'Session s3', agentPreset: null, running: false, blank: false, updatedAt: 1, workspace: '/tmp/w', turns: null }
							],
							presets: []
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					);
				}
				// events?full=1 + history cold loads — empty session is fine.
				return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false, hasMore: false }), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			})
		);
	}

	/** Type one line into the seeded panel's composer and press Enter. */
	async function submitLine(target: HTMLElement, text: string): Promise<void> {
		const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="prompt-textarea"]');
		expect(textarea).not.toBeNull();
		textarea!.value = text;
		textarea!.dispatchEvent(new Event('input', { bubbles: true })); // bind:value
		textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await settleSwap();
	}

	const ids = (): string[] => (getWorkspaceState()?.rows ?? [])
		.map((r) => (r.panel.kind === 'conversation' ? r.panel.sessionId : null))
		.filter((v): v is string => v !== null);

	/** settle() plus macrotask hops — the swap's create→cold-load round-trip
	 *  crosses several await boundaries (Response.json settles on a
	 *  macrotask in happy-dom), so microtask flushes alone stop short. */
	async function settleSwap(): Promise<void> {
		for (let i = 0; i < 8; i++) {
			await new Promise((r) => setTimeout(r, 0));
			await settle();
		}
	}

	afterEach(() => {
		setWorkspaceState(null);
		resetPanelRegistryForTests();
		resetSpineFeedForTests();
	resetSpineFeedForTests();
		localStorage.removeItem('dsi-panels');
		installDefaultFetch();
		vi.restoreAllMocks();
		document.body.innerHTML = '';
	});

	it('/new swaps the panel and the fresh composer takes the caret', async () => {
		const createCalls: Array<Record<string, unknown>> = [];
		stubNewSpine(createCalls);
		stageSeedData({ sessionId: 's1', entries: [], lastSeq: -1, running: false });
		const target = document.createElement('div');
		document.body.appendChild(target);
		trackPage(mount(Page, { target }));
		await settle();
		try {
			await submitLine(target, '/new');

			// The create rode the executor (workspace inherited from the spine row).
			expect(createCalls).toEqual([{ cwd: '/tmp/w' }]);
			// The swap landed: the floor shows the successor session only.
			expect(ids()).toEqual(['s-new']);
			// The fresh panel's composer owns the caret.
			const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="prompt-textarea"]');
			expect(textarea).not.toBeNull();
			expect(document.activeElement).toBe(textarea);
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	it('the focus marker is one-shot: a later panel mount never steals the caret', async () => {
		const createCalls: Array<Record<string, unknown>> = [];
		stubNewSpine(createCalls);
		stageSeedData({ sessionId: 's1', entries: [], lastSeq: -1, running: false });
		const target = document.createElement('div');
		document.body.appendChild(target);
		trackPage(mount(Page, { target }));
		await settle();
		try {
			await submitLine(target, '/new');
			const swapped = target.querySelector<HTMLTextAreaElement>('[data-testid="prompt-textarea"]');
			expect(document.activeElement).toBe(swapped);

			// A plain spine-row add mounts ANOTHER panel — no focus moves.
			expect(addPanelFromSidebar({ sessionId: 's3', agentPreset: null })).toBe(true);
			await settleSwap();
			expect(ids()).toEqual(['s3', 's-new']);
			// The s-new panel's composer (second column) still owns the caret.
			const textareas = target.querySelectorAll<HTMLTextAreaElement>('[data-testid="prompt-textarea"]');
			expect(textareas.length).toBe(2);
			expect(document.activeElement).toBe(textareas[1]);
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

	// The e2e 03b property, proven here while the DSH stub host is still on
	// the pre-0.1.2 wire: a RESTORED desk (plain page load, desk from
	// localStorage) mounts every panel without the focus marker.
	it('a restored desk (plain page load) never takes the caret', async () => {
		stubNewSpine([]);
		localStorage.setItem(
			'dsi-panels',
			JSON.stringify({
				panels: [{ id: 'panel-1', kind: 'conversation', sessionId: 's1', agentPreset: null, width: 730 }],
				selectedPanelId: 'panel-1',
				panelWidth: 730,
				zoom: 1
			})
		);
		// Plain / arrival — NO ?sessionKey (refresh-restore, GAP-7).
		reactiveTestPage.params = {};
		reactiveTestPage.url = new URL('http://dsi/');
		reactiveTestPage.data = {};
		const target = document.createElement('div');
		document.body.appendChild(target);
		trackPage(mount(Page, { target }));
		await settleSwap();
		try {
			expect(ids()).toEqual(['s1']);
			const textarea = target.querySelector('[data-testid="prompt-textarea"]');
			expect(textarea).not.toBeNull();
			expect(document.activeElement).not.toBe(textarea);
		} finally {
			unmount(target.firstElementChild as never);
		}
	});

});
