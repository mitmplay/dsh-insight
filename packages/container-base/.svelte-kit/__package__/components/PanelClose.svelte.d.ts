type $$ComponentProps = {
    sessionId: string;
    lens?: boolean;
    onremove?: (detail: {
        shiftKey: boolean;
    }) => void;
    closeLabel?: string;
    closeHint?: string;
};
declare const PanelClose: import("svelte").Component<$$ComponentProps, {}, "">;
type PanelClose = ReturnType<typeof PanelClose>;
export default PanelClose;
