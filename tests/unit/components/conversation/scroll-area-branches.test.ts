/**
 * ConversationScrollArea — branch coverage beyond the main suite
 * (conversation-scroll-area.test.ts pins the core rendering + scroll
 * behaviors; this file pins the arms that suite never drives):
 *
 *  - sub-agent panels: the depth-graded beige tint and the suppressed
 *    fork anchor (sub-agent transcripts stay read-only)
 *  - the system-prompt group (hoisted row renders its own bubble + chip)
 *  - context-kind groups (standalone injection rows)
 *  - the chip-name resolver: every meta kind and the nameless/garbage
 *    source arms, plus the sub-agent open affordance (report + settled
 *    senders open a panel; junk kinds and junk senders afford nothing)
 *  - answerer body coercion: junk approval bodies fall back honestly in
 *    pending AND settled sections; questions answer with the session id
 *  - the outside-in stick mirror: flipping the prop jumps to the bottom
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationScrollArea from '$lib/components/conversation/panel/ConversationScrollArea.svelte';
import { groupTurns } from '$lib/utils/turn-grouping';
import { registerAddPanel, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import type { DsiEntry } from '$lib/types';
import type { AnswerView } from '$lib/services/conversation/store.svelte';
import StickAreaHost from '../../../fixtures/StickAreaHost.svelte';

const T = 1_700_000_000_000;

const prompt = (id: string, text: string): DsiEntry => ({
	kind: 'user-message',
	id,
	seq: 1,
	time: T,
	text
});

const assistant = (id: string, text: string): DsiEntry => ({
	kind: 'assistant-message',
	id,
	seq: 2,
	time: T,
	text,
	streaming: false
});

const injection = (
	id: string,
	meta: NonNullable<Extract<DsiEntry, { kind: 'user-message' }>['meta']>,
	metaSource: Record<string, unknown> = {}
): DsiEntry => ({
	kind: 'user-message',
	id,
	seq: 3,
	time: T,
	text: 'injected context',
	meta,
	metaSource
});

const systemPrompt = (id: string, seq: number): DsiEntry => ({
	kind: 'system-prompt',
	id,
	seq,
	time: T,
	text: 'You are a coding agent.'
});

type MountOpts = { subagent?: boolean; depth?: number };

function mountArea(entries: DsiEntry[], opts: MountOpts = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const ontogglechip = vi.fn();
	const onanswer = vi.fn();
	const instance = mount(ConversationScrollArea, {
		target,
		props: {
			entries,
			groups: groupTurns(entries),
			hasMore: undefined,
			loadingOlder: false,
			olderError: null,
			onloadolder: () => {},
			openChipId: null,
			ontogglechip,
			peekOpenRunKey: null,
			ontogglepeek: () => {},
			pendingCards: [],
			settledCards: [],
			onanswer,
			sessionId: 'sess-x',
			subagent: opts.subagent ?? false,
			depth: opts.depth ?? 0
		}
	});
	flushSync();
	return { target, ontogglechip, onanswer, instance };
}

function mountStickHost() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(StickAreaHost, { target });
	flushSync(); // bind:viewport propagates on the first flush
	const host = instance as unknown as {
		setEntries: (e: DsiEntry[]) => void;
		setStick: (v: boolean) => void;
		stickValue: () => boolean;
		viewportEl: () => HTMLElement | undefined;
	};
	return { target, host, instance };
}

/** Fake geometry: 100px per rendered group, 50px viewport. */
function fakeGeometry(viewport: HTMLElement): void {
	Object.defineProperty(viewport, 'scrollHeight', {
		configurable: true,
		get: () => Math.max(1, viewport.querySelectorAll('[data-group-key]').length) * 100
	});
	Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => 50 });
}

function settle(rounds = 6): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
	}
	return Promise.resolve();
}

afterEach(() => {
	document.body.innerHTML = '';
	resetPanelRegistryForTests();
});

describe('ConversationScrollArea — sub-agent panels', () => {
	it('depth grades the tint (depth 2 → the middle beige)', async () => {
		const { target, instance } = mountArea([assistant('a1', 'child work')], { subagent: true, depth: 2 });
		await settle();
		const main = target.querySelector('[data-testid="transcript"]') as HTMLElement;
		expect(main.className).toContain('bg-[var(--color-subagent-tint-2)]');
		unmount(instance);
	});

	it('a non-sub-agent panel renders untinted', async () => {
		const { target, instance } = mountArea([assistant('a1', 'root work')]);
		await settle();
		const main = target.querySelector('[data-testid="transcript"]') as HTMLElement;
		expect(main.className).not.toContain('bg-[#');
		unmount(instance);
	});
});

describe('ConversationScrollArea — system-prompt groups', () => {
	it('a system-prompt row renders its chip inside a context-tone bubble; toggling reports it', async () => {
		const { target, ontogglechip, instance } = mountArea([systemPrompt('sp1', 1), prompt('u1', 'hi')]);
		await settle();
		const chip = target.querySelector('[data-testid="system-prompt-chip"]');
		expect(chip).not.toBeNull();
		(target.querySelector('[data-testid="system-prompt-toggle"]') as HTMLElement).click();
		expect(ontogglechip).toHaveBeenCalledWith('sp1');
		unmount(instance);
	});
});

describe('ConversationScrollArea — context-kind groups', () => {
	it('a standalone injection at session OPEN renders its own context group (no prompt text)', async () => {
		// The Turn Kept Whole D1: an injection after a turn JOINS that turn;
		// the standalone context shape survives only with no turn or prompt
		// behind it (session open, D4).
		const { target, instance } = mountArea([
			injection('u2', 'runtime-context'),
			prompt('u1', 'hi'),
			assistant('a1', 'answer')
		]);
		await settle();
		const group = target.querySelector('[data-group-key="u2"]');
		expect(group).not.toBeNull();
		expect(group?.querySelector('[data-testid="context-injection-chip"]')).not.toBeNull();
		// A context group renders no prompt text — only the chip row.
		expect(group?.querySelector('[data-testid="message-bubble"]')?.textContent).not.toContain(
			'injected context'
		);
		unmount(instance);
	});

	it('an injection after a turn renders INSIDE the turn bubble (D1), not as its own group', async () => {
		const { target, instance } = mountArea([
			prompt('u1', 'hi'),
			assistant('a1', 'answer'),
			injection('u2', 'runtime-context')
		]);
		await settle();
		expect(target.querySelector('[data-group-key="u2"]')).toBeNull();
		const turn = target.querySelector('[data-group-key="a1"]');
		expect(turn?.querySelector('[data-testid="context-injection-chip"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('ConversationScrollArea — the chip-name resolver', () => {
	it.each([
		['skill-invocation', { name: 'deploy' }, 'deploy'],
		['recall', { references: [{ label: 'session-title' }] }, 'session-title'],
		['plugin', { plugin: 'web' }, 'web']
	])('%s with a readable source shows its name', async (meta, source, expected) => {
		const { target, instance } = mountArea([prompt('u1', 'go'), injection('u2', meta as never, source)]);
		await settle();
		const chip = target.querySelector('[data-testid="context-injection-chip"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain(expected as string);
		unmount(instance);
	});

	it.each([
		['skill-invocation with an empty name', 'skill-invocation', { name: '' }],
		['recall with a non-array references', 'recall', { references: 'nope' }],
		['recall with a nameless first reference', 'recall', { references: [{ label: '' }] }],
		['plugin with a non-string name', 'plugin', { plugin: 42 }],
		['injected with an unknown kind', 'injected', { kind: 'mystery' }]
	])('%s falls back to the bare category', async (_label, meta, source) => {
		const { target, instance } = mountArea([prompt('u1', 'go'), injection('u2', meta as never, source)]);
		await settle();
		expect(target.querySelector('[data-testid="context-injection-chip"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('ConversationScrollArea — the sub-agent open affordance', () => {
	it('a report with a sender session opens that sender panel through the registry', async () => {
		const add = vi.fn();
		registerAddPanel(add);
		const { target, instance } = mountArea([
			prompt('u1', 'go'),
			injection('u2', 'injected', { kind: 'subagent-report', senderSessionId: 'sess-child' })
		]);
		await settle();
		const open = target.querySelector('[data-testid="context-injection-open"]') as HTMLElement;
		expect(open).not.toBeNull();
		open.click();
		expect(add).toHaveBeenCalledWith({ sessionId: 'sess-child', agentPreset: null });
		unmount(instance);
	});

	it('a settled report with a sender session affords the same jump', async () => {
		const add = vi.fn();
		registerAddPanel(add);
		const { target, instance } = mountArea([
			prompt('u1', 'go'),
			injection('u2', 'injected', { kind: 'subagent-settled', senderSessionId: 'sess-done' })
		]);
		await settle();
		(target.querySelector('[data-testid="context-injection-open"]') as HTMLElement).click();
		expect(add).toHaveBeenCalledWith({ sessionId: 'sess-done', agentPreset: null });
		unmount(instance);
	});

	it.each([
		['an empty sender id', { kind: 'subagent-report', senderSessionId: '' }],
		['a non-string sender id', { kind: 'subagent-settled', senderSessionId: 7 }],
		['a missing sender id', { kind: 'subagent-report' }]
	])('%s affords nothing', async (_label, source) => {
		const add = vi.fn();
		registerAddPanel(add);
		const { target, instance } = mountArea([prompt('u1', 'go'), injection('u2', 'injected', source)]);
		await settle();
		expect(target.querySelector('[data-testid="context-injection-open"]')).toBeNull();
		unmount(instance);
	});
});

describe('ConversationScrollArea — answerer body coercion', () => {
	const approval = (body: Record<string, unknown>, over: Partial<AnswerView> = {}): AnswerView => ({
		rpcId: 'rpc-a',
		sessionId: 'sess-x',
		kind: 'approval',
		body,
		receivedAt: T,
		phase: 'waiting',
		...over
	});

	it('a pending approval with a junk body falls back honestly and still answers', async () => {
		const t = document.createElement('div');
		document.body.appendChild(t);
		const onanswer = vi.fn();
		const inst = mount(ConversationScrollArea, {
			target: t,
			props: {
				entries: [prompt('u1', 'hi')],
				groups: groupTurns([prompt('u1', 'hi')]),
				hasMore: undefined,
				loadingOlder: false,
				olderError: null,
				onloadolder: () => {},
				openChipId: null,
				ontogglechip: () => {},
				peekOpenRunKey: null,
				ontogglepeek: () => {},
				pendingCards: [approval({})],
				settledCards: [],
				onanswer,
				sessionId: 'sess-x'
			}
		});
		flushSync();
		expect(t.querySelector('[data-testid="approval-tool"]')?.textContent).toContain('unknown tool');
		expect(t.querySelector('[data-testid="approval-reason"]')).toBeNull();
		expect(t.querySelector('[data-testid="approval-call-id"]')).toBeNull();
		(t.querySelector('[data-testid="approval-allow"]') as HTMLElement).click();
		expect(onanswer).toHaveBeenCalledWith('rpc-a', { approvalId: undefined, outcome: 'allowed-once' });
		unmount(inst);
	});

	it('a settled approval with a junk body renders its resolved line', async () => {
		const t = document.createElement('div');
		document.body.appendChild(t);
		const inst = mount(ConversationScrollArea, {
			target: t,
			props: {
				entries: [prompt('u1', 'hi')],
				groups: groupTurns([prompt('u1', 'hi')]),
				hasMore: undefined,
				loadingOlder: false,
				olderError: null,
				onloadolder: () => {},
				openChipId: null,
				ontogglechip: () => {},
				peekOpenRunKey: null,
				ontogglepeek: () => {},
				pendingCards: [],
				settledCards: [approval({}, { phase: 'settled', outcome: 'denied' })],
				onanswer: () => {},
				sessionId: 'sess-x'
			}
		});
		flushSync();
		expect(t.querySelector('[data-testid="approval-settled"]')).not.toBeNull();
		expect(t.querySelector('[data-testid="approval-tool"]')?.textContent).toContain('unknown tool');
		unmount(inst);
	});

	it('a pending question answers with the session id', async () => {
		const t = document.createElement('div');
		document.body.appendChild(t);
		const onanswer = vi.fn();
		const inst = mount(ConversationScrollArea, {
			target: t,
			props: {
				entries: [prompt('u1', 'hi')],
				groups: groupTurns([prompt('u1', 'hi')]),
				hasMore: undefined,
				loadingOlder: false,
				olderError: null,
				onloadolder: () => {},
				openChipId: null,
				ontogglechip: () => {},
				peekOpenRunKey: null,
				ontogglepeek: () => {},
				pendingCards: [
					{
						rpcId: 'rpc-q',
						sessionId: 'sess-x',
						kind: 'question',
						body: { questions: [{ id: 'q1', question: 'Ship it?', options: [{ id: 'o1', label: 'Yes' }] }] },
						receivedAt: T,
						phase: 'waiting'
					}
				],
				settledCards: [],
				onanswer,
				sessionId: 'sess-x'
			}
		});
		flushSync();
		(t.querySelector('[data-testid="question-option"]') as HTMLElement).click();
		flushSync(); // the answered map must propagate before submit enables
		(t.querySelector('[data-testid="question-submit"]') as HTMLElement).click();
		flushSync();
		expect(onanswer).toHaveBeenCalledWith(
			'rpc-q',
			expect.objectContaining({ sessionId: 'sess-x' })
		);
		const payload = onanswer.mock.calls[0][1] as { answer?: unknown };
		expect(payload.answer).toBeDefined();
		unmount(inst);
	});
});

describe('ConversationScrollArea — the outside-in stick mirror', () => {
	let s: ReturnType<typeof mountStickHost>;
	beforeEach(() => {
		s = mountStickHost();
		fakeGeometry(s.host.viewportEl() as HTMLElement);
	});
	afterEach(() => {
		unmount(s.instance);
	});

	it('flipping the prop to true JUMPS to the bottom (the control never lies)', async () => {
		s.host.setEntries([prompt('u1', 'one'), prompt('u2', 'two'), prompt('u3', 'three')]);
		await settle();
		const viewport = s.host.viewportEl() as HTMLElement;
		// Break the stick first (scroll up), then flip the prop back on.
		s.host.setStick(false);
		await settle();
		viewport.scrollTop = 0;
		viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
		await settle();
		s.host.setStick(true);
		await settle();
		// At (or past) the bottom — the jump target with faked geometry.
		expect(viewport.scrollTop).toBeGreaterThanOrEqual(
			viewport.scrollHeight - viewport.clientHeight
		);
		expect(s.host.stickValue()).toBe(true);
	});
});

// ── Turn End Stamp (2026-09-25, Wave 2 task 2.1-T): footer branches ──
// Marker seqs BRACKET the group (start < group < end) — the joiner's contract.
const marker = (turn: number, phase: 'start' | 'end', seq: number, opts: { reason?: string; abort?: string; time?: number } = {}): DsiEntry =>
	({
		kind: 'turn-lifecycle',
		id: `tl:${turn}:${phase}`,
		seq,
		time: opts.time ?? T + seq,
		turn,
		phase,
		...(opts.reason !== undefined ? { reasonKind: opts.reason } : {}),
		...(opts.abort !== undefined ? { abortKind: opts.abort } : {})
	} as DsiEntry);
const seqd = (id: string, seq: number, time = T + seq): DsiEntry => ({ ...assistant(id, `answer ${id}`), seq, time });

describe('ConversationScrollArea — Turn End Stamp footer', () => {
	it('aborted(user) renders the stopped chip and NO Ran-for prefix', async () => {
		const entries = [
			{ ...prompt('u1', 'go'), seq: 1 },
			marker(1, 'start', 2),
			seqd('a1', 3),
			marker(1, 'end', 4, { reason: 'aborted', abort: 'user' })
		];
		const { target } = mountArea(entries);
		await settle();
		expect(target.querySelector('[data-testid="turn-stopped-chip"]')).not.toBeNull();
		const bubble = target.querySelector('[data-testid="assistant-turn"]')!;
		expect(bubble.textContent).not.toContain('Ran for');
	});

	it('completed uses the WIRE pair for the elapsed stamp', async () => {
		const entries = [
			{ ...prompt('u1', 'go'), seq: 1 },
			marker(1, 'start', 2, { time: T }),
			seqd('a1', 3, T + 1_000),
			marker(1, 'end', 4, { reason: 'completed', time: T + 62_000 })
		];
		const { target } = mountArea(entries);
		await settle();
		const bubble = target.querySelector('[data-testid="assistant-turn"]')!;
		expect(bubble.textContent).toContain('Ran for');
		expect(bubble.textContent).toContain('1m 02s');
		expect(target.querySelector('[data-testid="turn-stopped-chip"]')).toBeNull();
	});

	it('no lifecycle record (old ledger) keeps the fallback stamp and no chip', async () => {
		const { target } = mountArea([prompt('u1', 'go'), seqd('a1', 2)]);
		await settle();
		expect(target.querySelector('[data-testid="turn-stopped-chip"]')).toBeNull();
	});

	it('aborted with a non-user kind stays silent (ADR D4)', async () => {
		const entries = [
			{ ...prompt('u1', 'go'), seq: 1 },
			marker(1, 'start', 2),
			seqd('a1', 3),
			marker(1, 'end', 4, { reason: 'aborted', abort: 'context-window' })
		];
		const { target } = mountArea(entries);
		await settle();
		expect(target.querySelector('[data-testid="turn-stopped-chip"]')).toBeNull();
	});
});
