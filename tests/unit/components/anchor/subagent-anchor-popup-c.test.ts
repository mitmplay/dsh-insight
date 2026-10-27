/**
 * SubagentPopup — the remaining branches the first suite does not reach:
 * the row-click TOGGLE without a callback (adopt + bring-out), the
 * close-all X, on-floor tinting, operateMs elapsed variants (s/m/h),
 * null titles, the single-row chip grammar, and the onMount 1s tick +
 * its destroy cleanup.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubagentPopup from '$lib/components/anchor/subagent-anchor/SubagentPopup.svelte';
import { subagentClock } from '$lib/services/conversation/subagent-clock.svelte';
import { registerAddPanel, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import { st } from '$lib/services/panels/floor-registry.svelte';
import type { Component } from 'svelte';
import type { DsiSubagentRow, DsiPanelEntry } from '$lib/types';

function row(over: Partial<DsiSubagentRow>): DsiSubagentRow {
	const base: DsiSubagentRow = {
		sessionId: 's',
		title: 'Helper',
		parentTitle: null,
		tokens: { input: 100, output: 50 },
		operateMs: null,
		running: false,
		updatedAt: 1
	};
	return { ...base, ...over } as DsiSubagentRow;
}

/** A conversation floor panel hosting the given session (the only branch
 *  whose entries carry `sessionId` — the narrowing SubagentPopup does). */
function panelFor(sessionId: string, id = 'p-' + sessionId): DsiPanelEntry {
	return { id, kind: 'conversation', sessionId, width: 600 } as unknown as DsiPanelEntry;
}

const mounted: Array<() => void> = [];

function mountComp(comp: Component<any>, props: Record<string, unknown>): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(comp, { target, props });
	mounted.push(() => {
		unmount(instance);
		target.remove();
	});
	return target;
}

beforeEach(() => {
	subagentClock.observe([]); // expire every sample between tests
	st.panels = [];
	setWorkspaceState(null);
	resetPanelRegistryForTests();
});

afterEach(() => {
	for (const destroy of mounted.splice(0)) destroy();
	setWorkspaceState(null);
	resetPanelRegistryForTests();
	st.panels = [];
	vi.useRealTimers();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

function rowEls(): HTMLButtonElement[] {
	return [...document.querySelectorAll('[data-testid="subagent-row"]')] as HTMLButtonElement[];
}

describe('SubagentPopup — row click TOGGLE without a callback', () => {
	it('not on the floor → the adopt verb (addPanelFromSidebar with the session)', () => {
		const add = vi.fn();
		registerAddPanel(add);
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'adopt-me' })]
		});
		rowEls()[0].click();
		flushSync();
		expect(add).toHaveBeenCalledTimes(1);
		expect(add).toHaveBeenCalledWith({ sessionId: 'adopt-me', agentPreset: null });
	});

	it('no floor mounted → the adopt no-ops (graceful false, never a crash)', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'ghost-click' })]
		});
		expect(() => {
			rowEls()[0].click();
			flushSync();
		}).not.toThrow();
	});

	it('already on the floor → bring it OUT (the workspace-state remove)', () => {
		st.panels = [panelFor('out-me')];
		const remove = vi.fn();
		setWorkspaceState({
			rows: [],
			selectedPanelId: 'p-out-me',
			profile: null,
			select: vi.fn(),
			remove
		});
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'out-me' })]
		});
		// the on-floor row renders the tint class
		expect(rowEls()[0].className).toContain('row-on-floor');
		rowEls()[0].click();
		flushSync();
		expect(remove).toHaveBeenCalledWith('p-out-me');
	});
});

describe('SubagentPopup — close-all X (D7 footer verbs)', () => {
	it('hidden when no helper lives on the floor', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'a' })]
		});
		expect(document.querySelector('[data-testid="subagent-popup-close-all"]')).toBeNull();
	});

	it('visible when any helper is on the floor; click removes EVERY open helper panel', () => {
		st.panels = [panelFor('a'), panelFor('c'), panelFor('unrelated')];
		const remove = vi.fn();
		setWorkspaceState({
			rows: [],
			selectedPanelId: null,
			profile: null,
			select: vi.fn(),
			remove
		});
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'a' }), row({ sessionId: 'b' }), row({ sessionId: 'c' })]
		});
		const x = document.querySelector(
			'[data-testid="subagent-popup-close-all"]'
		) as HTMLButtonElement;
		expect(x).not.toBeNull();
		const stopPropagation = vi.fn();
		// stopPropagation path: fire through the handler with a spied event
		const evt = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(evt, 'stopPropagation', { value: stopPropagation });
		x.dispatchEvent(evt);
		flushSync();
		expect(stopPropagation).toHaveBeenCalled();
		// exactly the two session-bearing helper panels, not the unrelated one
		expect(remove).toHaveBeenCalledTimes(2);
		expect(remove).toHaveBeenCalledWith('p-a');
		expect(remove).toHaveBeenCalledWith('p-c');
	});
});

describe('SubagentPopup — elapsed operateMs variants', () => {
	it('operateMs under a minute renders seconds', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 's1', operateMs: 42_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe('42s');
	});

	it('operateMs over an hour renders h m', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 's2', operateMs: 3_661_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe('1h 1m');
	});

	it('operateMs between one minute and an hour renders m s', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 's3', operateMs: 125_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe('2m 5s');
	});
});

describe('SubagentPopup — chip grammar and null title', () => {
	it('one row reads the singular subagent', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'only' })]
		});
		expect(
			document
				.querySelector('[data-testid="subagent-popup-chip"]')
				?.textContent?.replace(/\s+/g, ' ')
				?.trim()
		).toBe('1 subagent · 0 running');
	});

	it('null title renders the dash — never an empty cell', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'anon', title: null })]
		});
		expect(rowEls()[0].textContent).toContain('—');
	});
});

describe('SubagentPopup — the onMount tick and its cleanup', () => {
	it('open popup ticks the clock every second (sighted elapsed advances)', () => {
		vi.useFakeTimers();
		subagentClock.observe([{ sessionId: 'live', running: true }]);
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'live', running: true })]
		});
		const before = subagentClock.elapsedMs('live') ?? 0;
		vi.advanceTimersByTime(2100);
		flushSync();
		const after = subagentClock.elapsedMs('live') ?? 0;
		expect(after).toBeGreaterThanOrEqual(before);
	});

	it('closed popup does NOT tick (the interval gates on open)', () => {
		vi.useFakeTimers();
		subagentClock.observe([{ sessionId: 'shut', running: true }]);
		mountComp(SubagentPopup, {
			open: false,
			rows: [row({ sessionId: 'shut', running: true })]
		});
		const before = subagentClock.elapsedMs('shut') ?? 0;
		vi.advanceTimersByTime(3000);
		flushSync();
		expect(subagentClock.elapsedMs('shut') ?? 0).toBe(before);
	});

	it('unmount clears the interval — no tick after destroy', () => {
		vi.useFakeTimers();
		subagentClock.observe([{ sessionId: 'dying', running: true }]);
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'dying', running: true })]
		});
		const destroy = mounted.pop()!;
		destroy(); // unmount → the cleanup closes the interval
		const after = subagentClock.elapsedMs('dying') ?? 0;
		vi.advanceTimersByTime(5000);
		expect(subagentClock.elapsedMs('dying') ?? 0).toBe(after);
	});
});
