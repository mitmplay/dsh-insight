/**
 * Capture-color organ (ADR-0066 R6): the raw hexes the canvas renderer
 * must own. Components may not carry raw color literals (tokens law, D7),
 * so the capture floor and scrollbar-overlay fallbacks live HERE — the
 * theme module — beside the tokens they mirror.
 */
/** The opaque capture floor — mirrors --color-surface (app.css). */
export const CAPTURE_BACKING = '#f8f9fa';
/** Fake scrollbar track/thumb fallbacks when the CSS vars are absent. */
export const CAPTURE_TRACK_FALLBACK = '#f8f9fa';
export const CAPTURE_THUMB_FALLBACK = 'rgba(0,0,0,0.25)';
