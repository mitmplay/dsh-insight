/**
 * Gutter resize — the SINGLE sidebar-style drag machine (SSC#2 extraction,
 * 2026-11-14): one width, snapshot on gutter mousedown, clamped delta per
 * window mousemove, settle on window mouseup. Both consumers DSI has run
 * byte-similar copies of this skeleton (route `startSidebarResize` +
 * playground page drag vars); this module is now its only home.
 *
 * The machine OWNS: the window-listener lifecycle (attached on a
 * successful start, released on settle), the delta arithmetic, the
 * candidate width (snapshot + delta), and the clamp pass. The host OWNS:
 * the bounds (clamp fn — DSI's are config-driven), the apply (write the
 * width wherever it lives), and the settle (persistence, afterglow).
 *
 * A mousedown that returns null from `onStart` arms nothing — a host with
 * collapsed/ignored states uses that instead of pre-gating the gutter.
 */
export interface GutterResizeMachine {
    /** Gutter mousedown — arms the machine and attaches the window
     *  listeners when `onStart` returns a snapshot width (null = ignore). */
    start: (e: MouseEvent) => void;
    /** True while dragging (start succeeded, settle not yet fired). */
    readonly active: boolean;
    /** Release the window listeners without settling (page teardown). */
    destroy: () => void;
}
export declare function createGutterResize(handlers: {
    /** Gutter mousedown: return the SNAPSHOT width (the width the drag
     *  moves away from), or null to ignore this gesture. */
    onStart: (e: MouseEvent) => number | null;
    /** The host's bounds — a pure width -> width clamp. */
    clamp: (width: number) => number;
    /** Apply the clamped width — called per window mousemove while armed. */
    onResize: (width: number, e: MouseEvent) => void;
    /** Settle on window mouseup: persist, arm afterglow, etc. The final
     *  clamped width is the one the last resize produced. */
    onSettle?: (width: number) => void;
}): GutterResizeMachine;
