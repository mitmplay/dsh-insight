/**
 * macro-typed-run tests (The Typed Run spec 2026-09-16 — 1.1-T, 1.2-T,
 * 1.3-T): the D1 typed-run predicate table, the D2 slashBoundaries flag
 * on the pure compiler (typed granularity + shelf byte-identity), and
 * the D5 synthetic row (TYPED_DRAFT_ID) through the real runner seam.
 *
 * All fetches are fakes (macro-runner.test.ts harness pattern); no route
 * truth beyond the executor contract.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';
import { compileRow, isTypedRun } from '$lib/services/chat/macro-sections';
import {
	TYPED_DRAFT_ID,
	macroRunner,
	macroRunState
} from '$lib/services/chat/macro-runner.svelte';
import { resetAppConfigForTests } from '$lib/services/config/app-config.svelte';

afterEach(() => {
	macroRunner.resetForTests();
	resetAppConfigForTests();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

// ── 1.1-T — the D1 predicate table ─────────────────────────────────────

describe('isTypedRun (D1)', () => {
	const TABLE: Array<{ name: string; text: string; want: boolean }> = [
		{ name: 'two slash lines', text: '/dsi-spec based on recent ADR\n/dsi-task execute it', want: true },
		{
			name: 'directive trio slash mention query',
			text: '/new\n@session-11111111-0000-4000-8000-000000000001 hello\n?q shelf',
			want: true
		},
		{ name: 'prose paragraph', text: 'please look at this\nand tell me why', want: false },
		{ name: 'mixed prose plus slash', text: 'first run this\n/dsi-task execute it', want: false },
		{ name: 'mixed slash plus prose', text: '/dsi-spec it\nthen explain', want: false },
		{ name: 'single slash line', text: '/new', want: false },
		{ name: 'single prose line', text: 'hello', want: false },
		{ name: 'blank only', text: '\n\n', want: false },
		{ name: 'empty', text: '', want: false },
		{ name: 'blank-separated directives', text: '/new\n\n?q shelf', want: true },
		{ name: 'CRLF tolerated', text: '/new\r\n?q shelf', want: true },
		{ name: 'indented directive still directive', text: '  /new\n  ?q', want: true }
	];
	for (const t of TABLE) {
		it(t.name, () => {
			expect(isTypedRun(t.text)).toBe(t.want);
		});
	}
});

// ── 1.2-T — the D2 slashBoundaries flag on the pure compiler ──────────

describe('compileRow slashBoundaries (D2)', () => {
	const DRAFT = '/dsi-spec based on recent ADR\n/dsi-task execute it';

	it('motivating draft WITHOUT the flag: one send-block holding both lines (today)', () => {
		const sections = compileRow(DRAFT);
		expect(sections.length).toBe(1);
		expect(sections[0].kind).toBe('send-block');
		expect(sections[0].sendText).toBe(DRAFT);
		expect(sections[0].lineCount).toBe(2);
	});

	it('motivating draft WITH the flag: two one-line send-blocks', () => {
		const sections = compileRow(DRAFT, { slashBoundaries: true });
		expect(sections.length).toBe(2);
		expect(sections.map((s) => s.kind)).toEqual(['send-block', 'send-block']);
		expect(sections[0].sendText).toBe('/dsi-spec based on recent ADR');
		expect(sections[1].sendText).toBe('/dsi-task execute it');
		expect(sections.every((s) => s.lineCount === 1)).toBe(true);
	});

	it('known command under the flag still compiles to command (both modes equal)', () => {
		const text = '/new\n?q shelf';
		expect(compileRow(text)).toEqual(compileRow(text, { slashBoundaries: true }));
		expect(compileRow(text, { slashBoundaries: true })[0].kind).toBe('command');
	});

	it('@channel hi (not a mention) stays literal in BOTH modes — only / gains a boundary (D2 letter)', () => {
		const text = '@channel hi\n@channel again';
		expect(compileRow(text)).toEqual(compileRow(text, { slashBoundaries: true }));
		expect(compileRow(text, { slashBoundaries: true }).length).toBe(1);
		expect(compileRow(text, { slashBoundaries: true })[0].lineCount).toBe(2);
	});

	it('a flagged unknown slash line closes an open prose block', () => {
		const sections = compileRow('dear friend\nplease read\n/dsi-task go', {
			slashBoundaries: true
		});
		expect(sections.length).toBe(2);
		expect(sections[0].kind).toBe('send-block');
		expect(sections[0].sendText).toBe('dear friend\nplease read');
		expect(sections[1].sendText).toBe('/dsi-task go');
	});

	it('a flagged unknown slash line closes a mention message', () => {
		const uuid = '11111111-0000-4000-8000-000000000001';
		const sections = compileRow('@session-' + uuid + ' one line\n/dsi-task go', {
			slashBoundaries: true
		});
		expect(sections.length).toBe(2);
		expect(sections[0].kind).toBe('mention-block');
		expect(sections[0].sendText).toBe('one line');
	});

	it('query and mention grammar identical in both modes when no unknown slash exists', () => {
		const uuid = '11111111-0000-4000-8000-000000000002';
		const rows = [
			'? shelf key\nsome prose\nmore prose',
			'@session-' + uuid + ' hello there\nplain tail',
			'/permission strict\nfinal words'
		];
		for (const row of rows) {
			expect(compileRow(row)).toEqual(compileRow(row, { slashBoundaries: true }));
		}
	});

	it('blank-padded prose block identical in both modes', () => {
		const row = '\npara one\n\npara two\n';
		expect(compileRow(row)).toEqual(compileRow(row, { slashBoundaries: true }));
	});

	it('DEFAULT output snapshot-stable against today for the pinned shapes', () => {
		expect(compileRow('line a\nline b')).toEqual([
			{ kind: 'send-block', display: 'line a', sendText: 'line a\nline b', lineCount: 2 }
		]);
		expect(compileRow('/permission strict')).toEqual([
			{ kind: 'command', display: '/permission strict', sendText: '/permission strict', lineCount: 1 }
		]);
		expect(compileRow('? key')).toEqual([
			{ kind: 'query', display: '? key', sendText: '? key', lineCount: 1 }
		]);
	});
});

// ── 1.3-T — the D5 synthetic row through the real runner seam ─────────

const CTX = {
	sessionId: 'session-11111111-0000-4000-8000-000000000001',
	workspace: '/w/proj',
	agent: 'main',
	panelId: 'p1'
} as const;

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('TYPED_DRAFT_ID synthetic row (D5)', () => {
	it('start accepts the synthetic id and feeds one send per line via the executor', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : (input as URL).href;
				calls.push(url);
				return jsonRes({ ok: true });
			})
		);
		macroRunner.resetForTests();
		const draft = '/dsi-spec based on recent ADR\n/dsi-task execute it';
		const state = macroRunner.start({ text: draft, id: TYPED_DRAFT_ID }, { ...CTX });
		expect(state.phase).not.toBe('failed');
		// Receipts-only: both sections fed, exactly TWO prompt POSTs — the
		// synthetic row never touched the shelf (/api/prompts).
		await vi.waitFor(() => {
			expect(macroRunState().phase).toBe('fed');
		});
		expect(calls.filter((u) => u.includes('/prompt')).length).toBe(2);
		expect(calls.filter((u) => u.startsWith('/api/prompts')).length).toBe(0);
		expect(macroRunState().lines.length).toBe(2);
		expect(macroRunState().lines.every((l) => l.kind === 'send')).toBe(true);
	});

	it('run-again re-runs the draft text with no shelf fetch', async () => {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : (input as URL).href;
				calls.push(url);
				return jsonRes({ ok: true });
			})
		);
		macroRunner.resetForTests();
		const draft = '/dsi-spec a\n/dsi-task b';
		macroRunner.start({ text: draft, id: TYPED_DRAFT_ID }, { ...CTX });
		await vi.waitFor(() => {
			expect(macroRunState().phase).toBe('fed');
		});
		calls.length = 0;
		macroRunner.runAgain({ baselineTurns: 0 });
		await vi.waitFor(() => {
			expect(macroRunState().phase).toBe('fed');
		});
		expect(calls.filter((u) => u.startsWith('/api/prompts')).length).toBe(0);
		expect(calls.filter((u) => u.includes('/prompt')).length).toBe(2);
	});
});

// ── 2.1-T — panel routing: the predicate routes BEFORE parseCommand ───

const PANEL_SESSION = 'session-11111111-0000-4000-8000-000000000001';

/** Panel fetch: quiet events poll, prompt POSTs recorded. `gate` (when
 *  given) holds the FIRST prompt POST open so a run stays live. */
function stubPanelFetch(gate?: { resolve: () => void; pending: Promise<void> }) {
	const calls: string[] = [];
	let heldFirst = false;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : (input as URL).href;
			const method = init?.method ?? 'GET';
			if (/\/api\/dsh\/session\/[^/]+\/prompt$/.test(url) && method === 'POST') {
				calls.push(url);
				if (gate && !heldFirst) {
					heldFirst = true;
					await gate.pending;
				}
				return jsonRes({ ok: true });
			}
			// events poll + everything else: quiet
			return jsonRes({ ok: true, entries: [], lastSeq: -1, running: false });
		})
	);
	return calls;
}

async function settle(times = 8): Promise<void> {
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
			sessionId: PANEL_SESSION,
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

async function typeAndEnter(target: HTMLElement, text: string): Promise<void> {
	const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	ta.value = text;
	ta.selectionStart = ta.selectionEnd = text.length;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	await settle();
}

describe('panel routing — predicate BEFORE parseCommand (D3/D4)', () => {
	it('a two-slash draft + Enter starts the runner with the draft as the synthetic row', async () => {
		stubPanelFetch();
		const { target, instance } = await mountPanel({ panelId: 'p-t1' });
		await typeAndEnter(target, '/dsi-spec based on recent ADR\n/dsi-task execute it');
		await vi.waitFor(() => {
			expect(macroRunState().phase).toBe('fed');
		});
		expect(macroRunState().total).toBe(2);
		expect(macroRunState().lines.every((l) => l.kind === 'send')).toBe(true);
		expect(macroRunState().lines.map((l) => l.display)).toEqual([
			'/dsi-spec based on recent ADR',
			'/dsi-task execute it'
		]);
		unmount(instance);
	});

	it('a prose draft + Enter NEVER starts the runner — one plain send as today', async () => {
		const calls = stubPanelFetch();
		const { target, instance } = await mountPanel({ panelId: 'p-t2' });
		await typeAndEnter(target, 'please look at this\nand tell me why');
		await settle();
		expect(macroRunState().phase).toBe('idle');
		expect(calls.filter((u) => u.includes('/prompt')).length).toBe(1); // ONE bubble
		unmount(instance);
	});

	it('a mixed prose+slash draft + Enter stays ONE whole-draft send (D1 rejection 2)', async () => {
		const calls = stubPanelFetch();
		const { target, instance } = await mountPanel({ panelId: 'p-t3' });
		await typeAndEnter(target, 'first run this\n/dsi-task execute it');
		await settle();
		expect(macroRunState().phase).toBe('idle');
		expect(calls.filter((u) => u.includes('/prompt')).length).toBe(1);
		unmount(instance);
	});

	it('a second Enter during a live run banners the refusal note (D4) — never queues', async () => {
		let release: () => void = () => {};
		const gate = {
			pending: new Promise<void>((r) => {
				release = r;
			}),
			resolve: () => release()
		};
		stubPanelFetch(gate);
		const { target, instance } = await mountPanel({ panelId: 'p-t4' });
		await typeAndEnter(target, '/dsi-spec based on recent ADR\n/dsi-task execute it');
		await vi.waitFor(() => {
			expect(macroRunState().phase).toBe('feeding');
		});
		await typeAndEnter(target, '/dsi-spec again\n/dsi-task more');
		const note = target.querySelector('[data-testid="command-note"]');
		expect(note).not.toBeNull();
		expect(note?.textContent ?? '').toContain('a macro is already running');
		expect(macroRunState().total).toBe(2); // the live run was NOT replaced
		gate.resolve();
		await vi.waitFor(() => {
			expect(macroRunState().phase).toBe('fed');
		});
		unmount(instance);
	});
});
