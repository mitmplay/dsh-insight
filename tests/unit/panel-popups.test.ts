/**
 * Popups unit tests — the panel's chip/peek popup state and the
 * think/plan auto-open slots, exercised through the public surface only
 * (autoThinkTargetId, autoThinkId, autoPlanId, toggleChip, togglePeek,
 * destroy). The store and the auto-open-slot helpers are mocked; the
 * sticky plan-adoption effect runs inside the class's own $effect.root.
 *
 * Client-runes module ($state/$effect in popups.svelte.ts) → runs under
 * the 'dom' project (happy-dom + svelte plugin compiles the runes) —
 * deliberately NOT in serverOnlyTestFiles.
 */
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Popups } from '../../src/lib/components/conversation/panel/popups.svelte';
import { StreamStore } from '../stubs/runes-helpers.svelte';

vi.mock('$lib/services/conversation/store.svelte', () => ({ createConversationStore: vi.fn() }));
const { isTodoTool } = vi.hoisted(() => ({
	isTodoTool: vi.fn((e: { kind: string }) => e.kind === 'todo_write')
}));
vi.mock('$lib/utils/todo-lists', () => ({ isTodoTool }));

const { newestReasoningId, newestTodoToolId, suppressed } = vi.hoisted(() => ({
	newestReasoningId: vi.fn(() => null as string | null),
	newestTodoToolId: vi.fn(() => null as string | null),
	// the REAL rule: a target survives unless the user suppressed exactly it
	suppressed: vi.fn(
		(target: string | null, suppressedId: string | null) =>
			target !== null && target !== suppressedId ? target : null
	)
}));
vi.mock('$lib/utils/auto-open-slots', () => ({ newestReasoningId, newestTodoToolId, suppressed }));

type Deps = {
	store: { isStreaming: boolean; renderEntries: Array<{ kind: string; id: string }> };
	get stick(): boolean;
};

function makeDeps({ isStreaming = false, stick = true }: { isStreaming?: boolean; stick?: boolean } = {}): Deps {
	const store = new StreamStore();
	store.isStreaming = isStreaming;
	return {
		store,
		get stick() {
			return stick;
		}
	};
}

function makePopups(opts?: { isStreaming?: boolean; stick?: boolean }) {
	const deps = makeDeps(opts);
	const popups = new Popups(deps as unknown as ConstructorParameters<typeof Popups>[0]);
	flushSync(); // run the scheduled plan-adoption effect once
	return { popups, deps };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Popups auto think slot', () => {
	it('autoThinkTargetId is null while not streaming', () => {
		const { popups } = makePopups({ isStreaming: false });
		expect(popups.autoThinkTargetId).toBeNull();
	});

	it('autoThinkTargetId is null while streaming but not stuck to the live end', () => {
		const { popups } = makePopups({ isStreaming: true, stick: false });
		expect(popups.autoThinkTargetId).toBeNull();
	});

	it('while streaming AND stuck it returns the newest reasoning id', () => {
		newestReasoningId.mockReturnValue('r-1');
		const { popups } = makePopups({ isStreaming: true });
		expect(popups.autoThinkTargetId).toBe('r-1');
		expect(popups.autoThinkId).toBe('r-1');
	});

	it('collapsing the auto-opened think chip suppresses that exact id', () => {
		newestReasoningId.mockReturnValue('r-1');
		const { popups } = makePopups({ isStreaming: true });

		popups.toggleChip('r:r-1', true);
		expect(popups.autoThinkId).toBeNull();

		// a NEWER think id simply stops matching the stale suppression
		newestReasoningId.mockReturnValue('r-2');
		expect(popups.autoThinkId).toBe('r-2');
	});
});

describe('Popups auto plan slot', () => {
	it('adopts the newest todo_write id while streaming AND stuck (sticky)', () => {
		newestTodoToolId.mockReturnValue('t-1');
		const { popups, deps } = makePopups({ isStreaming: true });
		expect(popups.autoPlanId).toBe('t-1');

		// stays adopted when the stream ends — sticky across the turn
		deps.store.isStreaming = false;
		newestTodoToolId.mockReturnValue(null);
		flushSync();
		expect(popups.autoPlanId).toBe('t-1');

		// a newer todo_write supersedes it once streaming again
		deps.store.isStreaming = true;
		newestTodoToolId.mockReturnValue('t-2');
		flushSync();
		expect(popups.autoPlanId).toBe('t-2');
	});

	it('never adopts while unstuck', () => {
		newestTodoToolId.mockReturnValue('t-1');
		const { popups } = makePopups({ isStreaming: true, stick: false });
		expect(popups.autoPlanId).toBeNull();
	});

	it('collapsing the auto-opened plan chip suppresses it until a newer target', () => {
		newestTodoToolId.mockReturnValue('t-1');
		const { popups, deps } = makePopups({ isStreaming: true });

		popups.toggleChip('t-1', true);
		expect(popups.autoPlanId).toBeNull();

		newestTodoToolId.mockReturnValue('t-2');
		deps.store.renderEntries = [{ kind: 'todo_write', id: 't-2' }]; // tracked dep nudge
		flushSync();
		expect(popups.autoPlanId).toBe('t-2');
	});

	it('destroy() stops the adoption effect — no updates after unmount', () => {
		newestTodoToolId.mockReturnValue('t-1');
		const { popups, deps } = makePopups({ isStreaming: true });
		popups.destroy();

		deps.store.isStreaming = false;
		newestTodoToolId.mockReturnValue('t-9');
		flushSync();
		expect(popups.autoPlanId).toBe('t-1'); // frozen at destroy-time adoption
	});
});

describe('Popups chip/peek state', () => {
	it('toggleChip opens one chip and toggles it closed', () => {
		const { popups } = makePopups();
		popups.toggleChip('e1');
		expect(popups.openChipId).toBe('e1');
		popups.toggleChip('e1');
		expect(popups.openChipId).toBeNull();
	});

	it('toggleChip moves the single open slot to the new chip', () => {
		const { popups } = makePopups();
		popups.toggleChip('e1');
		popups.toggleChip('e2');
		expect(popups.openChipId).toBe('e2');
	});

	it('toggleChip closes any open peek — chip expansion and peek are exclusive', () => {
		const { popups } = makePopups();
		popups.togglePeek('run-1');
		expect(popups.peekOpenRunKey).toBe('run-1');
		popups.toggleChip('e1');
		expect(popups.peekOpenRunKey).toBeNull();
		expect(popups.openChipId).toBe('e1');
	});

	it('autoOpen toggleChip never opens the chip detail', () => {
		const { popups } = makePopups();
		popups.toggleChip('anything', true);
		expect(popups.openChipId).toBeNull();
	});

	it('togglePeek opens one run key and toggles it closed', () => {
		const { popups } = makePopups();
		popups.togglePeek('run-1');
		expect(popups.peekOpenRunKey).toBe('run-1');
		popups.togglePeek('run-1');
		expect(popups.peekOpenRunKey).toBeNull();
	});

	it('togglePeek closes any open chip detail', () => {
		const { popups } = makePopups();
		popups.toggleChip('e1');
		popups.togglePeek('run-1');
		expect(popups.openChipId).toBeNull();
		expect(popups.peekOpenRunKey).toBe('run-1');
	});
});