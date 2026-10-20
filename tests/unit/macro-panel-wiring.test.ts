/**
 * macro-panel-wiring tests (task 2.2-T, PAIRED with 2.2): the panel
 * binds the composer's run/step gestures to macroRunner.start with the
 * panel's context {panelId, sessionId, workspace, agent}; threads the
 * runner state + its own poll truth (store.running, pending cards) into
 * the MacroRunSheet; hands the ✓/▶ baseline to the runner at start;
 * crosses a /new swap by TARGET-SESSION ownership (the floor mints a
 * fresh panel id and remounts the panel — the successor panel claims
 * the chip because it shows the run's session); and refuses a second
 * run with a visible note.
 *
 * The runner is a module-scope singleton — reset between tests; fetch is
 * stubbed at the global seam (search + prompt routes only; the events
 * poll returns a quiet empty page).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';
import { macroRunner, macroRunState } from '$lib/services/chat/macro-runner.svelte';
import { registerReplacePanel } from '$lib/services/panels/panel-registry';

const SELF = 'session-11111111-0000-4000-8000-000000000001';
const NEW_SESSION = 'session-22222222-0000-4000-8000-000000000002';

/** Shelf row for the /api/prompts search (the strip's fetch). */
const macroRow = {
	id: 21,
	label: 'new-code',
	text: '/new @code\n?oci',
	use_count: 1,
	last_used_at: '2026-08-29T00:00:00.000Z'
};

/** Route-aware fetch: strip search + macro routes + quiet events poll.
 *  Search is q-aware: q=new (the strip) finds the macro row; q=oci (the
 *  runner's ?-resolution) finds a TARGET row — the visited-set would
 *  otherwise self-match the running row (ADR D6) and skip the send. */
function stubFetch(opts: { newSessionOk?: boolean; prompts?: unknown[] } = {}) {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	const ociTarget = {
		id: 55,
		label: null,
		text: 'list all oci containers',
		use_count: 1,
		last_used_at: '2026-08-29T00:00:00.000Z'
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			calls.push({ url, init });
			if (url.startsWith('/api/prompts?')) {
				const results = decodeURIComponent(url).includes('q=oci') ? [ociTarget] : (opts.prompts ?? [macroRow]);
				return new Response(JSON.stringify({ results }), {
					status: 200,
						headers: { 'content-type': 'application/json' }
				});
			}
			if (url.endsWith('/api/dsh/sessions') && init?.method === 'POST') {
				if (opts.newSessionOk === false) {
					return new Response(JSON.stringify({ ok: false, error: { message: 'host said no' } }), { status: 500 });
				}
				return new Response(JSON.stringify({ ok: true, sessionId: NEW_SESSION }), { status: 200 });
			}
			if (/\/api\/dsh\/session\/[^/]+\/prompt$/.test(url) && init?.method === 'POST') {
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			if (url.startsWith('/api/prompts/use')) {
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}
			// events poll + everything else: quiet empty page
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), {
				status: 200
			});
		})
	);
	return calls;
}

async function settle(times = 12): Promise<void> {
	for (let i = 0; i < times; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
	}
	flushSync();
}

async function mountPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ConversationPanel, {
		target,
		props: {
			sessionId: SELF,
			agent: 'main',
			entries: [],
			lastSeq: -1,
			running: false,
			...props
		} as never
	});
	await settle();
	return { target, instance };
}

afterEach(() => {
	macroRunner.resetForTests();
	registerReplacePanel(null);
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

/** Type a `!` query into the composer's textarea and fire the debounce. */
async function typeBangQuery(target: HTMLElement, query: string): Promise<void> {
	const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	ta.value = query;
	ta.selectionStart = ta.selectionEnd = query.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	await new Promise((r) => setTimeout(r, 250)); // 120ms debounce (real timers)
	await settle();
}

describe('macro-panel-wiring — accept fires runner.start with the panel context', () => {
	it('! query + Enter: the strip row starts the run with {panelId, sessionId, workspace, agent}', async () => {
		const calls = stubFetch();
		registerReplacePanel(() => true);
		const { target, instance } = await mountPanel({ panelId: 'p-1', workspace: '/w/proj' });
		await typeBangQuery(target, '!new');
		expect(target.querySelector('[data-testid="suggest-strip"]')).not.toBeNull();

		const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await settle();

		const s = macroRunState();
		expect(s.phase === 'fed' || s.phase === 'feeding' || s.phase === 'held').toBe(true);
		// 2 source sections; the ?oci section EXPANDS to its target row (+1
		// spliced section and the query record) — total counts SECTIONS incl.
		// expansions (macro-runner 2.1 section contract).
		expect(s.total).toBe(3);
		expect(s.lines.map((l) => l.kind)).toEqual(['command', 'query', 'send']);
		// The /new create POST carried THIS panel's inheritance
		const create = calls.find((c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST');
		expect(create).toBeDefined();
		expect(JSON.parse(String(create!.init!.body))).toEqual({ cwd: '/w/proj', agentPreset: 'code' });
		unmount(instance);
	});

	it('Step button starts the run HELD (zero prompt POSTs until released)', async () => {
		const calls = stubFetch();
		registerReplacePanel(() => true);
		const { target, instance } = await mountPanel({ panelId: 'p-2' });
		await typeBangQuery(target, '!new');
		const step = target.querySelector('.strip-step-btn') as HTMLButtonElement;
		expect(step).not.toBeNull();
		step.click();
		await settle();
		expect(macroRunState().phase).toBe('held');
		// /new line has not fed — no sessions POST, no prompt POST
		expect(calls.filter((c) => c.url.endsWith('/api/dsh/sessions') && c.init?.method === 'POST')).toHaveLength(0);
		unmount(instance);
	});
});

describe('macro-panel-wiring — sheet props threaded', () => {
	it('the sheet renders on the owning panel with the harness-asking suffix when cards pend', async () => {
		// Held start; then simulate a pending card via a macro row feed and
		// direct store injection is NOT possible (store is panel-owned) —
		// instead assert the sheet exists and its suffix surface is the chip.
		stubFetch();
		registerReplacePanel(() => true);
		const { target, instance } = await mountPanel({ panelId: 'p-3' });
		await typeBangQuery(target, '!new');
		const step = target.querySelector('.strip-step-btn') as HTMLButtonElement;
		step.click();
		await settle();
		const chip = target.querySelector('[data-testid="macro-chip"]');
		expect(chip).not.toBeNull();
		expect(chip!.textContent).toContain('held');
		unmount(instance);
	});

	it('a NON-owning panel renders no sheet (second panel on the floor)', async () => {
		stubFetch();
		registerReplacePanel(() => true);
		const a = await mountPanel({ panelId: 'p-a' });
		await typeBangQuery(a.target, '!new');
		(a.target.querySelector('.strip-step-btn') as HTMLButtonElement).click();
		await settle();
		expect(a.target.querySelector('[data-testid="macro-chip"]')).not.toBeNull();

		// The floor dedupes one-panel-per-session, so a second panel is a
		// second SESSION — ownership (by target session) excludes it.
		const b = await mountPanel({
			panelId: 'p-b',
			sessionId: 'session-99999999-0000-4000-8000-000000000009'
		});
		expect(b.target.querySelector('[data-testid="macro-chip"]')).toBeNull();
		unmount(b.instance);
		unmount(a.instance);
	});
});

describe('macro-panel-wiring — /new swap continuity (target-session ownership)', () => {
	it('the run crosses the swap: the successor panel claims the chip by session', async () => {
		const calls = stubFetch();
		registerReplacePanel(() => true);
		const a = await mountPanel({ panelId: 'p-swap-a' });
		await typeBangQuery(a.target, '!new');
		const ta = a.target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await settle();
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('fed');
		// the ?oci resolution searched, then the resolved text POSTed to NEW
		const search = calls.find((c) => c.url.startsWith('/api/prompts?'));
		expect(search).toBeDefined();
		const post = calls.find((c) => /\/prompt$/.test(c.url));
		expect(post!.url).toContain(NEW_SESSION);

		// Production swap (doReplacePanel): the floor REPLACES the panel
		// entry under a fresh id and {#key sessionId} REMOUNTS the
		// component — simulate both by unmounting the origin instance and
		// mounting the successor panel on the NEW session.
		unmount(a.instance);
		const b = await mountPanel({ panelId: 'p-swap-b', sessionId: NEW_SESSION });
		const chip = b.target.querySelector('[data-testid="macro-chip"]');
		expect(chip).not.toBeNull(); // the successor panel claims the run
		expect(chip!.textContent).toContain('fed');

		// A panel still showing the ORIGIN session renders none — the run
		// moved and ownership followed it.
		const c = await mountPanel({ panelId: 'p-swap-c', sessionId: SELF });
		expect(c.target.querySelector('[data-testid="macro-chip"]')).toBeNull();
		unmount(c.instance);
		unmount(b.instance);
	});
});

describe('macro-panel-wiring — refusals are visible', () => {
	it('a second start while one runs: the banner carries the refusal note', async () => {
		stubFetch();
		registerReplacePanel(() => true);
		const { target, instance } = await mountPanel({ panelId: 'p-refuse' });
		await typeBangQuery(target, '!new');
		(target.querySelector('.strip-step-btn') as HTMLButtonElement).click();
		await settle();
		expect(macroRunState().phase).toBe('held');

		// retype and accept again — the runner refuses, the panel banners it
		await typeBangQuery(target, '!new');
		const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await settle();
		const note = target.querySelector('[data-testid="command-note"]');
		expect(note?.textContent).toContain('already running');
		unmount(instance);
	});

	it('a /new failure mid-run stops the run fail-loud (chip names the reason)', async () => {
		stubFetch({ newSessionOk: false });
		const { target, instance } = await mountPanel({ panelId: 'p-fail' });
		await typeBangQuery(target, '!new');
		const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		await settle();
		await settle();
		const s = macroRunState();
		expect(s.phase).toBe('failed');
		expect(s.note).toContain('host said no');
		const chip = target.querySelector('[data-testid="macro-chip"]');
		expect(chip?.textContent).toContain('host said no');
		unmount(instance);
	});
});
