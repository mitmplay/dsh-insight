import type { Snippet } from 'svelte';
type $$ComponentProps = {
    /** Sticky (fixed) column width in px — triple-locked, never flexes. */
    width: number;
    /** Accessible label for the trailing gutter (consumer-localized). */
    label: string;
    /** Trailing resize gutter — only when pane columns follow (OCI). */
    showGutter?: boolean;
    /** Gutter mousedown — the host runs the drag and owns the clamp. */
    onResizeStart?: (e: MouseEvent) => void;
    children: Snippet;
};
declare const RailColumn: import("svelte").Component<$$ComponentProps, {}, "">;
type RailColumn = ReturnType<typeof RailColumn>;
export default RailColumn;
