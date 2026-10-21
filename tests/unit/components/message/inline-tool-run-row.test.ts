/**
 * InlineToolRunRow unit tests (ADR-0033 D4) — the wiring seat renders
 * the REAL InlineToolCalls child and every test drives the host's
 * contract through the child's DOM: the passthrough suite proves the
 * eleven child props actually land (peek pair derived from runKey,
 * session wiring forwarded, callbacks closed over the row key), and
 * the peekIcon suite pins the wrench/context glyph forwarding.
 */

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InlineToolRunRow from '$lib/components/message/assistant/InlineToolRunRow.svelte';
import type { TurnMember } from '$lib/utils/turn-grouping';
import type { DsiEntry } from '$lib/types';

const T = 1_700_000_000_000;

const msg = (over: Partial<Extract<DsiEntry, { kind: 'assistant-message' }>> = {}): TurnMember =>
	({ kind: 'assistant-message', id: 'm1', seq: 1, time: T, text: '', streaming: false, ...over }) as TurnMember;
const call = (over: Partial<Extract<DsiEntry, { kind: 'tool-call' }>> = {}): TurnMember =>
	({ kind: 'tool-call', id: 'c1', seq: 2, time: T, callId: 'call-1', toolName: 'Bash', status: 'pass', argsRaw: '{"command":"ls -la"}', ...over }) as TurnMember;
const result = (over: Partial<Extract<DsiEntry, { kind: 'tool-result' }>> = {}): DsiEntry =>
	({ kind: 'tool-result', id: 'r1', seq: 3, time: T, callId: 'call-1', toolName: 'Bash', ok: true, resultText: 'total 0', ...over });

const makeRun = (over: Record<string, unknown> = {}) => ({
	openChipId: null as string | null,
	peekOpenRunKey: null as string | null,
	allEntries: [] as DsiEntry[],
	ontogglechip: vi.fn(),
	ontogglepeek: vi.fn(),
	autoThinkId: null,
	autoPlanId: null,
	onFileOpen: undefined,
	...over
});
type RunShape = ReturnType<typeof makeRun>;

let mounted: Array<{ comp: object; target: HTMLElement }> = [];

function renderRow(opts: { run?: RunShape; entries?: TurnMember[]; runKey?: string; peekIcon?: 'wrench' | 'context' } = {}) {
	const run = opts.run ?? makeRun();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(InlineToolRunRow, {
		target,
		props: { run, entries: opts.entries ?? [call()], runKey: opts.runKey ?? 'run-A', peekIcon: opts.peekIcon }
	});
	flushSync();
	mounted.push({ comp, target });
	return { run, target };
}

afterEach(() => {
	for (const m of mounted) { unmount(m.comp); m.target.remove(); }
	mounted = [];
});

describe('InlineToolRunRow — peek pair derivation (ADR-0033 D3)', () => {
	it('peekOpen true when run.peekOpenRunKey === runKey: the peek list renders', () => {
		const { target } = renderRow({ run: makeRun({ peekOpenRunKey: 'run-A' }) });
		expect(target.querySelector('[data-testid="tool-peek-list"]')).not.toBeNull();
	});

	it('peekOpen false when another run key is open: no peek list', () => {
		const { target } = renderRow({ run: makeRun({ peekOpenRunKey: 'run-B' }), runKey: 'run-A' });
		expect(target.querySelector('[data-testid="tool-peek-list"]')).toBeNull();
	});

	it('peekOpen false when nothing is open (null key)', () => {
		const { target } = renderRow({ run: makeRun({ peekOpenRunKey: null }) });
		expect(target.querySelector('[data-testid="tool-peek-list"]')).toBeNull();
	});

	it('clicking the peek badge calls ontogglepeek with THIS row key', () => {
		const { run, target } = renderRow({ runKey: 'run-C' });
		(target.querySelector('[data-testid="tool-peek-button"]') as HTMLElement).click();
		flushSync();
		expect(run.ontogglepeek).toHaveBeenCalledWith('run-C');
	});
});

describe('InlineToolRunRow — session wiring passthrough', () => {
	it('openChipId forwarded: an open reasoning chip renders its body', () => {
		const { target } = renderRow({ run: makeRun({ openChipId: 'r:m1' }), entries: [msg({ reasoning: 'deep' })] });
		expect(target.querySelector('[data-testid="reasoning-body"]')).not.toBeNull();
	});

	it('autoThinkId forwarded: the live think auto-opens without a manual chip', () => {
		const { target } = renderRow({ run: makeRun({ autoThinkId: 'm1' }), entries: [msg({ reasoning: 'deep' })] });
		expect(target.querySelector('[data-testid="reasoning-body"]')).not.toBeNull();
	});

	it('allEntries forwarded: a plain result pairs ACROSS run bounds', () => {
		const entries = [call()];
		const all = [...entries, result({ id: 'r-outside', callId: 'call-1', resultText: 'const a = 1;' })];
		const { target } = renderRow({ run: makeRun({ openChipId: 'c1', allEntries: all }), entries });
		expect(target.querySelector('[data-testid="tool-chip-result"]')?.textContent).toContain('const a = 1;');
	});

	it('ontogglechip forwarded: clicking a chip toggle reaches the session callback', () => {
		const { run, target } = renderRow();
		(target.querySelector('[data-testid="tool-chip-toggle"]') as HTMLElement).click();
		flushSync();
		expect(run.ontogglechip).toHaveBeenCalledWith('c1');
	});
});

describe('InlineToolRunRow — peekIcon glyph (ADR-0022 I3 seat)', () => {
	it('defaults to the wrench glyph', () => {
		const { target } = renderRow();
		expect(target.querySelector('svg.lucide-wrench')).not.toBeNull();
		expect(target.querySelector('svg.lucide-book-open')).toBeNull();
	});

	it('forwards context for escape-strip rows', () => {
		const { target } = renderRow({ peekIcon: 'context' });
		expect(target.querySelector('svg.lucide-book-open')).not.toBeNull();
		expect(target.querySelector('svg.lucide-wrench')).toBeNull();
	});
});
