/**
 * ConversationStatsBar tests (spec Wave 2, task 2.1-T): null renders
 * nothing; segment render/omission per ADR D3; fixed one-line height and
 * CSS ellipsis truncation (D5); data-testid seams for the panel wiring.
 */
import { mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import ConversationStatsBar from '$lib/components/conversation/panel/ConversationStatsBar.svelte';
import { statsFromLedger, type SessionStats } from '../../../../src/lib/services/conversation/session-stats';
import type { DsiLedgerStats } from '$lib/types';

const full: SessionStats = {
	turns: 26,
	steps: 170,
	toolMs: 358_000,
	inputTokens: 15_800_000,
	outputTokens: 56_300,
	cacheReadTokens: 15_300_000,
	cacheWriteTokens: 10_000,
	cacheHitPercent: 97
};

function mountBar(stats: SessionStats | null, width = '600px') {
	const target = document.createElement('div');
	target.style.width = width;
	document.body.appendChild(target);
	const comp = mount(ConversationStatsBar, { target, props: { stats } });
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

function segments(target: HTMLElement): string[] {
	return [...target.querySelectorAll('[data-testid="stats-segment"]')].map((el) => (el as HTMLElement).textContent ?? '');
}

describe('ConversationStatsBar — full-ledger extension', () => {
	const ledger: DsiLedgerStats = {
		turns: 20,
		steps: 286,
		llmMs: 4_210_000,
		toolMs: 1_451_000,
		ttftMs: 448_000,
		ttftSteps: 286,
		decodeMs: 1_930_000,
		decodeTokens: 108_000,
		uncachedInputTokens: 615_000,
		cacheReadTokens: 60_800_000,
		cacheWriteTokens: 0,
		outputTokens: 108_000
	};

	it('statsFromLedger mirrors the DSH bar: billed input incl. cache, LLM group, speeds', () => {
		const { target, cleanup } = mountBar(statsFromLedger(ledger));
		expect(segments(target)).toEqual([
			'20 turns · 286 steps',
			'LLM 1h10m · Tool 24m11s',
			'TTFT avg 1s · 56 tok/s',
			'Input 61.4M tok · Output 108K tok',
			'Cache hit 99%'
		]);
		cleanup();
	});

	it('omits the full-ledger groups when their inputs are zero (degrade parity)', () => {
		const { target, cleanup } = mountBar(
			statsFromLedger({ ...ledger, llmMs: 0, ttftSteps: 0, ttftMs: 0, decodeMs: 0, decodeTokens: 0 })
		);
		expect(segments(target)).toEqual(['20 turns · 286 steps', 'Tool 24m11s', 'Input 61.4M tok · Output 108K tok', 'Cache hit 99%']);
		cleanup();
	});
});

describe('ConversationStatsBar', () => {	it('renders nothing for null stats (AC1, empty session)', () => {
		const { target, cleanup } = mountBar(null);
		expect(target.querySelector('[data-testid="conversation-stats-bar"]')).toBeNull();
		cleanup();
	});

	it('renders the full segment set: counts, tool time, tokens, cache hit', () => {
		const { target, cleanup } = mountBar(full);
		expect(segments(target)).toEqual(['26 turns · 170 steps', 'Tool 5m58s', 'Input 15.8M tok · Output 56.3K tok', 'Cache hit 97%']);
		cleanup();
	});

	it('omits segments whose inputs are absent (D3 honesty)', () => {
		const minimal: SessionStats = { turns: 1, steps: 1, toolMs: 0 };
		const { target, cleanup } = mountBar(minimal);
		expect(segments(target)).toEqual(['1 turns · 1 steps']);
		const noTools: SessionStats = { turns: 2, steps: 3, toolMs: 0, inputTokens: 999, outputTokens: 1 };
		const t2 = mountBar(noTools);
		expect(segments(t2.target)).toEqual(['2 turns · 3 steps', 'Input 999 tok · Output 1 tok']);
		t2.cleanup();
		cleanup();
	});

	it('formats tool durations across every unit arm (ms, s, m, m+s, h+m)', () => {
		const cases: Array<[number, string]> = [
			[250, 'Tool 250ms'],
			[59_000, 'Tool 59s'],
			[60_000, 'Tool 1m'],
			[61_000, 'Tool 1m1s'],
			[3_600_000, 'Tool 1h0m'],
			[3_720_000, 'Tool 1h2m']
		];
		for (const [toolMs, expected] of cases) {
			const h = mountBar({ turns: 1, steps: 1, toolMs });
			expect(segments(h.target)).toContain(expected);
			h.cleanup();
		}
	});

	it('falls back to 0 output tokens when only input accounting arrived', () => {
		const h = mountBar({ turns: 1, steps: 1, toolMs: 0, inputTokens: 2_500, outputTokens: undefined as unknown as number });
		expect(segments(h.target)).toContain('Input 2.5K tok · Output 0 tok');
		h.cleanup();
	});

	// happy-dom resolves NEITHER Svelte-scoped computed styles NOR injected
	// styleSheets (repo-probed 2026-08-28, prompts-manager.test.ts note), so
	// the fixed-height and ellipsis CSS (D5) are DOM-verifiable here only as
	// structure: one bar element, all segments inline within it. The real
	// geometry (constant 1.5rem row, no wrap at narrow width) is pinned by
	// tests/e2e/stats-bar.spec.ts against the real browser (Wave 3, AC5).
	it('renders exactly one fixed bar row holding every segment inline (D5 structure)', () => {
		const a = mountBar({ turns: 1, steps: 1, toolMs: 0 });
		const bars = a.target.querySelectorAll('[data-testid="conversation-stats-bar"]');
		expect(bars.length).toBe(1);
		expect((bars[0] as HTMLElement).querySelectorAll('[data-testid="stats-segment"]').length).toBe(1);
		a.cleanup();
		const b = mountBar(full);
		const bar = b.target.querySelector('[data-testid="conversation-stats-bar"]') as HTMLElement;
		const rows = new Set([...bar.querySelectorAll('[data-testid="stats-segment"]')].map((el) => (el.parentElement === bar ? 'bar' : 'other')));
		expect(rows).toEqual(new Set(['bar']));
		b.cleanup();
	});

	it('carries the full text accessible via the bar title when segments truncate (D5)', () => {
		const { target, cleanup } = mountBar(full, '180px');
		const bar = target.querySelector('[data-testid="conversation-stats-bar"]') as HTMLElement;
		expect(bar.getAttribute('title')).toBe('26 turns · 170 steps | Tool 5m58s | Input 15.8M tok · Output 56.3K tok | Cache hit 97%');
		cleanup();
	});
});
