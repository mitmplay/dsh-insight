type $$ComponentProps = {
    collapsed?: boolean;
    onToggle?: () => void;
    label?: string;
    labelCollapsed?: string;
    testid?: string;
    class?: string;
    size?: number;
};
declare const SidebarCollapseButton: import("svelte").Component<$$ComponentProps, {}, "">;
type SidebarCollapseButton = ReturnType<typeof SidebarCollapseButton>;
export default SidebarCollapseButton;
