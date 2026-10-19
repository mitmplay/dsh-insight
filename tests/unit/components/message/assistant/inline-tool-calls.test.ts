/**
 * InlineToolCalls unit tests — one chip row inside an AssistantTurn.
 *
 * Covers the surfaces the component owns: the chip row itself
 * (reasoning · call · result · unknown · turn-error · an absorbed context
 * injection — The Turn Kept Whole D2 — with page-owned one-open toggles
 * fired upward), the peek-list popup (labels, status dots, args previews),
 * and the open-chip detail popup (markdown body, ToolCallDetail with
 * cross-run paired results, the ask_user_question QuestionBlock and the
 * goal family's GoalCard on BOTH sides, turn-error bodies).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import InlineToolCalls from '$lib/components/message/assistant/InlineToolCalls.svelte';
import ThinkHost from '../../../../fixtures/ThinkHost.svelte';
import type { DsiEntry, DsiReadView } from '$lib/types';
import type { TurnMember, ContextEntry, AssistantSideEntry } from '$lib/utils/turn-grouping';

const T = 1_700_000_000_000;

const msg = (over: Partial<Extract<DsiEntry, { kind: 'assistant-message' }>> = {}): Extract<DsiEntry, { kind: 'assistant-message' }> => ({
	kind: 'assistant-message',
	id: 'm1',
	seq: 1,
	time: T,
	text: '',
	streaming: false,
	...over
});

const call = (over: Partial<Extract<DsiEntry, { kind: 'tool-call' }>> = {}): Extract<DsiEntry, { kind: 'tool-call' }> => ({
	kind: 'tool-call',
	id: 'c1',
	seq: 2,
	time: T,
	callId: 'call-1',
	toolName: 'Bash',
	status: 'pass',
	argsRaw: '{"command":"ls -la"}',
	...over
});

const result = (over: Partial<Extract<DsiEntry, { kind: 'tool-result' }>> = {}): Extract<DsiEntry, { kind: 'tool-result' }> => ({
	kind: 'tool-result',
	id: 'r1',
	seq: 3,
	time: T,
	callId: 'call-1',
	toolName: 'Bash',
	ok: true,
	resultText: 'total 0',
	...over
});

const readView = (): DsiReadView =>
	({ path: '/tmp/a.ts', lang: 'ts', lines: ['const a = 1;'], start: 1, end: 1 }) as unknown as DsiReadView;

/** The absorbed-injection shape (The Turn Kept Whole, D1/D2): a tool-jobs
 *  notice the open turn took in — meta + verbatim source ride the entry. */
const notice = (over: Partial<ContextEntry> = {}): ContextEntry => ({
	kind: 'user-message',
	id: 'j1',
	seq: 9,
	time: T,
	text: 'background job bash-2 finished [status: completed, exit code: 0].',
	meta: 'plugin',
	metaSource: { kind: 'plugin', plugin: 'tool-jobs', form: 'notice' },
	...over
});

function render(props: {
	entries: TurnMember[];
	openChipId?: string | null;
	peekOpen?: boolean;
	allEntries?: DsiEntry[];
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const ontoggleChip = vi.fn();
	const ontogglePeek = vi.fn();
	const comp = mount(InlineToolCalls, {
		target,
		props: {
			entries: props.entries,
			runKey: 'run-1',
			openChipId: props.openChipId ?? null,
			peekOpen: props.peekOpen ?? false,
			allEntries: props.allEntries ?? props.entries,
			ontoggleChip,
			ontogglePeek
		}
	});
	return { target, ontoggleChip, ontogglePeek, unmount: () => unmount(comp) };
}

describe('InlineToolCalls — chip row', () => {
	it('renders one chip per entry kind and fires page-owned toggles upward', () => {
		const entries: TurnMember[] = [
			msg({ id: 'm1', reasoning: 'hmm', text: '' }),
			call({ id: 'c1', status: 'pass' }),
			result({ id: 'r1' }),
			{ kind: 'unknown-event', id: 'u1', seq: 9, time: T, eventType: 'plugin/boot' },
			{ kind: 'turn-error', id: 'e1', seq: 10, time: T, message: 'boom' }
		];
		const { target, ontoggleChip, unmount } = render({ entries });
		expect(target.querySelector('[data-testid="reasoning-section"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="tool-chip"][data-kind="call"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="tool-chip"][data-kind="result"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="tool-chip"][data-kind="unknown"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="turn-error-chip"]')).not.toBeNull();

		(target.querySelector('[data-testid="tool-chip-toggle"]') as HTMLElement).click();
		expect(ontoggleChip).toHaveBeenCalledWith('c1');
		(target.querySelector('[data-testid="reasoning-toggle"]') as HTMLElement).click();
		expect(ontoggleChip).toHaveBeenCalledWith('r:m1', false);
		unmount();
	});

	it('the peek prefix button appears only for non-message runs, carrying the chip count', () => {
		const onlyText = render({ entries: [msg({ id: 'm1', text: 'hi' })] });
		expect(onlyText.target.querySelector('[data-testid="tool-peek-button"]')).toBeNull();
		onlyText.unmount();

		const mixed = render({ entries: [msg({ id: 'm1', text: 'hi' }), call({ id: 'c1' }), result({ id: 'r1' })] });
		const peek = mixed.target.querySelector('[data-testid="tool-peek-button"]') as HTMLElement;
		expect(peek).not.toBeNull();
		expect(peek.textContent).toContain('2'); // messages excluded from the count
		peek.click();
		expect(mixed.ontogglePeek).toHaveBeenCalledTimes(1);
		mixed.unmount();
	});

	it('a message without reasoning renders no reasoning chip (streaming text run)', () => {
		const { target, unmount } = render({ entries: [msg({ id: 'm1', text: 'answer', reasoning: undefined })] });
		expect(target.querySelector('[data-testid="reasoning-section"]')).toBeNull();		expect(target.querySelector('[data-testid="tool-chip"]')).toBeNull();
		unmount();
	});
});

describe('InlineToolCalls — peek list popup (peekOpen)', () => {
	it('labels and dots follow the chip skins: pass/fail/pending, result ok, error, event', () => {
		const entries: AssistantSideEntry[] = [
			call({ id: 'c1', toolName: 'bash', status: 'pass' }),
			call({ id: 'c2', toolName: 'read', status: 'fail' }),
			call({ id: 'c3', toolName: 'write', status: 'pending', argsRaw: '{"path":"/tmp/x"}' }),
			result({ id: 'r1', toolName: 'bash', ok: false }),
			{ kind: 'unknown-event', id: 'u1', seq: 9, time: T, eventType: 'plugin/boot' },
			{ kind: 'turn-error', id: 'e1', seq: 10, time: T, message: 'x' }
		];
		const { target, unmount } = render({ entries, peekOpen: true });
		const rows = [...target.querySelectorAll('[data-testid="tool-peek-list"] li')];
		expect(rows).toHaveLength(6); // every chip, messages aside

		const label = (i: number): string => (rows[i].querySelector('.font-mono') as HTMLElement).textContent ?? '';
		const dot = (i: number): string => (rows[i].querySelector('span.rounded-full') as HTMLElement).className;

		expect(label(0)).toBe('Bash'); // toolTitle: wire name → BC-F title
		expect(dot(0)).toContain('bg-status-pass/100'); // pass
		expect(label(1)).toBe('Read');
		expect(dot(1)).toContain('bg-status-fail'); // fail
		expect(label(2)).toBe('Write');
		expect(dot(2)).toContain('bg-status-pending'); // pending
		expect(label(2)).not.toContain('Write{'); // args preview is a sibling span, never the label
		expect(rows[2].textContent).toContain('/tmp/x'); // extractArgsPreview output
		expect(label(3)).toBe('result · Bash');
		expect(dot(3)).toContain('bg-status-fail'); // failed result
		expect(label(4)).toBe('event · plugin/boot');
		expect(dot(4)).toContain('bg-surface-border');
		expect(label(5)).toBe('turn failed'); // no code → bare label
		expect(dot(5)).toContain('bg-status-fail');
		unmount();
	});

	it('a turn error with a code names it; a reasoning message never peeks as a row', () => {
		const entries: AssistantSideEntry[] = [
			msg({ id: 'm1', reasoning: 'deep', text: '' }),
			{ kind: 'turn-error', id: 'e1', seq: 10, time: T, message: 'x', code: 'MISSING_CREDENTIAL' }
		];
		const { target, unmount } = render({ entries, peekOpen: true });
		const rows = [...target.querySelectorAll('[data-testid="tool-peek-list"] li')];
		expect(rows).toHaveLength(1); // the message is not a peek row
		expect((rows[0].querySelector('.font-mono') as HTMLElement).textContent).toBe('turn failed · MISSING_CREDENTIAL');
		unmount();
	});

	it('no popup renders while closed', () => {
		const { target, unmount } = render({ entries: [call()], peekOpen: false });
		expect(target.querySelector('[data-testid="tool-peek-list"]')).toBeNull();
		unmount();
	});
});

describe('InlineToolCalls — open-chip detail popup', () => {
	it('an open reasoning chip renders its markdown body', () => {
		const { target, unmount } = render({
			entries: [msg({ id: 'm1', reasoning: 'It is **so**', text: '' })],
			openChipId: 'r:m1'
		});
		const body = target.querySelector('[data-testid="reasoning-body"]') as HTMLElement;
		expect(body).not.toBeNull();
		expect(body.querySelector('strong')?.textContent).toBe('so');
		unmount();
	});

	it('an open call pairs its plain result across runs (allEntries): args + result panes, default cap', () => {
		const entries: AssistantSideEntry[] = [call({ id: 'c1', argsRaw: '{"command":"cat a.ts"}' })];
		const all: DsiEntry[] = [
			...entries,
			result({ id: 'r-outside', callId: 'call-1', resultText: 'const a = 1;' })
		];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		const popup = target.querySelector('[data-testid="chip-popup"]') as HTMLElement;
		expect(popup.className).toContain('max-h-80'); // default cap — no read view
		expect(target.querySelector('[data-testid="tool-chip-args"]')?.textContent).toContain('cat a.ts');
		expect(target.querySelector('[data-testid="tool-chip-result"]')?.textContent).toContain('const a = 1;');
		unmount();
	});

	it('a paired result WITH a read view swaps the panes for FileContentViewer and grows the popup', () => {
		const entries: AssistantSideEntry[] = [call({ id: 'c1', argsRaw: '{"command":"cat a.ts"}' })];
		const all: DsiEntry[] = [
			...entries,
			result({ id: 'r-outside', callId: 'call-1', resultText: 'const a = 1;', readView: readView() })
		];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		const popup = target.querySelector('[data-testid="chip-popup"]') as HTMLElement;
		expect(popup.className).toContain('max-h-[28rem]'); // read-view cap
		expect(target.querySelector('[data-testid="file-content-viewer"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="file-viewer-header"]')?.textContent).toContain('a.ts'); // basename
		expect(target.querySelector('[data-testid="tool-chip-args"]')).toBeNull(); // panes replaced
		unmount();
	});

	it('an open unknown-event renders its verbatim payload as JSON (the 2026-09-18 empty-popup fix)', () => {
		// workspace/changes · deliverables/presented: mapped-by-nobody types
		// opened an EMPTY ChipPopup before — the body never had a branch.
		const entries = [
			{ kind: 'unknown-event', id: 'u1', seq: 9, time: T, eventType: 'workspace/changes', payload: { changed: ['a.ts'] } }
		] as unknown as AssistantSideEntry[];
		const { target, unmount } = render({ entries, openChipId: 'u1' });
		const body = target.querySelector('[data-testid="unknown-event-body"]');
		expect(body).not.toBeNull();
		expect(body?.textContent).toContain('workspace/changes');
		expect(body?.textContent).toContain('"changed"');
		expect(body?.textContent).toContain('a.ts');
		unmount();
	});

	it('an open unknown-event WITHOUT a payload shows the honest no-payload note, never a blank popup', () => {
		const entries = [
			{ kind: 'unknown-event', id: 'u2', seq: 10, time: T, eventType: 'plugin/frobnicated' }
		] as unknown as AssistantSideEntry[];
		const { target, unmount } = render({ entries, openChipId: 'u2' });
		const body = target.querySelector('[data-testid="unknown-event-body"]');
		expect(body).not.toBeNull();
		expect(body?.textContent).toContain('plugin/frobnicated');
		expect(body?.textContent).not.toBe('');
		unmount();
	});

	it('a call without any paired result renders args + summary only (default cap)', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', argsRaw: '{"a":1}', summary: 'ran ls' })],
			allEntries: [call({ id: 'c1', argsRaw: '{"a":1}', summary: 'ran ls' })],
			openChipId: 'c1'
		});
		const popup = target.querySelector('[data-testid="chip-popup"]') as HTMLElement;
		expect(popup.className).toContain('max-h-80'); // default cap — no read view
		expect(target.querySelector('[data-testid="tool-chip-result"]')).toBeNull();
		expect(target.querySelector('[data-testid="tool-chip-args"]')).not.toBeNull();
		unmount();
	});

	it('junk argsRaw fall back to the raw view, never throw', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', argsRaw: '{not json' })],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="chip-popup"]')).not.toBeNull();
		expect(target.textContent).toContain('{not json');
		unmount();
	});

	it('an open result chip renders its own result pane; a read view swaps to the file viewer', () => {
		const plain = render({
			entries: [result({ id: 'r1', resultText: 'done' })],
			openChipId: 'r1'
		});
		expect(plain.target.querySelector('[data-testid="tool-chip-result"]')?.textContent).toContain('done');
		plain.unmount();

		const reader = render({
			entries: [result({ id: 'r1', resultText: 'const a = 1;', readView: readView() })],
			openChipId: 'r1'
		});
		expect(reader.target.querySelector('[data-testid="file-content-viewer"]')).not.toBeNull();
		expect(reader.target.querySelector('[data-testid="tool-chip-result"]')).toBeNull();
		reader.unmount();
	});

	it('an open turn-error chip shows the verbatim message and its code', () => {
		const withCode = render({
			entries: [{ kind: 'turn-error', id: 'e1', seq: 10, time: T, message: 'credentials missing', code: 'NO_AUTH' }],
			openChipId: 'e1'
		});
		const body = withCode.target.querySelector('[data-testid="turn-error-body"]') as HTMLElement;
		expect(body.textContent).toContain('credentials missing');
		expect(body.textContent).toContain('code: NO_AUTH');
		withCode.unmount();

		const bare = render({
			entries: [{ kind: 'turn-error', id: 'e1', seq: 10, time: T, message: 'fell over' }],
			openChipId: 'e1'
		});
		expect(bare.target.querySelector('[data-testid="turn-error-body"]')?.textContent).toContain('fell over');
		expect(bare.target.querySelector('[data-testid="turn-error-body"]')?.textContent).not.toContain('code:');
		bare.unmount();
	});

	it('no detail popup while nothing in this run is open', () => {
		const { target, unmount } = render({ entries: [call({ id: 'c1' })], openChipId: 'other-id' });
		expect(target.querySelector('[data-testid="chip-popup"]')).toBeNull();
		unmount();
	});
});

describe('InlineToolCalls — goal tools render as GoalCard (both sides)', () => {
	const goalCreateArgs = JSON.stringify({ objective: 'Fix the filter row', max_goal_rounds: 8 });
	const goalResultText = JSON.stringify({
		goal: {
			id: 'goal-05e8d12e-7334-4580-b5f9-44c959e17c91',
			revision: 2,
			objective: 'Fix the filter row',
			phase: 'active',
			roundsStarted: 0,
			maxGoalRounds: 8
		},
		activation: 'armed'
	});

	it('open call + paired result → the compact card: objective ONCE, badges, no raw panes', () => {
		const entries: AssistantSideEntry[] = [call({ id: 'c1', toolName: 'create_goal', argsRaw: goalCreateArgs })];
		const all: DsiEntry[] = [...entries, result({ id: 'r1', toolName: 'create_goal', callId: 'call-1', resultText: goalResultText })];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		expect(target.querySelector('[data-testid="goal-card"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="goal-card-title"]')?.textContent).toBe('Goal created');
		expect(target.querySelector('[data-testid="goal-phase"]')?.textContent).toBe('active');
		expect(target.querySelector('[data-testid="goal-activation"]')?.textContent).toBe('armed');
		// the result repeats the objective verbatim — the card shows it ONCE
		expect(target.querySelectorAll('[data-testid="goal-objective"]')).toHaveLength(1);
		expect(target.querySelector('[data-testid="goal-meta"]')?.textContent).toContain('rev 2');
		expect(target.querySelector('[data-testid="goal-meta"]')?.textContent).toContain('round 0/8');
		expect(target.querySelector('[data-testid="tool-chip-args"]')).toBeNull(); // raw JSON replaced
		expect(target.querySelector('[data-testid="goal-raw-args"]')).toBeNull(); // and hidden until toggled
		unmount();
	});

	it('the raw JSON toggle discloses the verbatim wire text', () => {
		const entries: AssistantSideEntry[] = [call({ id: 'c1', toolName: 'create_goal', argsRaw: goalCreateArgs })];
		const all: DsiEntry[] = [...entries, result({ id: 'r1', toolName: 'create_goal', callId: 'call-1', resultText: goalResultText })];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		(target.querySelector('[data-testid="goal-raw-toggle"]') as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="goal-raw-args"]')?.textContent).toContain('max_goal_rounds');
		expect(target.querySelector('[data-testid="goal-raw-result"]')?.textContent).toContain('maxGoalRounds');
		unmount();
	});

	it('a pending create (no result yet) renders the args-only card: verb + cap, no phase badge', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'create_goal', argsRaw: goalCreateArgs })],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="goal-card-title"]')?.textContent).toBe('Goal created');
		expect(target.querySelector('[data-testid="goal-phase"]')).toBeNull();
		expect(target.querySelector('[data-testid="goal-objective"]')?.textContent).toContain('Fix the filter row');
		expect(target.querySelector('[data-testid="goal-meta"]')?.textContent).toContain('cap 8');
		unmount();
	});

	it('an update_goal complete renders its action verb and the completed phase', () => {
		const entries: AssistantSideEntry[] = [
			call({ id: 'c1', toolName: 'update_goal', argsRaw: JSON.stringify({ goal_id: 'goal-05e8d12e-7334-4580-b5f9-44c959e17c91', revision: 2, action: 'complete' }) })
		];
		const all: DsiEntry[] = [
			...entries,
			result({
				id: 'r1',
				toolName: 'update_goal',
				callId: 'call-1',
				resultText: JSON.stringify({
					goal: { id: 'goal-05e8d12e-7334-4580-b5f9-44c959e17c91', revision: 3, objective: 'Fix the filter row', phase: 'complete', roundsStarted: 0, maxGoalRounds: 8 },
					activation: 'disarmed'
				})
			})
		];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		expect(target.querySelector('[data-testid="goal-card-title"]')?.textContent).toBe('Goal completed');
		expect(target.querySelector('[data-testid="goal-phase"]')?.getAttribute('data-phase')).toBe('complete');
		expect(target.querySelector('[data-testid="goal-blocked"]')).toBeNull();
		unmount();
	});

	it('a blocked result renders its reason line', () => {
		const entries: AssistantSideEntry[] = [result({
			id: 'r1',
			toolName: 'update_goal',
			callId: 'call-1',
			resultText: JSON.stringify({
				goal: { id: 'g1', revision: 4, objective: 'o', phase: 'blocked', roundsStarted: 3, maxGoalRounds: 8, blockedReason: { code: 'NO_KEY', message: 'missing key' } },
				activation: 'disarmed'
			})
		})];
		const { target, unmount } = render({ entries, openChipId: 'r1' });
		expect(target.querySelector('[data-testid="goal-blocked"]')?.textContent).toContain('NO_KEY — missing key');
		unmount();
	});

	it('open result side pairs BACK to the call for verb and args', () => {
		const entries: AssistantSideEntry[] = [result({ id: 'r1', toolName: 'get_goal', callId: 'call-1', resultText: goalResultText })];
		const all: DsiEntry[] = [call({ id: 'c1', toolName: 'get_goal', callId: 'call-1', argsRaw: '{}' }), ...entries];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'r1' });
		expect(target.querySelector('[data-testid="goal-card-title"]')?.textContent).toBe('Goal'); // get has no verb
		expect(target.querySelector('[data-testid="goal-objective"]')?.textContent).toContain('Fix the filter row');
		unmount();
	});

	it('a {"goal":null} result reads as the honest empty state', () => {
		const { target, unmount } = render({
			entries: [result({ id: 'r1', toolName: 'get_goal', callId: 'call-1', resultText: '{"goal":null}' })],
			openChipId: 'r1'
		});
		expect(target.querySelector('[data-testid="goal-empty"]')?.textContent).toBe('No goal set');
		expect(target.querySelector('[data-testid="goal-objective"]')).toBeNull();
		unmount();
	});

	it('junk payloads on both sides fall back to the plain raw panes (no card chrome)', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'create_goal', argsRaw: '{not json' })],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="goal-card"]')).toBeNull();
		expect(target.querySelector('[data-testid="goal-raw-args"]')?.textContent).toContain('{not json');
		expect(target.querySelector('[data-testid="goal-raw-toggle"]')).toBeNull();
		unmount();
	});
});

describe('InlineToolCalls — run_code renders as CodeCard (both sides)', () => {
	const rcCode = [
		'const f = await tools.read({ file_path: "/a/b/InlineToolCalls.svelte" });',
		'const g = await tools.grep({ pattern: "ToolCallDetail", path: "/src" });',
		'console.log(g.matches.length);'
	].join('\n');
	const rcArgs = JSON.stringify({ description: 'Read InlineToolCalls and find usages', code: rcCode });

	it('open call + paired result → plan card: title, strip, code, result pane; raw hidden', () => {
		const entries: AssistantSideEntry[] = [call({ id: 'c1', toolName: 'run_code', argsRaw: rcArgs })];
		const all: DsiEntry[] = [...entries, result({ id: 'r1', toolName: 'run_code', callId: 'call-1', resultText: '3 matches' })];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		expect(target.querySelector('[data-testid="code-card"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="code-card-title"]')?.textContent).toContain('Read InlineToolCalls and find usages');
		const plan = target.querySelector('[data-testid="code-plan"]') as HTMLElement;
		expect(plan.textContent).toContain('Read');
		expect(plan.textContent).toContain('InlineToolCalls.svelte');
		expect(plan.textContent).toContain('Search'); // chip variant title for grep
		expect(plan.textContent).toContain('ToolCallDetail');
		const code = target.querySelector('[data-testid="code-block"]') as HTMLElement;
		expect(code.textContent).toContain('tools.read'); // the CODE, not the JSON blob
		expect(code.querySelector('code.hljs')).not.toBeNull(); // highlighted
		// D6 footer (2026-09-05): the model's own output collapses by default…
		expect(target.querySelector('[data-testid="code-result-pane"]')).toBeNull();
		const footer = target.querySelector('[data-testid="code-result-footer-toggle"]') as HTMLElement;
		expect(footer).not.toBeNull();
		footer.click(); // …and expands on demand, keeping the curated output
		flushSync();
		expect(target.querySelector('[data-testid="code-result-pane"]')?.textContent).toContain('3 matches');
		expect(target.querySelector('[data-testid="tool-chip-args"]')).toBeNull(); // raw JSON replaced
		expect(target.querySelector('[data-testid="code-raw-args"]')).toBeNull(); // and hidden until toggled
		expect(target.querySelector('[data-testid="chip-popup"]')?.className).toContain('max-h-[28rem]'); // tall cap
		unmount();
	});

	it('the raw JSON toggle discloses the verbatim wire text', () => {
		const entries: AssistantSideEntry[] = [call({ id: 'c1', toolName: 'run_code', argsRaw: rcArgs })];
		const all: DsiEntry[] = [...entries, result({ id: 'r1', toolName: 'run_code', callId: 'call-1', resultText: '3 matches' })];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		(target.querySelector('[data-testid="code-raw-toggle"]') as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="code-raw-args"]')?.textContent).toContain('description'); // verbatim wire text
		unmount();
	});

	it('a pending program (no result yet) renders the card without a result pane', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'run_code', argsRaw: rcArgs })],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="code-card"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="code-result-pane"]')).toBeNull();
		unmount();
	});

	it('open result side pairs BACK to the call for the program', () => {
		const entries: AssistantSideEntry[] = [result({ id: 'r1', toolName: 'run_code', callId: 'call-1', resultText: '3 matches' })];
		const all: DsiEntry[] = [call({ id: 'c1', toolName: 'run_code', callId: 'call-1', argsRaw: rcArgs }), ...entries];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'r1' });
		expect(target.querySelector('[data-testid="code-card-title"]')?.textContent).toContain('Read InlineToolCalls and find usages');
		expect(target.querySelector('[data-testid="code-block"]')).not.toBeNull();
		unmount();
	});

	it('junk args fall back to the plain raw panes (no card chrome)', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'run_code', argsRaw: '{not json' })],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="code-card"]')).toBeNull();
		expect(target.querySelector('[data-testid="code-raw-args"]')?.textContent).toContain('{not json');
		expect(target.querySelector('[data-testid="code-raw-toggle"]')).toBeNull();
		unmount();
	});

	it('the peek list shows the description, never the code head', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'run_code', argsRaw: rcArgs })],
			peekOpen: true
		});
		const row = target.querySelector('[data-testid="tool-peek-list"] li') as HTMLElement;
		expect(row.textContent).toContain('Read InlineToolCalls and find usages');
		expect(row.textContent).not.toContain('const f = await');
		unmount();
	});

	it('a description-less program (the schema-error retries) peeks as its first plan step', () => {
		// session 1fe381df seq 541: no description member, red result —
		// the peek row shows `Bash pwd; echo ---…`, not the escaped code head.
		const command = 'pwd; echo ---; ls -la ~/agentic-ai 2>/dev/null | head -30; echo ---; ls ~/openclaw-insight';
		const args = JSON.stringify({
			code: `const r = await tools.bash({ command: "${command}" });`
		});
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'run_code', argsRaw: args, status: 'fail' })],
			peekOpen: true
		});
		const row = target.querySelector('[data-testid="tool-peek-list"] li') as HTMLElement;
		expect(row.textContent).toContain('Bash ' + command); // full width — under the 120 peek cap, no early ellipsis
		expect(row.textContent).not.toContain('const r = await');
		expect(row.textContent).not.toContain('"command"');
		// the preview span must be able to shrink (min-w-0) so break-all
		// wraps instead of clipping at the popup edge
		const previewSpan = row.querySelector('span.break-all') as HTMLElement;
		expect(previewSpan.className).toContain('min-w-0');
		unmount();
	});

	it('a huge program collapses at 40 lines with a disclosure toggle', () => {
		const bigCode = Array.from({ length: 55 }, (_, i) => `console.log(${i});`).join('\n');
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'run_code', argsRaw: JSON.stringify({ code: bigCode }) })],
			openChipId: 'c1'
		});
		const block = target.querySelector('[data-testid="code-block"]') as HTMLElement;
		expect(block.textContent).toContain('console.log(39);');
		expect(block.textContent).not.toContain('console.log(40);');
		const toggle = target.querySelector('[data-testid="code-block-toggle"]') as HTMLElement;
		expect(toggle.textContent).toContain('show all 55 lines');
		toggle.click();
		flushSync();
		expect(block.textContent).toContain('console.log(54);');
		unmount();
	});

	it('the plan strip caps its args at 60 — the peek row (120) and code block carry more', () => {
		const long = 'x'.repeat(80);
		const args = JSON.stringify({
			code: `await tools.bash({ command: "${long}" });`
		});
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'run_code', argsRaw: args })],
			openChipId: 'c1'
		});
		const plan = target.querySelector('[data-testid="code-plan"]') as HTMLElement;
		expect(plan.textContent).toContain('x'.repeat(60) + '…');
		expect(plan.textContent).not.toContain('x'.repeat(61));
		unmount();
	});
});

describe('InlineToolCalls — todo_write renders as TodoCard (both sides)', () => {
	/** Session 2758c928 epoch-1 texts, statuses per snapshot. */
	const todoTexts = [
		'Create stick-to-bottom primitive',
		'Expose scroller',
		'Apply to think popup',
		'Refactor scroll area',
		'Tests',
		'Verify'
	];
	const twArgs = (statuses: string[]): string =>
		JSON.stringify({ todos: todoTexts.map((content, i) => ({ content, status: statuses[i] })) });

	it('open call renders checkbox rows, header, digest footer; raw hidden', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'todo_write', argsRaw: twArgs(['completed', 'completed', 'completed', 'in_progress', 'pending', 'pending']) })],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="todo-card"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="todo-card-title"]')?.textContent).toContain('3/6 done');
		expect(target.querySelectorAll('[data-testid="todo-row"]')).toHaveLength(6);
		expect(target.querySelector('[data-testid="todo-raw-args"]')).toBeNull(); // hidden until toggled
		unmount();
	});

	it('delta mode: previous snapshot in allEntries accents just-completed and active', () => {
		const prev = call({ id: 'c0', seq: 10, toolName: 'todo_write', argsRaw: twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']) });
		const cur = call({ id: 'c1', seq: 20, toolName: 'todo_write', argsRaw: twArgs(['completed', 'completed', 'in_progress', 'pending', 'pending', 'pending']) });
		const { target, unmount } = render({
			entries: [cur],
			allEntries: [prev, cur],
			openChipId: 'c1'
		});
		const rows = [...target.querySelectorAll('[data-testid="todo-row"]')];
		expect(rows[0]?.getAttribute('data-delta')).toBe('just-completed');
		expect(rows[1]?.getAttribute('data-delta')).toBe('just-completed');
		expect(rows[2]?.getAttribute('data-delta')).toBe('now-active');
		expect(rows[3]?.getAttribute('data-delta')).toBe('');
		expect(target.querySelector('[data-testid="todo-new-plan"]')).toBeNull(); // same texts → delta mode
		unmount();
	});

	it('a rewritten plan (different texts) shows the new-plan badge, no deltas', () => {
		const prev = call({ id: 'c0', seq: 10, toolName: 'todo_write', argsRaw: twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']) });
		const cur = call({ id: 'c1', seq: 20, toolName: 'todo_write', argsRaw: JSON.stringify({ todos: [{ content: 'Coverage push', status: 'in_progress' }] }) });
		const { target, unmount } = render({
			entries: [cur],
			allEntries: [prev, cur],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="todo-new-plan"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="todo-row"]')?.getAttribute('data-delta')).toBe('');
		unmount();
	});

	it('the first snapshot of a plan (no previous) renders plain — no badge, no deltas', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'todo_write', argsRaw: twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']) })],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="todo-new-plan"]')).toBeNull();
		expect(target.querySelector('[data-testid="todo-row"]')?.getAttribute('data-delta')).toBe('');
		unmount();
		
	});

	it('result side pairs back to the call and shows the digest as footer', () => {
		const entries: AssistantSideEntry[] = [result({ id: 'r1', toolName: 'todo_write', callId: 'call-1', resultText: 'Updated todo list: 3 pending, 1 in progress, 2 completed.' })];
		const all: DsiEntry[] = [call({ id: 'c1', toolName: 'todo_write', callId: 'call-1', argsRaw: twArgs(['completed', 'completed', 'in_progress', 'pending', 'pending', 'pending']) }), ...entries];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'r1' });
		expect(target.querySelector('[data-testid="todo-card"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="todo-digest"]')?.textContent).toContain('Updated todo list');
		unmount();
	});

	it('the raw JSON toggle discloses the verbatim wire text', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'todo_write', argsRaw: twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']) })],
			openChipId: 'c1'
		});
		(target.querySelector('[data-testid="todo-raw-toggle"]') as HTMLElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="todo-raw-args"]')?.textContent).toContain('stick-to-bottom');
		unmount();
	});

	it('junk args fall back to the plain raw panes (no card chrome)', () => {
		const { target, unmount } = render({
			entries: [call({ id: 'c1', toolName: 'todo_write', argsRaw: '{not json' })],
			openChipId: 'c1'
		});
		expect(target.querySelector('[data-testid="todo-card"]')).toBeNull();
		expect(target.querySelector('[data-testid="todo-raw-args"]')?.textContent).toContain('{not json');
		expect(target.querySelector('[data-testid="todo-raw-toggle"]')).toBeNull();
		unmount();
	});

	it('the peek list shows progress + active item, never item one on every row', () => {
		const s1 = render({
			entries: [call({ id: 'c1', toolName: 'todo_write', argsRaw: twArgs(['in_progress', 'pending', 'pending', 'pending', 'pending', 'pending']) })],
			peekOpen: true
		});
		const row1 = s1.target.querySelector('[data-testid="tool-peek-list"] li') as HTMLElement;
		expect(row1.textContent).toContain('0/6 · Create stick-to-bottom primitive');
		s1.unmount();

		const s3 = render({
			entries: [call({ id: 'c1', toolName: 'todo_write', argsRaw: twArgs(['completed', 'completed', 'completed', 'in_progress', 'pending', 'pending']) })],
			peekOpen: true
		});
		const row3 = s3.target.querySelector('[data-testid="tool-peek-list"] li') as HTMLElement;
		expect(row3.textContent).toContain('3/6 · Refactor scroll area');
		s3.unmount();
	});
});

describe('InlineToolCalls — ask_user_question renders as QuestionCard (both sides)', () => {
	const askArgs = JSON.stringify({
		questions: [{ id: 'q1', question: 'Ship it?', options: [{ id: 'o1', label: 'Yes' }, { id: 'o2', label: 'No' }] }]
	});
	const askResultText = JSON.stringify({ answers: [{ id: 'q1', selected: ['o1'], custom: null }] });

	it('open call + answered pair → the designed question card, not raw JSON', () => {
		const entries: AssistantSideEntry[] = [call({ id: 'c1', toolName: 'ask_user_question', argsRaw: askArgs })];
		const all: DsiEntry[] = [...entries, result({ id: 'r1', toolName: 'ask_user_question', callId: 'call-1', resultText: askResultText })];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		const block = target.querySelector('[data-testid="ask-question-block"]') as HTMLElement;
		expect(block).not.toBeNull();
		expect(target.querySelector('[data-testid="question-text"]')?.textContent).toContain('Ship it?');
		expect(target.querySelector('[data-testid="question-settled"]')?.textContent).toContain('o1'); // outcome names the chosen id
		expect(target.querySelector('[data-testid="tool-chip-args"]')).toBeNull(); // raw JSON replaced
		unmount();
	});

	it('open call + pending pair (no resultText) stays on the raw detail view', () => {
		const entries: AssistantSideEntry[] = [call({ id: 'c1', toolName: 'ask_user_question', argsRaw: askArgs })];
		const all: DsiEntry[] = [...entries, result({ id: 'r1', toolName: 'ask_user_question', callId: 'call-1', resultText: undefined })];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'c1' });
		expect(target.querySelector('[data-testid="ask-question-block"]')).toBeNull();
		expect(target.querySelector('[data-testid="tool-chip-args"]')).not.toBeNull();
		unmount();
	});

	it('open result side pairs BACK to the call for the questions', () => {
		const entries: AssistantSideEntry[] = [result({ id: 'r1', toolName: 'ask_user_question', callId: 'call-1', resultText: askResultText })];
		const all: DsiEntry[] = [call({ id: 'c1', toolName: 'ask_user_question', callId: 'call-1', argsRaw: askArgs }), ...entries];
		const { target, unmount } = render({ entries, allEntries: all, openChipId: 'r1' });
		expect(target.querySelector('[data-testid="ask-question-block"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="question-text"]')?.textContent).toContain('Ship it?');
		unmount();
	});
});

describe('InlineToolCalls — think popup stick-to-bottom (2026-08-26)', () => {
	// The think body's popup scroll box carries the shared primitive
	// (utils/stick-to-bottom): opening a STREAMING think lands on the
	// live tail and follows deltas while the reader sits at the bottom;
	// scrolling up releases; returning re-engages. A FINISHED think
	// opens at the top. Driven through ThinkHost (setEntries after
	// mount = streaming growth). Geometry: 100px per rendered paragraph,
	// 50px viewport — the conversation-scroll-area pattern.
	const paras = (n: number): string => Array.from({ length: n }, (_, i) => `thought ${i}`).join('\n\n');

	function renderThink(initial: { paragraphs: number; streaming: boolean }) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(ThinkHost, {
			target,
			props: {
				openChipId: 'r:m1',
				initialEntries: [msg({ id: 'm1', reasoning: paras(initial.paragraphs), reasoningStreaming: initial.streaming, text: '' })]
			}
		});
		const popup = target.querySelector('[data-testid="chip-popup"]') as HTMLElement;
		expect(popup).not.toBeNull();
		Object.defineProperty(popup, 'scrollHeight', {
			configurable: true,
			get: () => Math.max(1, popup.querySelectorAll('p').length) * 100
		});
		Object.defineProperty(popup, 'clientHeight', { configurable: true, get: () => 50 });
		const host = comp as unknown as { setEntries(next: DsiEntry[]): void };
		const grow = (paragraphs: number, streaming: boolean): void =>
			host.setEntries([msg({ id: 'm1', reasoning: paras(paragraphs), reasoningStreaming: streaming, text: '' })]);
		return {
			target,
			popup,
			grow,
			unmount: () => unmount(comp)
		};
	}

	async function flushMicrotasks(): Promise<void> {
		// MutationObserver callbacks are microtasks.
		for (let i = 0; i < 8; i++) {
			flushSync();
			await Promise.resolve();
		}
		flushSync();
	}

	it('a streaming think opens on the live tail and follows each delta', async () => {
		const r = renderThink({ paragraphs: 3, streaming: true });
		await flushMicrotasks();
		expect(r.popup.scrollTop).toBe(300); // landed on the tail at open
		r.grow(4, true);
		await flushMicrotasks();
		expect(r.popup.scrollTop).toBe(400); // followed the delta
		r.unmount();
	});

	it('a finished think opens at the top (read from the beginning)', async () => {
		const r = renderThink({ paragraphs: 3, streaming: false });
		await flushMicrotasks();
		expect(r.popup.scrollTop).toBe(0); // no jump — content is history
		r.unmount();
	});

	it('scrolling up releases — later deltas never yank; returning re-engages', async () => {
		const r = renderThink({ paragraphs: 3, streaming: true });
		await flushMicrotasks();
		r.popup.scrollTop = 50; // 50 + 50 < 300 - 24 → off-bottom (tight band)
		r.popup.dispatchEvent(new Event('scroll', { bubbles: true }));
		flushSync();
		r.grow(4, true);
		await flushMicrotasks();
		expect(r.popup.scrollTop).toBe(50); // reading position honored
		r.popup.scrollTop = 400; // back at the bottom of 4 paragraphs
		r.popup.dispatchEvent(new Event('scroll', { bubbles: true }));
		flushSync();
		r.grow(5, true);
		await flushMicrotasks();
		expect(r.popup.scrollTop).toBe(500); // following again
		r.unmount();
	});

	it('closing and reopening the popup re-engages fresh (jump while live)', async () => {
		const r = renderThink({ paragraphs: 2, streaming: true });
		await flushMicrotasks();
		// Scroll away, then simulate close + reopen: same element rebinds
		// through a fresh mount path — attach resets the pin state.
		r.popup.scrollTop = 0;
		r.popup.dispatchEvent(new Event('scroll', { bubbles: true }));
		flushSync();
		r.grow(3, true);
		await flushMicrotasks();
		expect(r.popup.scrollTop).toBe(0); // released mid-stream
		r.unmount();

		const reopened = renderThink({ paragraphs: 3, streaming: true });
		await flushMicrotasks();
		expect(reopened.popup.scrollTop).toBe(300); // fresh open lands on tail
		reopened.unmount();
	});
});

describe('InlineToolCalls — absorbed context injections (The Turn Kept Whole, D2)', () => {
	it('an absorbed notice renders the attributed chip at its wire position in the row', () => {
		const { target, ontoggleChip, unmount } = render({ entries: [call({ id: 'c1' }), notice({ id: 'j1' }), call({ id: 'c2', seq: 10 })] });
		const chip = target.querySelector('[data-testid="context-injection-chip"][data-producer="plugin"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain('tool-jobs'); // named by the wire plugin string
		// Same page-owned toggle contract as every other chip in the row.
		(chip?.querySelector('[data-testid="context-injection-toggle"]') as HTMLElement).click();
		expect(ontoggleChip).toHaveBeenCalledWith('j1');
		unmount();
	});

	it('the open notice popup shows the verbatim payload (shared context-body testid)', () => {
		const { target, unmount } = render({ entries: [notice({ id: 'j1' })], openChipId: 'j1' });
		const body = target.querySelector('[data-testid="context-injection-body"]');
		expect(body?.textContent).toContain('background job bash-2 finished');
		unmount();
	});

	it('the peek list labels an absorbed notice by its wire name', () => {
		const { target, unmount } = render({ entries: [notice({ id: 'j1' })], peekOpen: true });
		const peekRow = target.querySelector('[data-testid="tool-peek-list"] li');
		expect(peekRow?.textContent).toContain('tool-jobs');
		unmount();
	});
});
