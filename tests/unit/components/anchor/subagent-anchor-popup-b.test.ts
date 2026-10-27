/**
 * SubagentPopup - the ALTERNATE/ERROR arms (the "b" slice, kept apart
 * from the plain default-mount cases in subagent-anchor.test.ts):
 *
 *  - elapsedLabel's OTHER branches: the operateMs fallback lane (the
 *    host CAN date the row), the minute bucket, the hour bucket, and
 *    the settled-frozen clock lane.
 *  - the row-click TOGGLE without onopenrow: not-on-floor -> the
 *    ghost-adopt verb; on-floor -> the workspace-state remove verb.
 *  - the close-all chip (anyOnFloor gate) and its per-panel removes.
 *  - edge props: the empty list, the ONE-row singular chip, null
 *    titles, and long lists keeping the sort stable.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubagentPopup from '$lib/components/anchor/subagent-anchor/SubagentPopup.svelte';
import { subagentClock } from '$lib/services/conversation/subagent-clock.svelte';
import { initFloor, resetFloorState } from '$lib/services/panels/floor-registry.svelte';
import { registerAddPanel, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
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

const mounted: Array<() => void> = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** A minimal session-bearing floor panel entry - the shape onFloor() narrows. */
function panelEntry(id: string, sessionId: string): DsiPanelEntry {
	return { id, sessionId, kind: 'conversation' } as unknown as DsiPanelEntry;
}

beforeEach(() => {
	subagentClock.observe([]); // expire every sample between tests
	resetFloorState();
	resetPanelRegistryForTests();
	setWorkspaceState(null);
});

afterEach(() => {
	for (const destroy of mounted.splice(0)) destroy();
	setWorkspaceState(null);
	resetPanelRegistryForTests();
	resetFloorState();
	document.body.innerHTML = '';
});

describe('SubagentPopup - elapsedLabel arms', () => {
	it('operateMs numbers WIN over the clock (the host CAN date the row)', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'dated', operateMs: 95_000, running: true })]
		});
		// 95s -> the minute bucket, sourced from operateMs not the registry
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe(
			'1m 35s'
		);
	});

	it('hour bucket: >=1h renders h m', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'long', operateMs: 3_725_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe(
			'1h 2m'
		);
	});

	it('sub-minute bucket renders bare seconds', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'quick', operateMs: 42_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe(
			'42s'
		);
	});

	it('settled clock: the FROZEN sample renders, not the live delta', () => {
		// sight running, then observe settled - the clock freezes the delta
		subagentClock.observe([{ sessionId: 'frozen', running: true }]);
		subagentClock.observe([{ sessionId: 'frozen', running: false }]);
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'frozen', running: false, operateMs: null })]
		});
		const label = document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim();
		expect(label).toMatch(/^0s$/); // frozen at the ~0ms between the two observes
	});

	it('exactly 60s flips into the minute bucket (boundary)', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'edge60', operateMs: 60_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe(
			'1m 0s'
		);
	});
});

describe('SubagentPopup - row-click TOGGLE arms (no onopenrow)', () => {
	it('not on the floor -> the ghost-adopt verb (addPanelFromSidebar)', () => {
		const addHandler = vi.fn();
		registerAddPanel(addHandler);
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'adopt-me' })]
		});
		(document.querySelector('[data-testid="subagent-row"]') as HTMLButtonElement).click();
		flushSync();
		expect(addHandler).toHaveBeenCalledTimes(1);
		expect(addHandler).toHaveBeenCalledWith({ sessionId: 'adopt-me', agentPreset: null });
	});

	it('no floor mounted -> the adopt is a graceful no-op, never a crash', () => {
		// registerAddPanel deliberately NOT called - the leaf must stay silent
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'quiet' })]
		});
		expect(() => {
			(document.querySelector('[data-testid="subagent-row"]') as HTMLButtonElement).click();
			flushSync();
		}).not.toThrow();
	});

	it('already on the floor -> the RowButtonClose verb (workspace remove)', () => {
		const remove = vi.fn();
		setWorkspaceState({ rows: [], selectedPanelId: null, profile: null, select: vi.fn(), remove });
		initFloor([panelEntry('panel-1', 'close-me')], null);
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'close-me' })]
		});
		(document.querySelector('[data-testid="subagent-row"]') as HTMLButtonElement).click();
		flushSync();
		expect(remove).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledWith('panel-1');
	});

	it('on-floor row tints its row (the row-on-floor class)', () => {
		initFloor([panelEntry('panel-1', 'tinted')], null);
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'tinted', title: 'tinted' }), row({ sessionId: 'plain', title: 'plain' })]
		});
		const rows = [...document.querySelectorAll('[data-testid="subagent-row"]')];
		const tinted = rows.find((r) => r.textContent?.includes('tinted'))!;
		const plain = rows.find((r) => r.textContent?.includes('plain'))!;
		expect(tinted.className).toContain('row-on-floor');
		expect(plain.className).not.toContain('row-on-floor');
	});
});

describe('SubagentPopup - close-all chip (anyOnFloor gate)', () => {
	it('chip hidden when no row lives on the floor', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'nowhere' })]
		});
		expect(document.querySelector('[data-testid="subagent-popup-close-all"]')).toBeNull();
	});

	it('chip click removes EVERY open helper panel, never the click-through row', () => {
		const remove = vi.fn();
		setWorkspaceState({ rows: [], selectedPanelId: null, profile: null, select: vi.fn(), remove });
		initFloor([panelEntry('panel-1', 'a'), panelEntry('panel-2', 'c')], null);
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [
				row({ sessionId: 'a' }),
				row({ sessionId: 'b' }), // not on the floor - must NOT be removed
				row({ sessionId: 'c' })
			]
		});
		const chip = document.querySelector(
			'[data-testid="subagent-popup-close-all"]'
		) as HTMLButtonElement;
		chip.click();
		flushSync();
		expect(remove).toHaveBeenCalledTimes(2);
		expect(remove).toHaveBeenCalledWith('panel-1');
		expect(remove).toHaveBeenCalledWith('panel-2');
	});

	it('null workspace state -> closeAll degrades silently (the ?. chain)', () => {
		initFloor([panelEntry('panel-1', 'a')], null);
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'a' })]
		});
		expect(() => {
			(document.querySelector('[data-testid="subagent-popup-close-all"]') as HTMLButtonElement).click();
			flushSync();
		}).not.toThrow();
	});
});

describe('SubagentPopup - edge props', () => {
	it('EMPTY rows: 0-subagent chip, no row buttons, whole footer at zero', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: []
		});
		const chip = document
			.querySelector('[data-testid="subagent-popup-chip"]')
			?.textContent?.replace(/\s+/g, ' ')
			?.trim();
		expect(chip).toBe('0 subagents · 0 running');
		expect(document.querySelectorAll('[data-testid="subagent-row"]').length).toBe(0);
		// empty list carries no null -> the sum is whole: 0 tok, primary tint
		const footer = document.querySelector('[data-testid="subagent-popup-footer"]');
		expect(footer?.textContent).toContain('0 tok');
		expect(footer?.className).not.toContain('text-text-muted');
	});

	it('ONE row renders the singular chip', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'solo' })]
		});
		const chip = document
			.querySelector('[data-testid="subagent-popup-chip"]')
			?.textContent?.replace(/\s+/g, ' ')
			?.trim();
		expect(chip).toBe('1 subagent · 0 running');
	});

	it('null title renders the dash - never an empty cell', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'no-title', title: null })]
		});
		const rowEl = document.querySelector('[data-testid="subagent-row"]')?.textContent ?? '';
		expect(rowEl).toContain('—');
	});

	it('idle glyph vs running glyph (the else arm of the glyph)', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'idle', running: false }), row({ sessionId: 'busy', running: true })]
		});
		// 2026-10-26 operator request: the running glyph is now a spinning
		// LoaderCircle (JobRosterList convention), idle is a dashed circle.
		const glyphs = [...document.querySelectorAll('[data-testid="subagent-row-glyph"]')].map((g) =>
			g.querySelector('svg')?.classList.contains('animate-spin') ? 'spin' : 'idle'
		);
		expect(glyphs).toEqual(['spin', 'idle']);
	});

	it('long list (many ties) keeps the stable sessionId tiebreak', () => {
		const many = Array.from({ length: 12 }, (_, i) => {
			const id = 'z' + String(12 - i).padStart(2, '0');
			return row({ sessionId: id, title: id, tokens: { input: 0, output: 0 } });
		});
		mountComp(SubagentPopup, { open: true, triggerEl: undefined, rows: many });
		const texts = [...document.querySelectorAll('[data-testid="subagent-row"]')].map((r) =>
			(r.textContent ?? '').trim()
		);
		expect(texts[0]).toContain('z01'); // ascending sessionId tiebreak
		expect(texts[11]).toContain('z12');
		expect(texts.length).toBe(12);
	});
});
