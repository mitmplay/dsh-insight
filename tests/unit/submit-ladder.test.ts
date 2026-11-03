/**
 * SubmitLadder unit tests — the panel's submit/cancel ladder + command
 * banner, exercised through its public surface only (onsubmit, oncancel,
 * onpickcommand, noteCommand/commandNote). All module deps are mocked;
 * the class is constructed directly with a plain deps object (BC-2's
 * injected live accessors read at call time).
 *
 * This is a client-runes module (`$state` in submit-ladder.svelte.ts), so
 * it runs under the 'dom' project (happy-dom + svelte plugin compiles the
 * runes) — deliberately NOT in serverOnlyTestFiles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubmitLadder, type PanelExecutorCtx } from '../../src/lib/components/conversation/panel/submit-ladder.svelte';
import type { SlashDirectory } from '../../src/lib/services/chat/slash-directory.svelte';

const { executeCommand, executeHostCommand, resolveHostCommand, sendPrompt } = vi.hoisted(() => ({
	executeCommand: vi.fn(),
	executeHostCommand: vi.fn(),
	resolveHostCommand: vi.fn(),
	sendPrompt: vi.fn()
}));
const { parseCommand } = vi.hoisted(() => ({ parseCommand: vi.fn() }));
const { createPollingOrchestrator } = vi.hoisted(() => ({
	createPollingOrchestrator: vi.fn()
}));
const { TYPED_DRAFT_ID } = vi.hoisted(() => ({ TYPED_DRAFT_ID: -7 }));
const { isTypedRun } = vi.hoisted(() => ({ isTypedRun: vi.fn() }));

vi.mock('$lib/services/chat/command-executor', () => ({
	executeCommand,
	executeHostCommand,
	resolveHostCommand,
	sendPrompt
}));
vi.mock('$lib/services/chat/command-parser', () => ({ parseCommand }));
vi.mock('$lib/services/conversation/polling-orchestrator.svelte', () => ({
	createPollingOrchestrator
}));
vi.mock('$lib/services/chat/macro-runner.svelte', () => ({ TYPED_DRAFT_ID }));
vi.mock('$lib/services/chat/macro-sections', () => ({ isTypedRun }));

type Image = { mediaType: string; data: string; name?: string };

const NO_IMAGES: Image[] = [];

const ctx: PanelExecutorCtx = {
	sessionId: 'sess-1',
	workspace: '/tmp/ws',
	agent: 'claude',
	panelId: 'panel-9',
	entries: []
};

const readyCatalog = { state: 'ready', commands: [] } as unknown as SlashDirectory;

function makeLadder(overrides: Partial<Parameters<typeof buildDeps>[0]> = {}) {
	const deps = buildDeps(overrides);
	return { ladder: new SubmitLadder(deps), deps };
}

function buildDeps({
	orchestrator,
	slashCatalog,
	ctx: ctxFn,
	startMacro
}: {
	orchestrator?: ReturnType<typeof fakeOrchestrator>;
	slashCatalog?: SlashDirectory | null;
	ctx?: () => PanelExecutorCtx;
	startMacro?: (row: { text: string; id: number }, held: boolean) => void;
} = {}) {
	return {
		ctx: ctxFn ?? (() => ctx),
		orchestrator: orchestrator ?? fakeOrchestrator(),
		get slashCatalog() {
			return slashCatalog !== undefined ? slashCatalog : readyCatalog;
		},
		startMacro: startMacro ?? vi.fn()
	};
}

function fakeOrchestrator() {
	return {
		start: vi.fn(async () => undefined),
		stop: vi.fn(() => undefined),
		poll: vi.fn(async () => undefined),
		resync: vi.fn(async () => undefined),
		submit: vi.fn(async () => undefined),
		cancel: vi.fn(async () => undefined),
		respond: vi.fn(async () => undefined),
		get running() {
			return false;
		}
	} as unknown as ReturnType<typeof createPollingOrchestrator>;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('SubmitLadder', () => {
	it('onsubmit: typed run routes to startMacro with the synthetic row and returns true', async () => {
		isTypedRun.mockReturnValue(true);
		const text = '/a\n/b';
		const startMacro = vi.fn();
		const { ladder } = makeLadder({ startMacro });

		await expect(ladder.onsubmit(text, NO_IMAGES)).resolves.toBe(true);

		expect(startMacro).toHaveBeenCalledExactlyOnceWith({ text, id: TYPED_DRAFT_ID }, false);
		// routed BEFORE parseCommand — the D3 ordering contract
		expect(parseCommand).not.toHaveBeenCalled();
		expect(sendPrompt).not.toHaveBeenCalled();
	});

	it('onsubmit: slash command executes with ctx and onNote; unfired note falls back to the result note', async () => {
		isTypedRun.mockReturnValue(false);
		const command = { name: 'new', args: '' };
		parseCommand.mockReturnValue(command);
		// executeCommand never fires onNote -> the final result note must fire
		executeCommand.mockResolvedValue({ ok: true, note: 'created sess-2' });
		const { ladder } = makeLadder();

		await expect(ladder.onsubmit('/new', NO_IMAGES)).resolves.toBe(true);

		expect(executeCommand).toHaveBeenCalledExactlyOnceWith(command, ctx, expect.any(Function));
		expect(ladder.commandNote).toEqual({ kind: 'ok', text: 'created sess-2' });
		expect(sendPrompt).not.toHaveBeenCalled();
	});

	it('onsubmit: slash command — in-flight onNote dedupes the final result note', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue({ name: 'permission', args: '' });
		let capturedOnNote: ((ok: boolean, note: string) => void) | undefined;
		executeCommand.mockImplementation(async (_c, _ctx, onNote) => {
			onNote(true, 'mentioned'); // banner at its original point
			return { ok: true, note: 'result note' };
		});
		const { ladder } = makeLadder();

		await expect(ladder.onsubmit('/permission', NO_IMAGES)).resolves.toBe(true);

		expect(ladder.commandNote).toEqual({ kind: 'ok', text: 'mentioned' });
	});

	it('onsubmit: error in-flight onNote wins over an ok result note', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue({ name: 'x', args: '' });
		executeCommand.mockImplementation(async (_c, _ctx, onNote) => {
			onNote(false, 'boom');
			return { ok: false, note: 'boom (final)' };
		});
		const { ladder } = makeLadder();

		await ladder.onsubmit('/x', NO_IMAGES);

		expect(ladder.commandNote).toEqual({ kind: 'error', text: 'boom' });
	});

	it('noteCommand sets the banner and auto-clears after 5s', async () => {
		vi.useFakeTimers();
		const { ladder } = makeLadder();

		ladder.noteCommand('ok', 'hi');
		expect(ladder.commandNote).toEqual({ kind: 'ok', text: 'hi' });

		await vi.advanceTimersByTimeAsync(4_999);
		expect(ladder.commandNote).toEqual({ kind: 'ok', text: 'hi' });

		await vi.advanceTimersByTimeAsync(1);
		expect(ladder.commandNote).toBeNull();
	});

	it('noteCommand replaces a pending timer — the newer note owns the 5s window', async () => {
		vi.useFakeTimers();
		const { ladder } = makeLadder();

		ladder.noteCommand('ok', 'first');
		await vi.advanceTimersByTimeAsync(3_000);
		ladder.noteCommand('error', 'second');

		await vi.advanceTimersByTimeAsync(2_000); // first's original deadline
		expect(ladder.commandNote).toEqual({ kind: 'error', text: 'second' });

		await vi.advanceTimersByTimeAsync(3_000);
		expect(ladder.commandNote).toBeNull();
	});

	it('onsubmit: empty text and no images returns false without touching any rung', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue(null);
		const { ladder, deps } = makeLadder({ slashCatalog: null });

		await expect(ladder.onsubmit('   \n\t', NO_IMAGES)).resolves.toBe(false);
		expect(resolveHostCommand).not.toHaveBeenCalled();
		expect(sendPrompt).not.toHaveBeenCalled();
		expect(deps.orchestrator.submit).not.toHaveBeenCalled();
	});

	it('onsubmit: slash-catalog hit executes the host command and returns result.ok', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue(null);
		resolveHostCommand.mockReturnValue({ id: 'clear' });
		executeHostCommand.mockImplementation(async (_l, _c, onNote) => {
			onNote(true, 'cleared');
			return { ok: true, note: 'cleared' };
		});
		const { ladder } = makeLadder();

		await expect(ladder.onsubmit('/clear args', NO_IMAGES)).resolves.toBe(true);

		expect(resolveHostCommand).toHaveBeenCalledExactlyOnceWith('/clear args', readyCatalog.commands);
		expect(executeHostCommand).toHaveBeenCalledExactlyOnceWith('/clear args', ctx, expect.any(Function));
		expect(ladder.commandNote).toEqual({ kind: 'ok', text: 'cleared' });
		expect(sendPrompt).not.toHaveBeenCalled();
	});

	it('onsubmit: host-command miss falls through to the ordinary send', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue(null);
		resolveHostCommand.mockReturnValue(null);
		sendPrompt.mockImplementation(async (_t, _ctx, submit) => {
			await submit('plain text');
			return { ok: true };
		});
		const orchestrator = fakeOrchestrator();
		const { ladder } = makeLadder({ orchestrator });

		await expect(ladder.onsubmit('plain text', NO_IMAGES)).resolves.toBe(true);
		expect(executeHostCommand).not.toHaveBeenCalled();
		// the full LINE reaches sendPrompt; the callback carries it to submit
		expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('plain text', ctx, expect.any(Function));
		expect(orchestrator.submit).toHaveBeenCalledTimes(1);
	});

	it('onsubmit: catalog null skips the slash-catalog rung', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue(null);
		sendPrompt.mockResolvedValue({ ok: true });
		const { ladder } = makeLadder({ slashCatalog: null });

		await expect(ladder.onsubmit('hello', NO_IMAGES)).resolves.toBe(true);
		expect(resolveHostCommand).not.toHaveBeenCalled();
		expect(executeHostCommand).not.toHaveBeenCalled();
		expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('hello', ctx, expect.any(Function));
	});

	it('onsubmit: catalog not-ready skips the slash-catalog rung', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue(null);
		sendPrompt.mockResolvedValue({ ok: false });
		const { ladder } = makeLadder({
			slashCatalog: { state: 'idle' } as unknown as SlashDirectory
		});

		await expect(ladder.onsubmit('hello', NO_IMAGES)).resolves.toBe(false);
		expect(resolveHostCommand).not.toHaveBeenCalled();
	});

	it('onsubmit: ordinary send toggles submitted true during flight and false after', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue(null);
		const seenDuring: boolean[] = [];
		const orchestrator = fakeOrchestrator();
		orchestrator.submit.mockImplementation(async () => {
			seenDuring.push(ladder.submitted); // read INSIDE the flight
		});
		sendPrompt.mockImplementation(async (_t, _ctx, submit) => {
			await submit('text');
			seenDuring.push(ladder.submitted);
			return { ok: true };
		});
		const { ladder } = makeLadder({ orchestrator });

		expect(ladder.submitted).toBe(false);
		await expect(ladder.onsubmit('send me', NO_IMAGES)).resolves.toBe(true);

		expect(seenDuring).toEqual([true, true]);
		expect(ladder.submitted).toBe(false); // finally-reset
		expect(sendPrompt).toHaveBeenCalledExactlyOnceWith('send me', ctx, expect.any(Function));
		expect(orchestrator.submit).toHaveBeenCalledTimes(1);
	});

	it('onsubmit: images ride orchestrator.submit and result.ok drives the return', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue(null);
		const images: Image[] = [{ mediaType: 'image/png', data: 'AAAA', name: 'shot.png' }];
		// the real sendPrompt invokes the submit callback on its wire path
		sendPrompt.mockImplementation(async (t, _ctx, submit) => {
			await submit(t);
			return { ok: false };
		});
		const orchestrator = fakeOrchestrator();
		const { ladder } = makeLadder({ orchestrator });

		await expect(ladder.onsubmit('look', images)).resolves.toBe(false);
		// the captured images array rides the submit callback beside the text
		expect(orchestrator.submit).toHaveBeenCalledExactlyOnceWith('look', images);
	});

	it('onsubmit: sendPrompt throwing resets submitted in the finally and propagates', async () => {
		isTypedRun.mockReturnValue(false);
		parseCommand.mockReturnValue(null);
		sendPrompt.mockRejectedValue(new Error('wire down'));
		const { ladder } = makeLadder();

		await expect(ladder.onsubmit('text', NO_IMAGES)).rejects.toThrow('wire down');
		expect(ladder.submitted).toBe(false);
	});

	it('oncancel awaits the orchestrator cancel', async () => {
		const orchestrator = fakeOrchestrator();
		const { ladder } = makeLadder({ orchestrator });

		await ladder.oncancel();

		expect(orchestrator.cancel).toHaveBeenCalledTimes(1);
	});

	it('onpickcommand executes the host command line and returns result.ok', async () => {
		executeHostCommand.mockImplementation(async (_l, _c, onNote) => {
			onNote(true, 'picked');
			return { ok: true, note: 'picked' };
		});
		const { ladder } = makeLadder();

		await expect(ladder.onpickcommand('/model opus')).resolves.toBe(true);

		expect(executeHostCommand).toHaveBeenCalledExactlyOnceWith('/model opus', ctx, expect.any(Function));
		expect(ladder.commandNote).toEqual({ kind: 'ok', text: 'picked' });
	});

	it('onpickcommand: error result keeps the draft contract (returns false) and banners the error', async () => {
		executeHostCommand.mockImplementation(async (_l, _c, onNote) => {
			onNote(false, 'no such command');
			return { ok: false, note: 'no such command' };
		});
		const { ladder } = makeLadder();

		await expect(ladder.onpickcommand('/nope')).resolves.toBe(false);
		expect(ladder.commandNote).toEqual({ kind: 'error', text: 'no such command' });
	});
});
