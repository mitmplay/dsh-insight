import type { Snippet } from 'svelte';
type $$ComponentProps = {
    /** Tooltip for the whole strip (the consumer's label text). */
    title?: string;
    /** Selection cue — the selected column's header carries the wash. */
    selected?: boolean;
    /** The label span's testid — the consumer's DOM hook (its own
     *  variants override; the default hook is the consumer's choice). */
    labelTestId?: string;
    /** The strip element — bind back for geometry-aimed verbs. */
    headerEl?: HTMLDivElement | undefined;
    /** Leading slot: the identity (label, copy control). */
    leading: Snippet;
    /** Actions slot: the verbs (chevrons, capture, close). */
    actions: Snippet;
};
declare const PanelHeaderSkeleton: import("svelte").Component<$$ComponentProps, {}, "headerEl">;
type PanelHeaderSkeleton = ReturnType<typeof PanelHeaderSkeleton>;
export default PanelHeaderSkeleton;
