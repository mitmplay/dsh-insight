/**
 * macro-run-sheet tests (task 2.2-T, kind-driven rewrite of 2.3-T): the
 * chip + sheet render every per-section state with marks classified by
 * the record's TYPED kind — /new AND /permission are instantly ✓ (the
 * note-sniffing pairing bug is dead), mention rows ↗ by kind, query rows
 * ⌕ by kind, send rows upgrade ✓/▶ from the injected poll props only;
 * block rows render display plus +N lines; the chip names the next unfed
 * section's display; held controls fire callbacks; Run again on ended
 * runs; abort offered only while unfed sections remain.
 *
 * Mounts MacroBar directly — presentational, props in / callbacks
 * out (the panel wiring suite covers the panel side).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MacroBar from '$lib/components/anchor/macro/MacroBar.svelte';
import type { MacroLineRecord, MacroRunState } from '$lib/services/chat/macro-runner.svelte';

function rec(
	i: number,
	display: string,
	state: MacroLineRecord['state'],
	extra: Partial<MacroLineRecord> = {}
): MacroLineRecord {
	// kind defaults to 'send' (the turn-capable rows the pairing math
	// exercises); every other kind passes it explicitly.
	return { index: i, kind: 'send', display, sendText: display, lineCount: 1, state, ...extra };
}

function runState(partial: Partial<MacroRunState> = {}): MacroRunState {
	return {
		phase: 'feeding',
		total: 3,
		fed: 2,
		lines: [],
		note: null,
		targetSessionId: null,
		baselineTurns: 0,
		...partial
	};
}

function mountSheet(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onfeednext = vi.fn();
	const onrunall = vi.fn();
	const onabort = vi.fn();
	const onrunagain = vi.fn();
	const onclose = vi.fn();
	const comp = mount(MacroBar, {
		target,
		props: { run: runState(), onfeednext, onrunall, onabort, onrunagain, onclose, ...props }
	});
	flushSync();
	const chip = () => target.querySelector('[data-testid="macro-chip"]');
	const sheet = () => target.querySelector('[data-testid="macro-sheet"]');
	const rows = () => Array.from(target.querySelectorAll('[data-testid="macro-line"]'));
	const expand = () => {
		(target.querySelector('.macro-chip-label') as HTMLButtonElement).click();
		flushSync();
	};
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, chip, sheet, rows, expand, onfeednext, onrunall, onabort, onrunagain, onclose, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('MacroBar — chip (collapsed layer)', () => {
	it('renders nothing while idle', () => {
		const h = mountSheet({ run: runState({ phase: 'idle' }) });
		expect(h.chip()).toBeNull();
		h.cleanup();
	});

	it('feeding chip names k/n and the current line', () => {
		const h = mountSheet({
			run: runState({
				phase: 'feeding',
				total: 2,
				fed: 0,
				lines: [rec(1, '/new @code', 'pending')]
			})
		});
		expect(h.chip()!.textContent).toContain('1/2');
		h.cleanup();
	});

	it('fed chip: all queued behind a running turn (honest queued label)', () => {
		const h = mountSheet({
			run: runState({ phase: 'fed', total: 2, fed: 2, lines: [rec(1, 'a', 'queued'), rec(2, 'b', 'queued')] }),
			running: false
		});
		expect(h.chip()!.textContent).toContain('✓ fed');
		h.cleanup();
	});

	it('the harness-is-asking suffix appears when pending cards exist', () => {
		const h = mountSheet({
			run: runState({ phase: 'fed', total: 1, fed: 1, lines: [rec(1, 'a', 'queued')] }),
			pendingAnswers: 1
		});
		expect(h.chip()!.textContent).toContain('the harness is asking');
		h.cleanup();
	});

	it('failed chip shows the fail-loud reason; stopped shows the abort note', () => {
		const f = mountSheet({ run: runState({ phase: 'failed', note: 'no shelf match for "oci"' }) });
		expect(f.chip()!.textContent).toContain('no shelf match');
		f.cleanup();
		const s = mountSheet({ run: runState({ phase: 'stopped', note: 'aborted — unfed lines dropped' }) });
		expect(s.chip()!.textContent).toContain('stopped');
		expect(s.chip()!.textContent).toContain('aborted');
		s.cleanup();
	});

	it('Stop (chip) fires onabort while unfed lines remain', () => {
		const h = mountSheet({
			run: runState({ phase: 'held', total: 2, fed: 0, lines: [rec(1, 'a', 'pending'), rec(2, 'b', 'pending')] })
		});
		(h.target.querySelector('[data-testid="macro-stop"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.onabort).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('abort-after-queued honesty: no Stop once everything is fed', () => {
		const h = mountSheet({
			run: runState({ phase: 'fed', total: 2, fed: 2, lines: [rec(1, 'a', 'queued'), rec(2, 'b', 'queued')] })
		});
		expect(h.target.querySelector('[data-testid="macro-stop"]')).toBeNull();
		h.cleanup();
	});
});

describe('MacroBar — sheet: six per-line states', () => {
	it('renders ✓ ▶ ⏳ ⊙ ⊘ ✕ marks with their state names', () => {
		const h = mountSheet({
			run: runState({
				phase: 'held',
				total: 6,
				fed: 5,
				lines: [
					rec(1, 'done line', 'queued'), // ✓ (landedTurns 1 below)
					rec(2, 'running line', 'queued'), // ▶
					rec(3, 'queued line', 'queued'), // ⏳
					rec(4, 'held line', 'pending'), // ⊙
					rec(5, 'skipped line', 'skipped', { note: 'already in this run — skipped' }), // ⊘
					rec(6, 'failed line', 'failed', { note: 'wire said no' }) // ✕
				]
			}),
			landedTurns: 1,
			running: true
		});
		h.expand();
		const rows = h.rows();
		expect(rows).toHaveLength(6);
		const marks = rows.map((r) => r.getAttribute('data-state'));
		expect(marks).toEqual(['done', 'running', 'queued', 'pending (held)', 'skipped', 'failed']);
		expect(rows[0].textContent).toContain('✓');
		expect(rows[1].textContent).toContain('▶');
		expect(rows[2].textContent).toContain('⏳');
		expect(rows[3].textContent).toContain('⊙');
		expect(rows[4].textContent).toContain('⊘');
		expect(rows[5].textContent).toContain('✕');
		// the failure's verbatim note rides the row
		expect(rows[5].textContent).toContain('wire said no');
		h.cleanup();
	});

	it('a /new line is ✓ instantly (host-side, no turn to wait for)', () => {
		const h = mountSheet({
			run: runState({
				phase: 'feeding',
				total: 2,
				fed: 1,
				lines: [rec(1, '/new @code', 'queued', { kind: 'command', note: 'new session: 22222222…' })]
			}),
			landedTurns: 0
		});
		h.expand();
		expect(h.rows()[0].getAttribute('data-state')).toBe('done');
		h.cleanup();
	});

	it('a mention row renders sent-to (delegates to the a2a chip stack)', () => {
		const h = mountSheet({
			run: runState({
				phase: 'fed',
				total: 1,
				fed: 1,
				lines: [
					rec(1, '@session-abc check the build', 'queued', {
						kind: 'mention',
						sendText: 'check the build',
						note: 'sent to TE-LO-LET — panel opened'
					})
				]
			}),
			landedTurns: 0,
			running: false
		});
		h.expand();
		const row = h.rows()[0];
		expect(row.getAttribute('data-state')).toBe('sent to target');
		expect(row.textContent).toContain('sent to TE-LO-LET');
		h.cleanup();
	});

	it('a ? line renders as its own resolved row (⌕) above the lines it expanded', () => {
		const h = mountSheet({
			run: runState({
				phase: 'fed',
				total: 3,
				fed: 3,
				lines: [
					rec(1, '?oci', 'queued', { kind: 'query', isQuery: true, note: 'resolved: 2 sections' }),
					rec(2, 'list containers', 'queued'),
					rec(3, 'prune them', 'queued')
				]
			})
		});
		h.expand();
		expect(h.rows()[0].textContent).toContain('⌕');
		expect(h.rows()[0].textContent).toContain('resolved: 2 sections');
		h.cleanup();
	});
});

describe('MacroBar — kind-driven classification (W2 2.2: no note sniffing)', () => {
	it('/permission is instantly ✓ by KIND (the audit pairing bug dies)', () => {
		const h = mountSheet({
			run: runState({
				phase: 'fed',
				total: 3,
				fed: 3,
				lines: [
					rec(1, '/permission', 'queued', { kind: 'command', note: 'permission updated' }),
					rec(2, 'first prompt', 'queued'),
					rec(3, 'second prompt', 'queued')
				]
			}),
			landedTurns: 1,
			running: true
		});
		h.expand();
		// /permission ✓ instantly; the two sends pair 1:1 with landed turns —
		// NO shift from the command between them
		expect(h.rows().map((r) => r.getAttribute('data-state'))).toEqual(['done', 'done', 'running']);
		h.cleanup();
	});

	it('a command between two blocks shifts NO pairing (ordinal math is kind-driven)', () => {
		const h = mountSheet({
			run: runState({
				phase: 'feeding',
				total: 3,
				fed: 3,
				lines: [
					rec(1, 'block one', 'queued', { lineCount: 2, sendText: 'block one\nmore' }),
					rec(2, '/new @code', 'queued', { kind: 'command', note: 'new session: 2222…' }),
					rec(3, 'block two', 'queued', { lineCount: 3, sendText: 'block two\nx\ny' })
				]
			}),
			landedTurns: 0,
			running: true
		});
		h.expand();
		// block-one ▶ (turn 1 in flight), /new ✓ by kind, block-two ⏳ (turn 2)
		expect(h.rows().map((r) => r.getAttribute('data-state'))).toEqual(['running', 'done', 'queued']);
		h.cleanup();
	});

	it('block rows render display plus +N lines; the row title carries the full sendText', () => {
		const h = mountSheet({
			run: runState({
				phase: 'fed',
				total: 1,
				fed: 1,
				lines: [
					rec(1, '- load project AIP', 'queued', {
						lineCount: 3,
						sendText: '- load project AIP\n- run the containers\n- prune them after'
					})
				]
			})
		});
		h.expand();
		const row = h.rows()[0];
		expect(row.textContent).toContain('- load project AIP');
		expect(row.textContent).toContain('+2 lines');
		expect(row.querySelector('.macro-line-text')!.getAttribute('title')).toBe(
			'- load project AIP\n- run the containers\n- prune them after'
		);
		h.cleanup();
	});

	it('mention rows are ↗ by kind even with a hostile note; query rows ⌕ by kind', () => {
		const h = mountSheet({
			run: runState({
				phase: 'fed',
				total: 2,
				fed: 2,
				lines: [
					// note text that the OLD sniffer would have mis-read: a
					// mention whose note does NOT start with "sent to"
					rec(1, '@session-abc hi', 'queued', { kind: 'mention', note: 'queued behind X — panel opened' }),
					rec(2, '?oci', 'queued', { kind: 'query', isQuery: true })
				]
			})
		});
		h.expand();
		expect(h.rows().map((r) => r.getAttribute('data-state'))).toEqual(['sent to target', 'resolved']);
		h.cleanup();
	});

	it('the chip names the next unfed section\'s display while held/feeding', () => {
		const h = mountSheet({
			run: runState({
				phase: 'feeding',
				total: 3,
				fed: 1,
				lines: [
					rec(1, 'done block', 'queued'),
					rec(2, '/new @code', 'pending', { kind: 'command' }),
					rec(3, 'later block', 'pending')
				]
			})
		});
		expect(h.chip()!.textContent).toContain('2/3');
		expect(h.chip()!.textContent).toContain('/new @code');
		h.cleanup();
	});

	it('fed chip counts SECTIONS (a block is one — D15)', () => {
		const h = mountSheet({
			run: runState({
				phase: 'fed',
				total: 1,
				fed: 1,
				lines: [rec(1, 'one big block', 'queued', { lineCount: 9 })]
			})
		});
		expect(h.chip()!.textContent).toContain('1 section');
		h.cleanup();
	});
});

describe('MacroBar — ✓/▶ derivation math (D9: props only)', () => {
	it('done = fed lines with a landed assistant-turn group, in order', () => {
		const lines = [rec(1, 'one', 'queued'), rec(2, 'two', 'queued'), rec(3, 'three', 'queued')];
		const run = runState({ phase: 'fed', total: 3, fed: 3, lines });
		const h0 = mountSheet({ run, landedTurns: 0, running: false });
		h0.expand();
		expect(h0.rows().map((r) => r.getAttribute('data-state'))).toEqual(['queued', 'queued', 'queued']);
		h0.cleanup();

		const h1 = mountSheet({ run, landedTurns: 1, running: true });
		h1.expand();
		expect(h1.rows().map((r) => r.getAttribute('data-state'))).toEqual(['done', 'running', 'queued']);
		h1.cleanup();

		const h3 = mountSheet({ run, landedTurns: 3, running: false });
		h3.expand();
		expect(h3.rows().map((r) => r.getAttribute('data-state'))).toEqual(['done', 'done', 'done']);
		h3.cleanup();
	});

	it('▶ only while running — the same map with running=false degrades to ⏳', () => {
		const lines = [rec(1, 'one', 'queued'), rec(2, 'two', 'queued')];
		const run = runState({ phase: 'fed', total: 2, fed: 2, lines });
		const h = mountSheet({ run, landedTurns: 1, running: false });
		h.expand();
		// second line's turn NOT landed and nothing is running → honest ⏳
		expect(h.rows().map((r) => r.getAttribute('data-state'))).toEqual(['done', 'queued']);
		h.cleanup();
	});

	it('command lines do not consume a turn slot (ordinal math skips them)', () => {
		const h = mountSheet({
			run: runState({
				phase: 'fed',
				total: 3,
				fed: 3,
				lines: [
					rec(1, '/new @code', 'queued', { kind: 'command', note: 'new session: 2222…' }),
					rec(2, 'first prompt', 'queued'),
					rec(3, 'second prompt', 'queued')
				]
			}),
			landedTurns: 1,
			running: true
		});
		h.expand();
		expect(h.rows().map((r) => r.getAttribute('data-state'))).toEqual(['done', 'done', 'running']);
		h.cleanup();
	});
});

describe('MacroBar — held controls + run again (D10)', () => {
	it('held run: Feed next / Run all / Abort fire their callbacks', () => {
		const h = mountSheet({
			run: runState({
				phase: 'held',
				total: 2,
				fed: 0,
				lines: [rec(1, 'a', 'pending'), rec(2, 'b', 'pending')]
			})
		});
		h.expand();
		expect(h.target.querySelector('[data-testid="macro-held-controls"]')).not.toBeNull();
		(h.target.querySelector('[data-testid="macro-feednext"]') as HTMLButtonElement).click();
		(h.target.querySelector('[data-testid="macro-runall"]') as HTMLButtonElement).click();
		(h.target.querySelector('[data-testid="macro-abort"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.onfeednext).toHaveBeenCalledTimes(1);
		expect(h.onrunall).toHaveBeenCalledTimes(1);
		expect(h.onabort).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('held controls hidden on feeding runs (the feed is already loose)', () => {
		const h = mountSheet({
			run: runState({ phase: 'feeding', total: 2, fed: 0, lines: [rec(1, 'a', 'pending')] })
		});
		h.expand();
		expect(h.target.querySelector('[data-testid="macro-held-controls"]')).toBeNull();
		h.cleanup();
	});

	it('Run again appears on ended runs (fed/failed/stopped) and fires onrunagain', () => {
		for (const phase of ['fed', 'failed', 'stopped'] as const) {
			const h = mountSheet({
				run: runState({ phase, total: 1, fed: 1, lines: [rec(1, 'a', 'queued')] })
			});
			h.expand();
			const again = h.target.querySelector('[data-testid="macro-runagain"]') as HTMLButtonElement;
			expect(again).not.toBeNull();
			again.click();
			flushSync();
			expect(h.onrunagain).toHaveBeenCalledTimes(1);
			h.cleanup();
		}
	});

	it('Run again hidden while a run is live', () => {
		const h = mountSheet({
			run: runState({ phase: 'held', total: 1, fed: 0, lines: [rec(1, 'a', 'pending')] })
		});
		h.expand();
		expect(h.target.querySelector('[data-testid="macro-runagain"]')).toBeNull();
		h.cleanup();
	});
});

describe('MacroBar — presentational contract', () => {
	it('no fetch ever fires from the sheet', async () => {
		const calls: string[] = [];
		const original = globalThis.fetch;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				calls.push(String(input));
				return new Response('{}');
			})
		);
		try {
			const h = mountSheet({
				run: runState({ phase: 'feeding', total: 2, fed: 1, lines: [rec(1, 'a', 'queued'), rec(2, 'b', 'pending')] }),
				running: true
			});
			h.expand();
			await new Promise((r) => setTimeout(r, 50));
			expect(calls).toHaveLength(0);
			h.cleanup();
		} finally {
			vi.unstubAllGlobals();
			void original;
		}
	});
});

describe('MacroBar — close button (ended runs)', () => {
	it('renders the right-aligned close button only on ended runs', () => {
		for (const phase of ['fed', 'stopped', 'failed'] as const) {
			const h = mountSheet({ run: runState({ phase }) });
			const btn = h.target.querySelector('[data-testid="macro-close"]') as HTMLButtonElement | null;
			expect(btn, phase).not.toBeNull();
			// right-aligned: it is the chip row's last child (after label/Stop)
			expect(h.chip()!.lastElementChild).toBe(btn);
			h.cleanup();
		}
	});

	it('no close button while the run is live', () => {
		for (const phase of ['feeding', 'held'] as const) {
			const h = mountSheet({ run: runState({ phase }) });
			expect(h.target.querySelector('[data-testid="macro-close"]')).toBeNull();
			h.cleanup();
		}
	});

	it('click fires onclose exactly once', () => {
		const h = mountSheet({ run: runState({ phase: 'fed' }) });
		(h.target.querySelector('[data-testid="macro-close"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.onclose).toHaveBeenCalledTimes(1);
		h.cleanup();
	});
});
