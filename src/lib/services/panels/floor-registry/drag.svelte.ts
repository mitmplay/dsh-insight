/**
 * floor-registry/drag — the gutter-drag resize machine + afterglow, the
 * honest-slider settle, and the two absorbed legacy jobs (ADR-0022 W4).
 *
 * Moved WHOLE from the state home (floor-registry.svelte.ts): the gutter
 * drag (snapshot → move → mouseup badge freeze → 10s fade), the ControlBar
 * resize-all, the markdown file-link gate, and the dual-fetch wire cold
 * load. Reactive gesture state (drag snapshot, badge fading) lives in the
 * state home's `st` hub; the non-reactive gesture refs (start index,
 * fade timer, badge ids) in `dragRefs` — this module writes them, the
 * home stays the ONE state writer home (ADR-0019 D2).
 */
import { SvelteSet } from 'svelte/reactivity';
import { clampPanelWidth } from '$lib/utils/panel-prefs';
import { isUniformRow, resizeOne, scaleProportionally } from '$lib/services/panels/floor-math';
import { parseFileLinkHref, resolveFileLinkTarget, workspaceRootDirs } from '$lib/utils/file-link';
import type { ColdLoad } from '$lib/services/workspace/page-feeds.svelte';
import type { DsiEntry } from '$lib/types';
import {
	st,
	floorSeam,
	dragRefs,
	openWorkspaceExplorer,
	sessionWorkspaceExplorer,
	openWorkspaceFile
} from '$lib/services/panels/floor-registry.svelte';

const d = floorSeam;

/** Width-badge afterglow (2026-08-28): the panel ids whose width left
 * the drag snapshot at mouseup — badged through a 10s fade after the
 * drag ends. LIVE visibility is derived from `drag` + `panels`. */
function changedBadgeIds(): SvelteSet<string> {
	if (st.drag === null) return new SvelteSet();
	const ids = new SvelteSet<string>();
	for (let i = 0; i < st.panels.length; i++) {
		if (st.panels[i].width !== st.drag.widths[i]) ids.add(st.panels[i].id);
	}
	return ids;
}

export function doStartPanelResize(e: MouseEvent, index: number): void {
	// A new gesture opens a FRESH frame window — a frame still queued from
	// the previous drag must not swallow this drag's first move.
	if (moveFrame !== null) {
		cancelAnimationFrame(moveFrame);
		moveFrame = null;
	}
	pendingMove = null;
	dragRefs.startIndex = index;
	st.drag = { startX: e.clientX, widths: st.panels.map((p) => p.width), shift: e.shiftKey };
	// A new drag cancels any afterglow — badges go LIVE again (or hide
	// until a width actually leaves the new snapshot).
	if (dragRefs.timer !== null) {
		clearTimeout(dragRefs.timer);
		dragRefs.timer = null;
	}
	st.widthBadgeFading = false;
	dragRefs.ids.clear();
}

// ── Coalesced move (The Drag Frame ADR 2026-10-27) ───────────────────
// Mousemove fires at input-device rate (often faster than the display);
// the coalescer keeps ONE pending frame and applies only the LATEST
// event, so the floor does at most one width write + one relayout per
// animation frame. The machine below stays synchronous — the route's
// <svelte:window onmousemove> calls the coalescer; the unit tests call
// the raw machine.
let pendingMove: MouseEvent | null = null;
let moveFrame: number | null = null;

export function onPanelWindowMouseMoveCoalesced(e: MouseEvent): void {
	if (st.drag === null) return; // no active drag — drop, never queue a frame
	if (moveFrame !== null) {
		pendingMove = e; // a frame is already queued — just refresh the latest
		return;
	}
	// First move of a frame window applies IMMEDIATELY (instant feedback at
	// drag start; a test environment with an unpumped rAF still sees the
	// write), then the frame coalesces every later move into one apply.
	onPanelWindowMouseMove(e);
	moveFrame = requestAnimationFrame(() => {
		moveFrame = null;
		const ev = pendingMove;
		pendingMove = null;
		if (ev !== null) onPanelWindowMouseMove(ev);
	});
}

export function onPanelWindowMouseMove(e: MouseEvent): void {
	if (!st.drag) return;
	const delta = e.clientX - st.drag.startX;
	if (st.drag.shift) {
		// Shift+drag: proportional — every panel keeps its snapshot share.
		st.panels = scaleProportionally(st.panels, st.drag.widths, delta);
		return;
	}
	// Plain drag: individual — only the dragged panel's width moves
	// (2026-08-28); the neighbors keep their values.
	st.panels = resizeOne(st.panels, st.drag.widths, dragRefs.startIndex, delta);
}

export function onPanelWindowMouseUp(): void {
	if (st.drag === null) return;
	// Flush the coalesced frame: the drag's FINAL position must land before
	// the badge set freezes against the snapshot.
	if (moveFrame !== null) {
		cancelAnimationFrame(moveFrame);
		moveFrame = null;
	}
	if (pendingMove !== null) {
		const ev = pendingMove;
		pendingMove = null;
		onPanelWindowMouseMove(ev);
	}
	// Arm the afterglow BEFORE clearing the snapshot: the changed set
	// (computed against `drag`) freezes into the fading ids.
	const frozen = changedBadgeIds();
	dragRefs.ids.clear();
	for (const id of frozen) dragRefs.ids.add(id);
	st.drag = null;
	st.widthBadgeFading = true;
	if (dragRefs.timer !== null) clearTimeout(dragRefs.timer);
	dragRefs.timer = setTimeout(() => {
		st.widthBadgeFading = false;
		dragRefs.ids.clear();
		dragRefs.timer = null;
	}, 10_000);
	// Honest slider (mouseUP, never mid-drag): a drag that lands ALL
	// panels uniform syncs the width preset — the slider then tells the
	// truth; a mixed row leaves the preset untouched.
	if (isUniformRow(st.panels)) d().setPanelWidthPreset(st.panels[0].width);
}

/** Mount cleanup — the drag afterglow timer and any pending coalesced
 *  move frame die with the page. */
export function disposeFloorGestures(): void {
	if (moveFrame !== null) {
		cancelAnimationFrame(moveFrame);
		moveFrame = null;
		pendingMove = null;
	}
	if (dragRefs.timer !== null) {
		clearTimeout(dragRefs.timer);
		dragRefs.timer = null;
	}
}

// ── ControlBar (W5 5.1): resize-all sets every panel + the preset ────
/** Honest-slider's "slider sets all panels" leg (REALTIME, 2026-08-27):
 * one width for every CONVERSATION column + the uniform preset.
 * 2026-09-13: the workspace kinds are FIXED lanes — the explorer and
 * file panels keep their own widths. */
export function resizeAll(width: number): void {
	const w = clampPanelWidth(width);
	d().setPanelWidthPreset(w);
	st.panels = st.panels.map((p) => (p.kind === 'conversation' ? { ...p, width: w } : p));
}

// ── Markdown file-link gate (File Link Intent ADR 2026-09-25 D3) ─────
/** A transcript file link publishes ONLY after the tree route proves
 * the file exists inside the session's workspace — the gate lives in
 * the shared util; anything else drops the click. No navigation ever
 * happens. No explorer yet ⇒ OPEN ONE (amendment 2026-09-25): the link
 * itself opens the panel; without a workspace root there is nothing to
 * open. W2 (T2.3): moved wholesale from the route — pure machine over
 * the deps seam + the shared utils. */
export async function openFileLinkFromMarkdown(sessionId: string, rawHref: string): Promise<void> {
	const { path, lines } = parseFileLinkHref(rawHref);
	if (path === '') return;
	// Fullpath Bow ADR 2026-09-26 D1: resolve against the session's
	// workspace root BEFORE the gate; the helper owns the resolved-first,
	// as-is-retry probe order and returns null when both candidates refuse.
	const target = await resolveFileLinkTarget(
		sessionId,
		path,
		d().getWorkspaceFor(sessionId),
		undefined,
		workspaceRootDirs
	);
	if (target === null) return;
	if (!sessionWorkspaceExplorer(sessionId)) {
		const root = d().getWorkspaceFor(sessionId);
		if (!root) return;
		openWorkspaceExplorer(sessionId, root);
	}
	openWorkspaceFile(sessionId, target, lines);
}

// ── Runtime cold load — dual fetch (spec-check GAP-1) ────────────────
/** /events?full=1 carries entries+lastSeq+running+pending/settled
 * answers (the ledger-tail resync surface); /history carries hasMore.
 * Its beforeSeq anchor needs the tail's lastSeq, so the events response
 * resolves first — the only serialization. W2 (T2.6): moved wholesale
 * from the route — a pure wire read over the global fetch. */
export async function fetchColdFromWire(sessionId: string): Promise<ColdLoad | null> {
	const eventsRes = await fetch(
		`/api/dsh/session/${encodeURIComponent(sessionId)}/events?full=1`
	);
	if (!eventsRes.ok) return null;
	const events = (await eventsRes.json()) as {
		ok: boolean;
		entries?: DsiEntry[];
		lastSeq?: number;
		running?: boolean;
		pendingAnswers?: ColdLoad['pendingAnswers'];
		settledAnswers?: ColdLoad['settledAnswers'];
		permission?: ColdLoad['permission'];
		imageLimits?: ColdLoad['imageLimits'];
		knobEvents?: ColdLoad['knobEvents'];
		deliverables?: ColdLoad['deliverables'];
		error?: { code: string; message: string };
	};
	if (!events.ok) return null;
	const lastSeq = events.lastSeq ?? -1;
	// Tail hasMore: /history requires beforeSeq; anchor just under the
	// tail — a non-empty older page means older history exists.
	let hasMore = false;
	const historyRes = await fetch(
		`/api/dsh/session/${encodeURIComponent(sessionId)}/history?beforeSeq=${lastSeq + 1}`
	);
	if (historyRes.ok) {
		const history = (await historyRes.json()) as {
			ok: boolean;
			entries?: DsiEntry[];
			hasMore?: boolean;
		};
		if (history.ok) hasMore = (history.entries?.length ?? 0) > 0 || history.hasMore === true;
	}
	return {
		title: null,
		workspace: null,
		// The dual fetch carries no session row — the panel's agent chip
		// falls back to the spine summaries.
		agentPreset: null,
		entries: events.entries ?? [],
		lastSeq,
		running: events.running ?? false,
		hasMore,
		pendingAnswers: events.pendingAnswers ?? [],
		settledAnswers: events.settledAnswers ?? [],
		permission: events.permission ?? null,
		imageLimits: events.imageLimits ?? null,
		knobEvents: events.knobEvents ?? [],
		deliverables: events.deliverables ?? []
	};
}
