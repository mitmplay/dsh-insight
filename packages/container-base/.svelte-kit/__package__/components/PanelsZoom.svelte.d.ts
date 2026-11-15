type $$ComponentProps = {
    /** Floor zoom multiplier (clamped by the consumer's prefs — one clamp site). */
    zoom?: number;
    /** Open panels — the geometry fingerprint source (widths + count)
     *  and the reorder fingerprint source (the id sequence). */
    panels: Array<{
        id: string;
        width: number;
    }>;
    /** Leading sticky-column width (px) — the embedded rail column;
     *  null/undefined = no rail column.
     *  RIDES THE FINGERPRINT (OCI `leading ? railWidth : ''`): mounting,
     *  unmounting, or resizing the rail changes row.scrollWidth, and
     *  scrollWidth itself is not reactive — the fingerprint is. */
    railWidth?: number | null;
    /** The focused panel's id — the selection-follow target: when it
     *  changes, a column the viewport cannot see is scrolled into view
     *  (the floor can be several viewports wide; the selection ring
     *  must never sit off-screen behind the scroll edge). */
    selectedPanelId?: string | null;
    /** Snippet: one rendered child per panel. */
    children: import('svelte').Snippet;
};
declare const PanelsZoom: import("svelte").Component<$$ComponentProps, {}, "">;
type PanelsZoom = ReturnType<typeof PanelsZoom>;
export default PanelsZoom;
