type $$ComponentProps = {
    container: HTMLElement | null | undefined;
    title?: string;
    size?: number;
    class?: string;
    /** 'full' (default) — the whole scrollable content (the historic
     *  contract). 'visible' — ONLY what is on screen: the scroll
     *  origin is compensated with a translateY(-scrollTop) clone and
     *  the render is cropped to the container's client box
     *  (PromptManagerToolbar, 2026-09-19). */
    mode?: 'full' | 'visible';
    /** Anchor hook (R11, ADR-0074): defaults to the historic
     *  canvas-copy-button so existing specs stay byte-compatible. */
    testid?: string;
};
declare const CanvasCopyButton: import("svelte").Component<$$ComponentProps, {}, "">;
type CanvasCopyButton = ReturnType<typeof CanvasCopyButton>;
export default CanvasCopyButton;
