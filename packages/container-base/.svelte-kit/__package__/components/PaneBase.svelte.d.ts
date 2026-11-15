import type { Snippet } from 'svelte';
type $$ComponentProps = {
    /** Column width in px — triple-locked inline (width/min/max). */
    width: number;
    /** The pane's id — data-panel-id (the zoom's selection-follow hook). */
    paneId: string;
    /** Opaque session-ish tag — data-session-id (null when the pane
     *  carries no session; the value is never interpreted here). */
    sessionTag?: string | null;
    /** Selection cue — the ring on the selected column. */
    selected?: boolean;
    /** Activate (select) this pane — pointerdown/focusin inside. */
    onactivate?: () => void;
    /** Loupe trigger — Alt+Click release outside a control. */
    onloupe?: () => void;
    /** Header strip slot (the consumer's floor chrome). */
    header: Snippet;
    /** Toolbar slot under the header (badges, controls). */
    toolbar?: Snippet;
    /** Content slot — the pane body. */
    children: Snippet;
    /** Footer slot (after the content). */
    footer?: Snippet;
};
declare const PaneBase: import("svelte").Component<$$ComponentProps, {}, "">;
type PaneBase = ReturnType<typeof PaneBase>;
export default PaneBase;
