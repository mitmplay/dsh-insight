type $$ComponentProps = {
    /** The consumer-owned filter text (the organ never holds state). */
    value?: string;
    /** Keystrokes out — the raw input value, nothing interpreted. */
    oninput?: (value: string) => void;
    placeholder?: string;
    testid?: string;
    ariaLabel?: string;
};
declare const PanelListboxFilter: import("svelte").Component<$$ComponentProps, {}, "">;
type PanelListboxFilter = ReturnType<typeof PanelListboxFilter>;
export default PanelListboxFilter;
