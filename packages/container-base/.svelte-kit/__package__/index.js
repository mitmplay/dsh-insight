/**
 * @deepseek-insight/container-base — the ONLY public entry.
 * Internals are reached exclusively through here (no deep imports).
 */
/** Probe export for workspace resolution (Wave 1); real surface lands W2+. */
export const CONTAINER_BASE_VERSION = '0.1.0';
// ── components (W4, D6/D8) ──
export { default as PanelsZoom } from './components/PanelsZoom.svelte';
export { default as ResizeGutter } from './components/ResizeGutter.svelte';
export { default as RailColumn } from './components/RailColumn.svelte';
export { default as PaneBase } from './components/PaneBase.svelte';
export { default as PanelHeaderSkeleton } from './components/PanelHeaderSkeleton.svelte';
export { default as ChordPaletteOverlay } from './components/ChordPaletteOverlay.svelte';
export { default as WidthBadge } from './components/WidthBadge.svelte';
// ── capture + close (R6, ADR-0066) ──
export { default as CanvasCopyButton } from './components/CanvasCopyButton.svelte';
export { default as PanelClose } from './components/PanelClose.svelte';
export { resizeOne, scaleProportionally, isUniformRow, movePanelWithin } from './layout/floor-math';
export { slotAfter, insertAtAnchor, focusedSlot } from './layout/placement';
// ── interaction (W5, D5) ──
export { CHORD_WINDOW_MS, IDLE_CHORD, chordKey, decideChordKeydown, hasAnyPreset, isEditableTarget } from './interaction/chord-machine';
export { createGutterResize } from './interaction/gutter-resize';
// ── registry (W3, D8) ──
export { createActionTable } from './registry/action-registry';
// ── panel-kind registry (R4 W2, ADR-0065) ──
export { revivePanels, clampKindWidth, resizeAllByRegistry, definePanelKind } from './registry/panel-kinds';
// ── storage (W2, D4) ──
export { currentProfile, sanitizeWorkspaceProfile, storageKey } from './storage/namespace';
export { declareRegistryPrefixes, isGrammarCompliant } from './storage/key-grammar';
export { createPrefsStore } from './storage/create-prefs-store';
export { panelsBootScript } from './storage/boot-script';
// ── theming (R2 W2, ADR-0063 D2) ──
export { createThemePrefs } from './theming/theme-prefs.svelte';
export { themeApplierScript } from './theming/applier';
export { default as ThemeToggle } from './theming/ThemeToggle.svelte';
// ── i18n (R2 W3, ADR-0063 D3) ──
export { createLocalePrefs } from './i18n/locale-prefs.svelte';
export { default as LanguageMenu } from './i18n/LanguageMenu.svelte';
// ── sliders (R2 W4, ADR-0063 D4) ──
export { default as SliderWidth, WIDTH_BOUNDS } from './components/SliderWidth.svelte';
export { default as SliderZoom, ZOOM_BOUNDS } from './components/SliderZoom.svelte';
// ── sidebar (R2 W5, ADR-0063 D5) ──
export { default as SidebarContainer, SIDEBAR_COLLAPSED_WIDTH } from './components/SidebarContainer.svelte';
