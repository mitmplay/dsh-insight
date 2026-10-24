/**
 * floor-registry — the floor's state machine, service-side (ADR-0019 D2).
 *
 * ONE writer for the floor: the panels array, its selection, the loupe,
 * the file-intent mailbox, and the drag/afterglow gesture live HERE as
 * module-scope reactive state; every mutator is a plain exported function
 * unit-tested as a module. The route (+page.svelte) is the shell: it
 * configures the deps once (spine/config/prefs reads, wire cold loads),
 * then delegates — never writing floor state directly.
 *
 * Dependency seam (configureFloorRegistry): the few reads the machine
 * needs from OUTSIDE the floor — live lineage facts, move facts, the
 * per-session workspace lookup (spine-first merge), the wire cold-load
 * ladder, the page-prefs singleton, and the app config. Unit tests
 * install fakes; the route installs the real ones at init.
 *
 * Authority rule (ADR-0019 D2): exactly ONE home writes panels. During
 * the migration waves the route's originals become one-line delegations
 * and are deleted at their wave's end — never two live writers.
 */
import { SvelteSet } from 'svelte/reactivity';
import type { LineageFacts } from '$lib/services/lineage/lineage';
import type { MoveFacts } from '$lib/services/lineage/lineage-move';
import type { DsiPanelEntry, TerminalDeskMirror } from '$lib/types';

// ── Sibling hub (ADR-0022 R2): the public surface re-pointed, zero call-site changes ──
//
// (SOURCE-PIN NOTE removed: tests/unit/terminal-desk.test.ts 2.3-T was
// re-pointed to floor-registry/grammar.ts by the orchestrator's adjudication
// commit — ADR-0022 registry sweep.)
export * from '$lib/services/panels/floor-registry/chrome';
export * from '$lib/services/panels/floor-registry/grammar';
export * from '$lib/services/panels/floor-registry/drag.svelte';
export * from '$lib/services/panels/floor-registry/factories';

export interface FloorRegistryDeps {
	getLineageFacts(): LineageFacts;
	getMoveFacts(): MoveFacts;
	getWorkspaceFor(sessionId: string): string | null;
	ensureCold(sessionId: string): Promise<void>;
	rememberEdge(childSessionId: string, parentSessionId: string): void;
	getPanelWidth(): number;
	setPanelWidthPreset(width: number): void;
	setTreePct(pct: number): void;
	getSettingsHomes(): Record<string, string>;
	/** Terminal Desk action forward (--new-tab / --split-down) — the desk
	 *  ref stays the route's bind:this; the machine only forwards. */
	applyTerminalDeskAction(action: 'new-tab' | 'split-down'): void;
	/** The Glass Close Ladder (ADR 2026-10-24 D1/D2): the route's wire kill
	 *  for doomed glasses — fire-and-forget POST close per id. Optional:
	 *  tests configure the registry without it; a missing seam is a no-op. */
	releaseGlasses?(sessionIds: string[]): void;
}

let deps: FloorRegistryDeps | null = null;

export function configureFloorRegistry(d0: FloorRegistryDeps): void {
	deps = d0;
}

function d(): FloorRegistryDeps {
	if (deps === null) throw new Error('floor-registry: configureFloorRegistry() was never called');
	return deps;
}

/** Sibling-module access to the dep seam (ADR-0022 W2): the ONE outside-reads
 *  channel; siblings never open their own config channel. */
export function floorSeam(): FloorRegistryDeps {
	return d();
}

export const st = $state({
	panels: [] as DsiPanelEntry[],
	selectedPanelId: null as string | null,
	loupePanelId: null as string | null,
	focusComposerId: null as string | null,
	panelIdSeq: 0,
	terminalDeskMirrors: {} as Record<string, TerminalDeskMirror>,
	pendingFileIntents: {} as Record<
		string,
		{ path: string; nonce: number; lines?: { start: number; end: number } | null } | null
	>,
	fileIntentSeq: 0,
	drag: null as { startX: number; widths: number[]; shift: boolean } | null,
	widthBadgeFading: false
});

/** Non-reactive gesture refs (drag start index, fade timer, badge ids) —
 * written by floor-registry/drag.svelte.ts; the ids set is a live
 * SvelteSet so badge visibility stays reactive. */
export const dragRefs = {
	startIndex: -1,
	timer: null as ReturnType<typeof setTimeout> | null,
	ids: new SvelteSet<string>()
};

export function resetFloorState(): void {
	st.panels = [];
	st.selectedPanelId = null;
	st.loupePanelId = null;
	st.focusComposerId = null;
	st.panelIdSeq = 0;
	st.terminalDeskMirrors = {};
	st.pendingFileIntents = {};
	st.fileIntentSeq = 0;
	dragRefs.startIndex = -1;
	st.drag = null;
	dragRefs.ids.clear();
	st.widthBadgeFading = false;
	if (dragRefs.timer !== null) {
		clearTimeout(dragRefs.timer);
		dragRefs.timer = null;
	}
}

export const floor = {
	get panels(): readonly DsiPanelEntry[] {
		return st.panels;
	},
	get selectedPanelId(): string | null {
		return st.selectedPanelId;
	},
	get loupePanelId(): string | null {
		return st.loupePanelId;
	},
	get focusComposerId(): string | null {
		return st.focusComposerId;
	},
	get terminalDeskMirrors(): Record<string, TerminalDeskMirror> {
		return st.terminalDeskMirrors;
	},
	get pendingFileIntents(): Record<
		string,
		{ path: string; nonce: number; lines?: { start: number; end: number } | null } | null
	> {
		return st.pendingFileIntents;
	},
	get drag(): { startX: number; widths: number[]; shift: boolean } | null {
		return st.drag;
	},
	get widthBadgeFading(): boolean {
		return st.widthBadgeFading;
	},
	get widthBadgeIds(): ReadonlySet<string> {
		return dragRefs.ids;
	},
	get selected(): DsiPanelEntry | null {
		return st.panels.find((p) => p.id === st.selectedPanelId) ?? null;
	},
	get loupePanel(): DsiPanelEntry | null {
		return st.panels.find((p) => p.id === st.loupePanelId) ?? null;
	}
};

export function publishTerminalDeskMirror(panelId: string, mirror: TerminalDeskMirror): void {
	st.terminalDeskMirrors[panelId] = mirror;
}

export function nextPanelId(): string {
	st.panelIdSeq += 1;
	return 'panel-' + st.panelIdSeq;
}

export function syncPanelIdSeq(entries: readonly DsiPanelEntry[]): void {
	for (const p of entries) {
		const m = /^panel-(\d+)$/.exec(p.id);
		if (m) st.panelIdSeq = Math.max(st.panelIdSeq, Number(m[1]));
	}
}

export function initFloor(entries: DsiPanelEntry[], selectedId: string | null): void {
	st.panels = entries;
	st.selectedPanelId = selectedId;
	syncPanelIdSeq(entries);
}

// ── Loupe / focus composers ──────────────────────────────────────────
/** The floor's onloupe verb (The Panel Loupe ADR D5): aim the lens at a
 *  panel. Session-local by decision — never persisted. */
export function openLoupe(panelId: string): void {
	if (st.panels.some((p) => p.id === panelId)) st.loupePanelId = panelId;
}

/** The fresh panel mounted and its composer took focus — clear the
 *  swap-focus marker (a marker whose panel never mounts stays inert:
 *  panel ids are unique and never remount). */
export function clearFocusComposer(): void {
	st.focusComposerId = null;
}

export function selectPanel(panelId: string): void {
	if (st.panels.some((p) => p.id === panelId)) st.selectedPanelId = panelId;
}

export function closeLoupe(): void {
	st.loupePanelId = null;
}

export function clearLoupeIfGone(): void {
	if (st.loupePanelId !== null && !st.panels.some((p) => p.id === st.loupePanelId)) {
		st.loupePanelId = null;
	}
}

export function selectedIndex_(): number {
	return st.panels.findIndex((p) => p.id === st.selectedPanelId);
}
