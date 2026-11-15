/**
 * floor-math — the drag/resize/order math of a one-row pane floor
 * (generalized from DSI's floor-math.ts, ADR-0062 W3 / D8). PURE functions
 * over plain structural inputs; no DOM, no stores, no consumer vocabulary.
 *
 * GENERIC over the pane type: a consumer's own pane interface (union,
 * discriminated kinds, extra fields) flows through UNCHANGED — every
 * function returns the same pane type it took. Only the structural core
 * (id + width, optional kind) is required.
 *
 * The width bound is INJECTED (the clamp): the generic module cannot know
 * a consumer's config-driven bounds, so every resize entry takes an
 * optional clamp — the consumer's single bound site (DSI passes
 * clampPanelWidth). Behavior is byte-identical to the pre-move DSI file
 * when the consumer passes its clamp.
 */
/** The structural core every pane must expose (satisfied by any consumer
 *  pane with an id and a width; the kind tag rides through opaquely). */
export interface PaneCore {
    id: string;
    width: number;
    /** Opaque kind tag — passed through to the injected clamp only. */
    kind?: unknown;
}
/** A consumer's single width bound site (load-side sanitize AND drags). */
export type WidthClamp = (width: number, kind?: string) => number;
/** Move direction, named in the INVOKING surface's geometry: horizontal
 *  header chevrons vs vertical rows. The floor owner maps both pairs onto
 *  one array operation — left/up toward the start, right/down toward the
 *  end. */
export type PaneMoveDir = 'left' | 'right' | 'up' | 'down';
/** Plain drag: ONLY the pane left of the dragged gutter changes — its
 *  snapshot width plus delta, passed through the injected clamp. Other
 *  panes keep their widths untouched (the row's total grows/shrinks; the
 *  floor viewport scrolls when the widened row overflows it). */
export declare function resizeOne<P extends PaneCore>(panels: readonly P[], snapshots: readonly number[], index: number, delta: number, clamp?: WidthClamp): P[];
/** Shift+drag: EVERY pane scales by its snapshot share of the row — ratios
 *  are preserved (new_i/new_j = snap_i/snap_j) until a pane saturates at a
 *  bound; an extreme drag clamps the row. A degenerate row (total <= 0)
 *  returns the input order untouched. */
export declare function scaleProportionally<P extends PaneCore>(panels: readonly P[], snapshots: readonly number[], delta: number, clamp?: WidthClamp): P[];
/** Honest-slider check: a row is uniform when every width equals the
 *  first (an empty row is not — nothing to sync the preset to). */
export declare function isUniformRow<P extends PaneCore>(panels: readonly P[]): boolean;
/** Move one pane one slot toward the direction's edge — left/up swap with
 *  the predecessor, right/down with the successor. A no-op returning the
 *  input order at either edge or for an unknown pane id. */
export declare function movePanelWithin<P extends PaneCore>(panels: readonly P[], panelId: string, dir: PaneMoveDir): P[];
