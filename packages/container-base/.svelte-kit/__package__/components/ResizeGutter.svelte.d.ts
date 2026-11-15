type $$ComponentProps = {
    /** The pane index this seam trails — the host's drag payload. */
    index: number;
    /** Accessible name for the seam (consumer-localized). */
    ariaLabel: string;
    /** Hover tooltip (consumer-localized). */
    title: string;
    /** Mousedown — the HOST owns the drag and the clamp. */
    onGutterDown?: (event: MouseEvent) => void;
};
declare const ResizeGutter: import("svelte").Component<$$ComponentProps, {}, "">;
type ResizeGutter = ReturnType<typeof ResizeGutter>;
export default ResizeGutter;
