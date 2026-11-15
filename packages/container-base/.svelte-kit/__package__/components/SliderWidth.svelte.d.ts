/**
 * SliderWidth — the honest uniform-width control (ADR-0063 D4, moved
 * from DSI's control bar). Default bounds are the panel-prefs defaults
 * the floor clamps against (480..860, step 1); a consumer overrides
 * them via props — the clamp site stays the CONSUMER's (the commit
 * callback routes wherever the route owner decides), so the
 * single-bound-site rule holds. Every thumb move commits (per-input
 * cadence) — panels resize LIVE under the dragging thumb.
 */
export declare const WIDTH_BOUNDS: {
    readonly min: 480;
    readonly max: 860;
    readonly step: 1;
};
type $$ComponentProps = {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    oncommit?: (width: number) => void;
    caption?: import('svelte').Snippet<[number]>;
    ariaLabel: string;
    testId?: string;
};
declare const SliderWidth: import("svelte").Component<$$ComponentProps, {}, "value">;
type SliderWidth = ReturnType<typeof SliderWidth>;
export default SliderWidth;
