/**
 * The Glass Close Ladder (2026-10-24) task 1.2-T: removePanel collects the
 * doomed glasses (openedBy edge) and emits them through the seam
 * releaseGlasses — the route performs the wire kill. The fold path and
 * keyless glasses never appear in the release.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
	configureFloorRegistry,
	resetFloorState,
	st,
	openBrowserPanel,
	removePanel
} from '$lib/services/panels/floor-registry.svelte';

let released: string[][] = [];
configureFloorRegistry({
	getLineageFacts: () =>
		({ subagentIds: new Set(), depthById: new Map(), rootIds: new Set(), childrenByParent: new Map() }) as never,
	getMoveFacts: () => ({}) as never,
	getWorkspaceFor: () => null,
	ensureCold: async () => undefined,
	rememberEdge: () => undefined,
	getPanelWidth: () => 480,
	setPanelWidthPreset: () => undefined,
	setTreePct: () => undefined,
	getSettingsHomes: () => ({}),
	applyTerminalDeskAction: () => undefined,
	releaseGlasses: (ids) => void released.push(ids)
});

afterEach(() => {
	released = [];
	resetFloorState();
});

function conv(sessionId: string): { id: string; kind: string; sessionId: string; agentPreset: null; width: number } {
	return { id: "p-" + sessionId, kind: "conversation", sessionId, agentPreset: null, width: 600 };
}

function glass(sessionId: string, openedBy?: string): { id: string; kind: string; width: number; openedBy?: string; browserSessionId?: string } {
	return { id: "g-" + sessionId, kind: "browser", width: 600, ...(openedBy !== undefined ? { openedBy } : {}), ...(sessionId !== undefined ? { browserSessionId: sessionId } : {}) };
}

function reset(panels: unknown[]): void {
	resetFloorState();
	st.panels = panels as never;
	st.selectedPanelId = null;
}

describe('removePanel — the glass release ladder', () => {
	it('family close of the opener does NOT release — the glass folds to a ghost (Amendment 2, operator 2026-10-24)', () => {
		reset([conv('A'), glass('bs-1', 'A'), conv('B')]);
		removePanel('p-A');
		// the session SURVIVES the opener close — the slot tick folds it and
		// the lineage-tree ghost nests it under the opener family
		expect(released).toEqual([]);
		// the glass panel left the floor with the family
		expect(st.panels.some((p) => p.id === 'g-bs-1')).toBe(false);
	});

	it('removing the browser panel ITSELF does NOT release either (only the header trash kills)', () => {
		reset([conv('A'), glass('bs-1', 'A')]);
		removePanel('g-bs-1');
		expect(released).toEqual([]);
		// opener family untouched
		expect(st.panels.some((p) => p.kind === 'conversation' && (p as { sessionId: string }).sessionId === 'A')).toBe(true);
	});

	it('a KEYLESS glass survives every cascade and is never released', () => {
		reset([conv('A'), glass('bs-keyless'), conv('B')]);
		removePanel('p-A');
		expect(released).toEqual([]);
		expect(st.panels.some((p) => p.id === 'g-bs-keyless')).toBe(true);
	});

	it('family:false (shift-click) opts out of the release too', () => {
		reset([conv('A'), glass('bs-1', 'A')]);
		removePanel('p-A', { family: false });
		expect(released).toEqual([]);
	});
});