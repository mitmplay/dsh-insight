import type { Snippet } from 'svelte';
type $$ComponentProps = {
    selected?: boolean;
    linked?: boolean;
    /** Present → the row renders an anchor (that still fires onselect). */
    href?: string;
    /** The click event forwards so the consumer may preventDefault a handled
     *  anchor click (the shelf's registry click-through, ADR-0071 D2). */
    onselect?: (event: MouseEvent) => void;
    testid?: string;
    class?: string;
    children?: Snippet;
};
declare const PanelListboxListItem: import("svelte").Component<$$ComponentProps, {}, "">;
type PanelListboxListItem = ReturnType<typeof PanelListboxListItem>;
export default PanelListboxListItem;
