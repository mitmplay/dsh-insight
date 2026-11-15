/** The collapsed-stub geometry (OCI ControlRail parity — the width the
 *  DSI shell carries as a constant; kept here so base and consumers
 *  agree on the number). */
export declare const SIDEBAR_COLLAPSED_WIDTH = 34;
/**
     * SidebarContainer — the generic sidebar shell (ADR-0063 D5). Contract
     * derived from DSI's AppSidebar (read-first mandate, Tasks 5.1): three
     * branches, one component —
     *
     *   collapsed        → 34px stub; ALL content (skin, words, controls)
     *                      arrives via the `collapsed` snippet — the base
     *                      owns only the geometry and the testid.
     *   embedded         → the BARE rail (no width wrapper, no gutter):
     *                      the hosting column owns both (OCI ControlRail).
     *   standalone       → width-carrying wrapper + badge slot + the rail
     *                      + the drag gutter as the rail's flex SIBLING
     *                      (the rail's overflow:hidden must never clip the
     *                      gutter's hit area — the 2026-09-11 bug).
     *
     * State is OWNED OUTSIDE (props + callbacks): collapse/width/drag live
     * with the page (OCI ownership split); the container renders and
     * reports. Words ride snippets/props; colors ride tokens — sections
     * render via the default snippet so the consumer composes its own.
     */
import type { Component, Snippet } from 'svelte';
type $$ComponentProps = {
    collapsed?: boolean;
    width?: number;
    embedded?: boolean;
    header?: Snippet;
    children?: Snippet;
    collapsedContent?: Snippet;
    collapsedSkin?: Snippet;
    badge?: Snippet;
    onResizeStart?: (e: MouseEvent) => void;
    gutterLabel?: string;
    testId?: string;
    testIdCollapsed?: string;
};
declare const SidebarContainer: Component<$$ComponentProps, {}, "">;
type SidebarContainer = ReturnType<typeof SidebarContainer>;
export default SidebarContainer;
