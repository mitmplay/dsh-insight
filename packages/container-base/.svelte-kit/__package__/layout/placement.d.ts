/**
 * placement — the generic order/anchor math of a pane floor (ADR-0062 W3,
 * D8: split from DSI's panel-placement; the kind-tagged request union and
 * DSI-specific branches stay in the consumer). PURE, list-shaped only.
 */
/** The slot directly BELOW an anchor pane — anchor + 1 — or the caller's
 *  fallback when no pane carries the anchor (anchorIndex < 0). The
 *  fork-child / below-the-explorer slot rule. */
export declare function slotAfter(anchorIndex: number, fallback: number): number;
/** Insert ONE item at an anchor index. Boundary anchors clamp: an empty
 *  list (or an anchor past the end) appends; a negative anchor inserts at
 *  the front. Ordering is stable — existing members never reorder. */
export declare function insertAtAnchor<T>(list: readonly T[], anchorIndex: number, item: T): T[];
/** The focused-slot rule: a fresh item lands at the FOCUSED index —
 *  immediately before it. 0 when nothing is focused (negative or past the
 *  end) — front-add stays the fallback; Math.max keeps splice's
 *  negative-index semantics out of the no-selection case. */
export declare function focusedSlot(selectedIndex: number, listLength: number): number;
