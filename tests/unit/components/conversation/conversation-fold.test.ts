/**
 * conversation-fold tests (Fold Gate task 3.2-T) — the wiring contract of
 * the fold inside ConversationScrollArea (ADR-0010): flags off → the flat
 * transcript DOM (no disclosure rows, every run rendered); collapsable on →
 * answered turns fold behind a disclosure row that opens on click, escaped
 * reasoning pills render ABOVE the row, tool-only turns stay flat.
 *
 * appConfig is mocked per suite — this component is the fold's only
 * appConfig() reader, so the mock IS the config seam under test.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationScrollArea from '$lib/components/conversation/panel/ConversationScrollArea.svelte';
import { groupTurns } from '$lib/utils/turn-grouping';
import type { DsiEntry } from '$lib/types';

const appConfigMock = vi.hoisted(() => vi.fn(() => ({ conversation: { collapsable: false, progressiveFold: false } })));
vi.mock('$lib/services/config/app-config.svelte', () => ({ appConfig: appConfigMock }));

const user = (id: string, seq: number): DsiEntry => ({
	kind: 'user-message', id, seq, time: 1000 + seq, text: 'prompt'
});
const answer = (id: string, seq: number, reasoning = ''): DsiEntry => ({
	kind: 'assistant-message', id, seq, time: 1000 + seq, text: 'answer ' + id, streaming: false,
	...(reasoning ? { reasoning } : {})
});
const toolCall = (id: string, seq: number, callId: string): DsiEntry => ({
	kind: 'tool-call', id, seq, time: 1000 + seq, callId, toolName: 'grep', status: 'pass'
});
const reasoningOnly = (id: string, seq: number): DsiEntry => ({
	kind: 'assistant-message', id, seq, time: 1000 + seq, text: '', streaming: false, reasoning: 'hmm'
});

/** Turn 1: reasoning + tool call + narration + answer. Turn 2: tool-only. */
const entries: DsiEntry[] = [
	user('u1', 1),
	reasoningOnly('r1', 2),
	toolCall('c1', 3, 'k1'),
	answer('a1', 4),
	user('u2', 5),
	toolCall('c2', 6, 'k2')
];

function mountArea() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(ConversationScrollArea, {
		target,
		props: {
			entries,
			groups: groupTurns(entries),
			hasMore: false,
			loadingOlder: false,
			olderError: null,
			onloadolder: () => {},
			openChipId: null,
			ontogglechip: () => {},
			peekOpenRunKey: null,
			ontogglepeek: () => {},
			pendingCards: [],
			settledCards: [],
			onanswer: () => {},
			sessionId: 's1'
		}
	});
	flushSync();
	const q = (sel: string) => target.querySelector(sel);
	const qa = (sel: string) => target.querySelectorAll(sel);
	return { target, comp, q, qa };
}

let area: ReturnType<typeof mountArea> | null = null;
afterEach(() => {
	if (area) {
		unmount(area.comp);
		area = null;
	}
});

describe('ConversationScrollArea fold wiring (ADR-0010)', () => {
	beforeEach(() => {
		appConfigMock.mockReset();
		appConfigMock.mockReturnValue({ conversation: { collapsable: false, progressiveFold: false } });
	});

	it('flags off — flat transcript: no disclosure row, every run rendered (byte-path regression)', () => {
		area = mountArea();
		expect(area.qa('[data-testid="turn-process-disclosure"]').length).toBe(0);
		// both tool calls render open in the flat path
		expect(area.qa('[data-testid="tool-chip"]').length).toBe(2);
	});

	it('collapsable on — answered turn folds, tool-only turn stays flat', () => {
		appConfigMock.mockReturnValue({ conversation: { collapsable: true, progressiveFold: false } });
		area = mountArea();
		const rows = area.qa('[data-testid="turn-process-disclosure"]');
		expect(rows.length).toBe(1);
		expect(area.q('[data-testid="turn-process-label"]')?.textContent).toContain('1 tool call');
		// turn 2's tool call still renders open
		expect(area.qa('[data-testid="tool-chip"]').length).toBe(1);
	});

	it('click toggles: closed hides folded chips, open reveals them in wire order', async () => {
		appConfigMock.mockReturnValue({ conversation: { collapsable: true, progressiveFold: false } });
		area = mountArea();
		const row = area.q('[data-testid="turn-process-disclosure"]') as HTMLButtonElement;
		expect(row.getAttribute('aria-expanded')).toBe('false');
		row.click();
		flushSync();
		expect(area.q('[data-testid="turn-process-disclosure"]')!.getAttribute('aria-expanded')).toBe('true');
		// folded tool chip now renders (turn 1's, plus turn 2's always-open one)
		expect(area.qa('[data-testid="tool-chip"]').length).toBe(2);
	});

	it('reasoning pills escape the fold — outside the closed row, BELOW the disclosure (D6)', () => {
		appConfigMock.mockReturnValue({ conversation: { collapsable: true, progressiveFold: false } });
		area = mountArea();
		const row = area.q('[data-testid="turn-process-disclosure"]')!;
		// the row stays FIRST; the escaped reasoning strip renders right below it
		const reasoning = area.q('[data-testid="reasoning-section"]');
		expect(reasoning).not.toBeNull();
		expect((reasoning as Element).compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
	});

	it('expanded fold: reasoning pills move to their wire positions INSIDE the body — exactly one, never duplicated', async () => {
		appConfigMock.mockReturnValue({ conversation: { collapsable: true, progressiveFold: false } });
		area = mountArea();
		const row = area.q('[data-testid="turn-process-disclosure"]') as HTMLButtonElement;
		// closed: one escaped strip above the row
		expect(area.qa('[data-testid="reasoning-section"]').length).toBeGreaterThanOrEqual(1);
		row.click();
		flushSync();
		// open: the escaped strip is gone; the pill lives at its wire position
		// inside the fold body — still exactly ONE reasoning section per entry
		const sections = area.qa('[data-testid="reasoning-section"]');
		const rowEl = area.q('[data-testid="turn-process-disclosure"]')!;
		expect(sections.length).toBe(1);
		// the pill sits INSIDE the expanded body: after the disclosure row
		expect((sections[0] as Element).compareDocumentPosition(rowEl) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
	});

	// ── ADR-0022 (The Escaped Injection): injection chips never fold ──
	const injection = (id: string, seq: number): DsiEntry => ({
		kind: 'user-message', id, seq, time: 1000 + seq,
		text: '<system-reminder>Additional instructions from: AGENTS.md</system-reminder>',
		meta: 'instructions', metaSource: { kind: 'agent-instructions', form: 'instructions', changes: [{ action: 'set', path: 'AGENTS.md' }] }
	});
	const injectedEntries: DsiEntry[] = [
		user('u1', 1),
		toolCall('c1', 2, 'k1'),
		injection('n1', 3),
		answer('a1', 4)
	];

	it('injection chips escape the fold — visible while the row is CLOSED (D7)', () => {
		appConfigMock.mockReturnValue({ conversation: { collapsable: true, progressiveFold: false } });
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ConversationScrollArea, {
			target,
			props: {
				entries: injectedEntries,
				groups: groupTurns(injectedEntries),
				hasMore: false, loadingOlder: false, olderError: null,
				onloadolder: () => {}, openChipId: null, ontogglechip: () => {},
				peekOpenRunKey: null, ontogglepeek: () => {},
				pendingCards: [], settledCards: [], onanswer: () => {}, sessionId: 's1'
			}
		});
		try {
			flushSync();
			const q = (sel: string) => target.querySelector(sel);
			expect(q('[data-testid="turn-process-disclosure"]')).not.toBeNull();
			// the AGENTS.md chip is visible WITHOUT expanding the fold
			const chip = q('[data-testid="context-injection-chip"]');
			expect(chip).not.toBeNull();
			expect(chip!.getAttribute('data-producer')).toBe('instructions');
			// the label never counts injections (D3 half stands)
			expect(q('[data-testid="turn-process-label"]')?.textContent).toContain('1 tool call');
		} finally {
			unmount(comp);
		}
	});

	it('expanded fold: the injection chip replays at its wire position — exactly one, never duplicated', async () => {
		appConfigMock.mockReturnValue({ conversation: { collapsable: true, progressiveFold: false } });
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ConversationScrollArea, {
			target,
			props: {
				entries: injectedEntries,
				groups: groupTurns(injectedEntries),
				hasMore: false, loadingOlder: false, olderError: null,
				onloadolder: () => {}, openChipId: null, ontogglechip: () => {},
				peekOpenRunKey: null, ontogglepeek: () => {},
				pendingCards: [], settledCards: [], onanswer: () => {}, sessionId: 's1'
			}
		});
		try {
			flushSync();
			const q = (sel: string) => target.querySelector(sel);
			const qa = (sel: string) => target.querySelectorAll(sel);
			expect(qa('[data-testid="context-injection-chip"]').length).toBe(1);
			(q('[data-testid="turn-process-disclosure"]') as HTMLButtonElement).click();
			flushSync();
			// open: strip gone, chip lives in the body — still exactly ONE
			expect(qa('[data-testid="context-injection-chip"]').length).toBe(1);
			expect(q('[data-testid="turn-process-disclosure"]')!.getAttribute('aria-expanded')).toBe('true');
		} finally {
			unmount(comp);
		}
	});
});
