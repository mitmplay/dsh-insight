type $$ComponentProps = {
    ariaLabel?: string;
    testId?: string;
    triggerTestId?: string;
    trayTestId?: string;
    /** Uniform-panel width preset (bind: up to the route). */
    panelWidth?: number;
    /** Floor zoom multiplier (bind: up to the route). */
    zoom?: number;
    /** Commit a new uniform width on every thumb move. */
    onresizeall?: (width: number) => void;
    /** The floor capture target — null (the default) renders no row. */
    captureContainer?: HTMLElement | null;
    captureTitle?: string;
    captureMode?: 'full' | 'visible';
    captureRowLabel?: string;
    captureRowTestId?: string;
    widthMin?: number;
    widthMax?: number;
    widthStep?: number;
    widthCaption?: import('svelte').Snippet<[number]>;
    widthAriaLabel?: string;
    widthTestId?: string;
    zoomMin?: number;
    zoomMax?: number;
    zoomStep?: number;
    zoomCaption?: import('svelte').Snippet<[number]>;
    zoomAriaLabel?: string;
    zoomTestId?: string;
    /** Consumer extras (DSI: AddPanel) — rendered only when passed. */
    extras?: import('svelte').Snippet;
    /** Optional tray-body override (see prop comment). */
    tray?: import('svelte').Snippet;
};
declare const ControlBar: import("svelte").Component<$$ComponentProps, {}, "panelWidth" | "zoom">;
type ControlBar = ReturnType<typeof ControlBar>;
export default ControlBar;
