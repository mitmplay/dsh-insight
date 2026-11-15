/**
 * badge-phases — the demo floor's resize-chip phase map (2026-11-15
 * WidthBadge Base Promotion, task 2.1). Mirrors DSI floor-reads
 * badgeByPanelId semantics (src/lib/services/panels/floor-reads.svelte.ts
 * 77-95): while the drag is active a pane is 'live' exactly when its width
 * differs from the drag snapshot; on mouseup every live pane goes
 * 'fading' and the chip's own 10s CSS transition does the fade — the host
 * only holds the flag and drops the pane when the afterglow window ends.
 * Pure and page-owned: the base package ships no drag phase machine
 * (ADR-0062 D10), so this lives beside its only consumer, the demo page.
 */

export const BADGE_AFTERGLOW_MS = 10_000;

export type BadgePhaseMap = Record<string, 'live' | 'fading'>;

/** Live while dragging: one entry per pane whose width moved off the snapshot. */
export function liveBadgePhases(
	ids: string[],
	widths: number[],
	snapshot: number[]
): BadgePhaseMap {
	const phases: BadgePhaseMap = {};
	ids.forEach((id, i) => {
		if (widths[i] !== snapshot[i]) phases[id] = 'live';
	});
	return phases;
}

/** On mouseup: every live pane goes fading (same id set, never a new one). */
export function settleBadgePhases(phases: BadgePhaseMap): string[] {
	return Object.keys(phases).filter((id) => phases[id] === 'live');
}
