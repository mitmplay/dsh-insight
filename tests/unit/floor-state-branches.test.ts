/**
 * floor-registry.svelte.ts branch mop — the state home's guards and
 * getters the mutator suites do not reach: the un-configured seam throw,
 * resetFloorState's pending-gesture-timer arm, syncPanelIdSeq's non-matching
 * id arm, loupe/selection guard arms, and every floor getter's null path.
 * Fresh module per file: the FIRST test runs before any configure call.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clearFocusComposer,
	clearLoupeIfGone,
	closeLoupe,
	configureFloorRegistry,
	floor,
	floorSeam,
	initFloor,
	makePanel,
	nextPanelId,
	openLoupe,
	publishTerminalDeskMirror,
	resetFloorState,
	selectPanel,
	st,
	syncPanelIdSeq,
	dragRefs
} from '$lib/services/panels/floor-registry.svelte';
import type { DsiPanelEntry } from '$lib/types';

const conv = (sessionId: string): DsiPanelEntry => makePanel(sessionId, null);

beforeEach(() => {
	resetFloorState();
});
afterEach(() => {
	if (dragRefs.timer !== null) {
		clearTimeout(dragRefs.timer);
		dragRefs.timer = null;
	}
});

describe('the dep seam', () => {
	it('floorSeam throws before configureFloorRegistry — the honest missing-config crash', () => {
		// FIRST test in this file: no configure call has happened yet.
		expect(() => floorSeam()).toThrow('configureFloorRegistry() was never called');
	});

	it('after configure, the seam returns the installed deps', () => {
		configureFloorRegistry({
			getLineageFacts: () => ({}) as never,
			getMoveFacts: () => ({ parentOf: new Map() }),
			getWorkspaceFor: () => null,
			ensureCold: async () => {},
			rememberEdge: () => {},
			getPanelWidth: () => 480,
			setPanelWidthPreset: () => {},
			setTreePct: () => {},
			getSettingsHomes: () => ({}),
			applyTerminalDeskAction: () => {}
		});
		expect(floorSeam().getPanelWidth()).toBe(480);
	});
});

describe('resetFloorState — the pending gesture timer', () => {
	it('clears a pending fade timer and nulls the ref (the !== null arm)', () => {
		// no fake timers: a real 1s timeout cleared before it can ever fire
		dragRefs.timer = setTimeout(() => {}, 1_000);
		expect(dragRefs.timer).not.toBeNull();
		resetFloorState();
		expect(dragRefs.timer).toBeNull();
	});

	it('a null timer ref passes through the guard untouched (the === null arm)', () => {
		dragRefs.timer = null;
		expect(() => resetFloorState()).not.toThrow();
		expect(dragRefs.timer).toBeNull();
	});
});

describe('syncPanelIdSeq — id-pattern arms', () => {
	it('a non-matching id is skipped; a matching id pushes the sequence', () => {
		syncPanelIdSeq([
			{ id: 'legacy-9', kind: 'terminal', width: 480 } as DsiPanelEntry,
			{ id: 'panel-42', kind: 'terminal', width: 480 } as DsiPanelEntry
		]);
		expect(nextPanelId()).toBe('panel-43');
	});

	it('an empty floor leaves the sequence alone', () => {
		syncPanelIdSeq([]);
		expect(nextPanelId()).toBe('panel-1');
	});
});

describe('loupe + selection guards', () => {
	it('openLoupe on an unknown panel id is a no-op', () => {
		initFloor([conv('a')], null);
		openLoupe('panel-999');
		expect(floor.loupePanelId).toBeNull();
	});

	it('openLoupe on a live panel aims the lens; closeLoupe drops it', () => {
		const a = conv('a');
		initFloor([a], a.id);
		openLoupe(a.id);
		expect(floor.loupePanelId).toBe(a.id);
		expect(floor.loupePanel?.id).toBe(a.id);
		closeLoupe();
		expect(floor.loupePanelId).toBeNull();
		expect(floor.loupePanel).toBeNull();
	});

	it('clearLoupeIfGone keeps a loupe whose panel is still on the floor', () => {
		const a = conv('a');
		initFloor([a], a.id);
		openLoupe(a.id);
		clearLoupeIfGone();
		expect(floor.loupePanelId).toBe(a.id);
	});

	it('clearLoupeIfGone drops a loupe whose panel vanished', () => {
		const a = conv('a');
		initFloor([a], a.id);
		openLoupe(a.id);
		st.panels = [];
		clearLoupeIfGone();
		expect(floor.loupePanelId).toBeNull();
	});

	it('clearLoupeIfGone with NO loupe at all is a no-op', () => {
		initFloor([], null);
		expect(() => clearLoupeIfGone()).not.toThrow();
	});

	it('selectPanel ignores an unknown id and accepts a live one', () => {
		const a = conv('a');
		initFloor([a], null);
		selectPanel('panel-999');
		expect(floor.selectedPanelId).toBeNull();
		selectPanel(a.id);
		expect(floor.selectedPanelId).toBe(a.id);
		expect(floor.selected?.id).toBe(a.id);
	});

	it('clearFocusComposer drops the swap-focus marker', () => {
		st.focusComposerId = 'panel-3';
		clearFocusComposer();
		expect(floor.focusComposerId).toBeNull();
	});
});

describe('floor getters — null/empty paths', () => {
	it('an empty floor reads null through every panel getter', () => {
		expect(floor.selected).toBeNull();
		expect(floor.loupePanel).toBeNull();
		expect(floor.panels).toEqual([]);
		expect(floor.selectedPanelId).toBeNull();
		expect(floor.loupePanelId).toBeNull();
		expect(floor.focusComposerId).toBeNull();
		expect(floor.terminalDeskMirrors).toEqual({});
		expect(floor.pendingFileIntents).toEqual({});
		expect(floor.drag).toBeNull();
		expect(floor.widthBadgeFading).toBe(false);
		expect(floor.widthBadgeIds.size).toBe(0);
	});

	it('initFloor restores panels + selection and syncs the id sequence', () => {
		const a = conv('a');
		initFloor([a], a.id);
		expect(floor.panels.length).toBe(1);
		expect(floor.selectedPanelId).toBe(a.id);
		expect(nextPanelId()).toBe('panel-2');
	});

	it('publishTerminalDeskMirror writes the desk mirror keyed by panel id', () => {
		publishTerminalDeskMirror('panel-1', { cols: 80, rows: 24 } as never);
		expect(floor.terminalDeskMirrors['panel-1']).toEqual({ cols: 80, rows: 24 });
	});
});
