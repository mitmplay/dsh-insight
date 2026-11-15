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
const identityClamp = (width) => width;
/** Plain drag: ONLY the pane left of the dragged gutter changes — its
 *  snapshot width plus delta, passed through the injected clamp. Other
 *  panes keep their widths untouched (the row's total grows/shrinks; the
 *  floor viewport scrolls when the widened row overflows it). */
export function resizeOne(panels, snapshots, index, delta, clamp = identityClamp) {
    const target = clamp(snapshots[index] + delta, panels[index]?.kind);
    return panels.map((p, i) => (i === index ? { ...p, width: target } : p));
}
/** Shift+drag: EVERY pane scales by its snapshot share of the row — ratios
 *  are preserved (new_i/new_j = snap_i/snap_j) until a pane saturates at a
 *  bound; an extreme drag clamps the row. A degenerate row (total <= 0)
 *  returns the input order untouched. */
export function scaleProportionally(panels, snapshots, delta, clamp = identityClamp) {
    const total = snapshots.reduce((sum, w) => sum + w, 0);
    if (total <= 0)
        return [...panels];
    return panels.map((p, i) => ({
        ...p,
        width: clamp(snapshots[i] + (snapshots[i] / total) * delta, panels[i]?.kind)
    }));
}
/** Honest-slider check: a row is uniform when every width equals the
 *  first (an empty row is not — nothing to sync the preset to). */
export function isUniformRow(panels) {
    if (panels.length === 0)
        return false;
    const first = panels[0].width;
    return panels.every((p) => p.width === first);
}
/** Move one pane one slot toward the direction's edge — left/up swap with
 *  the predecessor, right/down with the successor. A no-op returning the
 *  input order at either edge or for an unknown pane id. */
export function movePanelWithin(panels, panelId, dir) {
    const idx = panels.findIndex((p) => p.id === panelId);
    if (idx === -1)
        return [...panels];
    const target = dir === 'left' || dir === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= panels.length)
        return [...panels];
    const next = [...panels];
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
}
