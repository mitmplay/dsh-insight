type $$ComponentProps = {
    /** True between the arming chord and the fire / disarm / decay. */
    open: boolean;
    /** The live options, already filtered by the consumer's reducer. */
    rows: {
        key: string;
        label: string;
    }[];
    /** Date.now() of the arming — the decay clock's zero. */
    since: number;
    /** The consumer's action-window length (ms) — inside it the bar
     *  reads in-action; the consumer owns the semantics (ADR-0052). */
    windowMs: number;
    /** The idle window before the overlay closes itself (default 10s). */
    idleCloseMs?: number;
    /** The strip title (consumer-localized, names the armed prefix). */
    title: string;
    /** Accessible name for the overlay (consumer-localized). */
    ariaLabel: string;
    /** Fired once at 100% — the host resets the chord. */
    onexpire?: () => void;
};
declare const ChordPaletteOverlay: import("svelte").Component<$$ComponentProps, {}, "">;
type ChordPaletteOverlay = ReturnType<typeof ChordPaletteOverlay>;
export default ChordPaletteOverlay;
