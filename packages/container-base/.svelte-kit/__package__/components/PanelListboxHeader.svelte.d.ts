import type { Snippet } from 'svelte';
type $$ComponentProps = {
    expanded?: boolean;
    onToggle?: () => void;
    label?: string;
    children?: Snippet;
    /** R9 UX amendment: rendered INSIDE the title container after the
     *  label — the search input owns the row's free width (title and
     *  search share one container; trailing stays the icons/pills
     *  cluster, operator feedback 2026-11-18). */
    search?: Snippet;
    trailing?: Snippet;
    testid?: string;
    toggleTestid?: string;
    controls?: string;
    class?: string;
};
declare const PanelListboxHeader: import("svelte").Component<$$ComponentProps, {}, "">;
type PanelListboxHeader = ReturnType<typeof PanelListboxHeader>;
export default PanelListboxHeader;
