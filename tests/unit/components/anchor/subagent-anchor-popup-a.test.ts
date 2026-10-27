/**
 * SubagentPopup — independent coverage slice A: the arms the row-sort
 * suite never reaches — the singular/plural chip ternary, the on-floor
 * tint + close-all X (both arms), the no-callback toggle path (remove
 * vs adopt), the null-title dash, and every elapsedLabel shape
 * (operateMs number, seconds, minutes, hours).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubagentPopup from '$lib/components/anchor/subagent-anchor/SubagentPopup.svelte';
import { configureFloorRegistry, initFloor, makePanel, resetFloorState } from '$lib/services/panels/floor-registry.svelte';
import { registerAddPanel, resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import { subagentClock } from '$lib/services/conversation/subagent-clock.svelte';
import type { Component } from 'svelte';
import type { DsiSubagentRow } from '$lib/types';

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

// Minimal floor deps — makePanel/initFloor only need the width preset.
configureFloorRegistry({
	getPanelWidth: () => 480,
	setPanelWidthPreset: () => {},
	setTreePct: () => {},
	ensureCold: async () => {},
	rememberEdge: () => {},
	getLineageFacts: () => null,
	getMoveFacts: () => null,
	getWorkspaceFor: () => null,
	getSettingsHomes: () => ({ dsi: '/h/.dsi', dsh: '/h/.dsh' }),
	applyTerminalDeskAction: () => {}
} as never);

beforeEach(() => {
	subagentClock.observe([]);
	resetFloorState();
	resetPanelRegistryForTests();
	document.body.innerHTML = '';
});

afterEach(() => {
	for (const destroy of mounted.splice(0)) destroy();
	setWorkspaceState(null);
	document.body.innerHTML = '';
});

describe('SubagentPopup — slice A: chip, floor arms, toggle, elapsed shapes', () => {
	it('singular chip: one row reads 1 subagent (not subagents)', () => {
		mountComp(SubagentPopup, { open: true, rows: [row({ sessionId: 'only' })] });
		const chip = document
			.querySelector('[data-testid="subagent-popup-chip"]')
			?.textContent?.replace(/\s+/g, ' ')
			?.trim();
		expect(chip).toBe('1 subagent · 0 running');
	});

	it('empty ledger renders the chip with zero rows and no row buttons', () => {
		mountComp(SubagentPopup, { open: true, rows: [] });
		const chip = document
			.querySelector('[data-testid="subagent-popup-chip"]')
			?.textContent?.replace(/\s+/g, ' ')
			?.trim();
		expect(chip).toBe('0 subagents · 0 running');
		expect(document.querySelectorAll('[data-testid="subagent-row"]')).toHaveLength(0);
	});

	it('on-floor row: tint class applies, close-all X renders and removes every open helper panel', () => {
		const p1 = makePanel('floor-a', null);
		const p2 = makePanel('floor-b', null);
		initFloor([p1, p2], p1.id);
		const remove = vi.fn();
		setWorkspaceState({ remove } as never);
		mountComp(SubagentPopup, {
			open: true,
			rows: [
				row({ sessionId: 'floor-a' }),
				row({ sessionId: 'floor-b' }),
				row({ sessionId: 'off-floor' })
			]
		});
		// both tint arms: on-floor rows carry the class, off-floor does not
		const rows = [...document.querySelectorAll('[data-testid="subagent-row"]')];
		const tinted = rows.filter((r) => r.className.includes('row-on-floor'));
		expect(tinted).toHaveLength(2);
		expect(tinted.every((r) => !r.className.includes('off-floor-tint-marker'))).toBe(true);
		// the off-floor row keeps the untinted arm
		expect(rows.filter((r) => !r.className.includes('row-on-floor'))).toHaveLength(1);
		// the anyOnFloor TRUE arm: the X is visible
		const closeAll = document.querySelector(
			'[data-testid="subagent-popup-close-all"]'
		) as HTMLButtonElement | null;
		expect(closeAll).not.toBeNull();
		closeAll!.click();
		flushSync();
		expect(remove).toHaveBeenCalledTimes(2);
		expect(remove).toHaveBeenCalledWith(p1.id);
		expect(remove).toHaveBeenCalledWith(p2.id);
	});

	it('no close-all X when nothing is on the floor (anyOnFloor false arm)', () => {
		mountComp(SubagentPopup, { open: true, rows: [row({ sessionId: 'ghostless' })] });
		expect(document.querySelector('[data-testid="subagent-popup-close-all"]')).toBeNull();
	});

	it('row click without a callback toggles: off-floor session ADOPTS via addPanelFromSidebar', () => {
		const add = vi.fn();
		registerAddPanel(add);
		mountComp(SubagentPopup, { open: true, rows: [row({ sessionId: 'adopt-me' })] });
		(document.querySelector('[data-testid="subagent-row"]') as HTMLButtonElement).click();
		flushSync();
		expect(add).toHaveBeenCalledTimes(1);
		expect(add.mock.calls[0][0]).toMatchObject({ sessionId: 'adopt-me', agentPreset: null });
	});

	it('row click without a callback toggles: on-floor session is brought OUT via workspace remove', () => {
		const p = makePanel('out-me', null);
		initFloor([p], p.id);
		const remove = vi.fn();
		setWorkspaceState({ remove } as never);
		const add = vi.fn();
		registerAddPanel(add);
		mountComp(SubagentPopup, { open: true, rows: [row({ sessionId: 'out-me' })] });
		(document.querySelector('[data-testid="subagent-row"]') as HTMLButtonElement).click();
		flushSync();
		expect(remove).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledWith(p.id);
		expect(add).not.toHaveBeenCalled();
	});

	it('null title renders the dash — never an empty cell', () => {
		mountComp(SubagentPopup, { open: true, rows: [row({ sessionId: 'untitled', title: null })] });
		const rowEl = document.querySelector('[data-testid="subagent-row"]')?.textContent ?? '';
		expect(rowEl).toContain('—');
	});

	it('elapsed shapes: operateMs number wins over the clock', () => {
		subagentClock.observe([{ sessionId: 'dated', running: true }]);
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'dated', operateMs: 5_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe('5s');
	});

	it('elapsed shapes: minutes under the hour', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'mins', operateMs: 125_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe(
			'2m 5s'
		);
	});

	it('elapsed shapes: hours+', () => {
		mountComp(SubagentPopup, {
			open: true,
			rows: [row({ sessionId: 'hrs', operateMs: (2 * 60 + 30) * 60_000 })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe(
			'2h 30m'
		);
	});
});
