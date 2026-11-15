/**
 * SliderZoom — the honest floor-zoom control (ADR-0063 D4, moved from
 * DSI's control bar). Default bounds 0.25..1.25 (the floor's zoom
 * scale); prop-overridable. The bound value carries EVERY thumb move
 * live to the owner (PanelsZoom re-measures per move — spec-13's
 * no-phantom-scrollbar contract rides on this cadence).
 */
export declare const ZOOM_BOUNDS: {
    readonly min: 0.25;
    readonly max: 1.25;
    readonly step: 0.001;
};
type $$ComponentProps = {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    oncommit?: (zoom: number) => void;
    caption?: import('svelte').Snippet<[number]>;
    ariaLabel: string;
    testId?: string;
};
declare const SliderZoom: import("svelte").Component<$$ComponentProps, {}, "value">;
type SliderZoom = ReturnType<typeof SliderZoom>;
export default SliderZoom;
