import type { Snippet } from 'svelte';
type $$ComponentProps = {
    collapsed?: boolean;
    onToggle?: () => void;
    count?: number;
    emptysnippet?: Snippet;
    header?: Snippet;
    children?: Snippet;
    testid?: string;
    class?: string;
};
declare const PanelListbox: import("svelte").Component<$$ComponentProps, {}, "">;
type PanelListbox = ReturnType<typeof PanelListbox>;
export default PanelListbox;
