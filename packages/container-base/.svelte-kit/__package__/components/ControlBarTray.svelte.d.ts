type $$ComponentProps = {
    /** Bound width preset (bind: through ControlBar to the route). */
    panelWidth?: number;
    /** Floor zoom multiplier (bind: through ControlBar to the route). */
    zoom?: number;
    /** Commit a new uniform width on every thumb move. */
    onresizeall?: (width: number) => void;
    /** The capture target (page-owned floor element); null = no row. */
    captureContainer?: HTMLElement | null;
    /** Capture button tooltip — consumer words. */
    captureTitle?: string;
    /** Capture mode ('visible' crops to the client box). */
    captureMode?: 'full' | 'visible';
    /** Capture row accessible name — consumer words. */
    captureRowLabel?: string;
    /** Capture row testid (base default matches the DSI floor suite). */
    captureRowTestId?: string;
    widthMin?: number;
    widthMax?: number;
    widthStep?: number;
    /** Width caption snippet — consumer words (base ships none). */
    widthCaption?: import('svelte').Snippet<[number]>;
    widthAriaLabel?: string;
    widthTestId?: string;
    zoomMin?: number;
    zoomMax?: number;
    zoomStep?: number;
    /** Zoom caption snippet — consumer words. */
    zoomCaption?: import('svelte').Snippet<[number]>;
    zoomAriaLabel?: string;
    zoomTestId?: string;
    /** Consumer extras — rendered only when passed (no empty row). */
    extras?: import('svelte').Snippet;
    /** Tray testid (base default matches the DSI floor suite). */
    trayTestId?: string;
    /** Tray accessible name — consumer words. */
    trayLabel?: string;
};
declare const ControlBarTray: import("svelte").Component<$$ComponentProps, {}, "panelWidth" | "zoom">;
type ControlBarTray = ReturnType<typeof ControlBarTray>;
export default ControlBarTray;
