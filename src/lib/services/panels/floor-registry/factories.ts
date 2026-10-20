/**
 * floor-registry/factories — panel factories + placement slots (ADR-0022 W2).
 *
 * Moved WHOLE from the state home (floor-registry.svelte.ts): the eight
 * make* panel factories and the slot grammar (insertPanel, insertionSlot,
 * pinnedSlotIndex). Plain module: no runes here — every write goes through
 * the state home's reactive `st` hub and its primitives (ADR-0019 D2:
 * exactly ONE writer home for floor state). Sibling rule: this file never
 * imports another sibling; shared needs come from the state home.
 */
import {
	clampPanelWidth,
	PANEL_WORKSPACE_FILE_WIDTH,
	shelfPanelWidth
} from '$lib/utils/panel-prefs';
import { focusedInsertionSlot, lineagePinnedSlot } from '$lib/services/panels/panel-placement';
import type {
	DsiConversationPanel,
	DsiPanelEntry,
	DsiWorkspaceExplorerPanel
} from '$lib/types';
import { nextPanelId, st, selectedIndex_, floorSeam } from '$lib/services/panels/floor-registry.svelte';

const d = floorSeam;

export function makePanel(sessionId: string, agentPreset: string | null): DsiConversationPanel {
	return {
		id: nextPanelId(),
		kind: 'conversation',
		sessionId,
		agentPreset,
		width: clampPanelWidth(d().getPanelWidth())
	};
}

export function makeTerminalPanel(): DsiPanelEntry {
	return { id: nextPanelId(), kind: 'terminal', width: clampPanelWidth(d().getPanelWidth()) };
}

export function makeBrowserPanel(): DsiPanelEntry {
	return { id: nextPanelId(), kind: 'browser', width: clampPanelWidth(d().getPanelWidth()) };
}

export function makeManagerPanel(): DsiPanelEntry {
	return { id: nextPanelId(), kind: 'prompt-manager', width: clampPanelWidth(d().getPanelWidth()) };
}

export function makeSkillShelfPanel(): DsiPanelEntry {
	return { id: nextPanelId(), kind: 'skill-shelf', width: shelfPanelWidth() };
}

export function makePluginRackPanel(): DsiPanelEntry {
	return { id: nextPanelId(), kind: 'plugin-rack', width: shelfPanelWidth() };
}

export function makeInjectedDocPanel(sourceSessionId: string, displayPath: string): DsiPanelEntry {
	return {
		id: nextPanelId(),
		kind: 'injected-doc',
		sourceSessionId,
		displayPath,
		width: clampPanelWidth(d().getPanelWidth())
	};
}

export function makeWorkspaceExplorerPanel(
	sessionId: string,
	root: string
): DsiWorkspaceExplorerPanel {
	return {
		id: nextPanelId(),
		kind: 'workspace-explorer',
		sessionId,
		root,
		expanded: [],
		width: clampPanelWidth(PANEL_WORKSPACE_FILE_WIDTH, 'workspace-explorer')
	};
}

export function makeSettingsHomePanel(home: 'dsi' | 'dsh'): DsiWorkspaceExplorerPanel {
	const root = d().getSettingsHomes()[home];
	return {
		id: nextPanelId(),
		kind: 'workspace-explorer',
		sessionId: null,
		root,
		title: home === 'dsi' ? 'DSI - Settings' : 'DSH - Settings',
		home,
		expanded: [],
		width: clampPanelWidth(PANEL_WORKSPACE_FILE_WIDTH, 'workspace-explorer')
	};
}

export function insertPanel(entry: DsiPanelEntry, index: number): void {
	const next = [...st.panels];
	next.splice(Math.min(index, next.length), 0, entry);
	st.panels = next;
	st.selectedPanelId = entry.id;
}

export function insertionSlot(): number {
	return focusedInsertionSlot(st.panels, selectedIndex_(), d().getMoveFacts().parentOf);
}

export function pinnedSlotIndex(parentSessionId: string, childSessionId: string): number {
	return lineagePinnedSlot(
		st.panels,
		d().getLineageFacts().childrenByParent,
		parentSessionId,
		childSessionId
	);
}