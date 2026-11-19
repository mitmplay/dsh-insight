type $$ComponentProps = {
    captureContainer?: HTMLElement | null;
    captureTitle?: string;
    /** 'visible' (default) — the corner captures the live viewport box;
     *  'full' — the whole scrollable content. */
    captureMode?: 'full' | 'visible';
    captureSize?: number;
    collapsed?: boolean;
    collapseLabel?: string;
    collapseLabelCollapsed?: string;
    onToggleCollapse?: () => void;
    copyTestId?: string;
    collapseTestId?: string;
    /** Extras (floor tray, gear menus…) — rendered AFTER the two
     *  default organs, never before, never between. */
    children?: import('svelte').Snippet;
};
declare const SidebarHeaderActions: import("svelte").Component<$$ComponentProps, {}, "">;
type SidebarHeaderActions = ReturnType<typeof SidebarHeaderActions>;
export default SidebarHeaderActions;
