/**
 * @deepseek-insight/container-base — the ONLY public entry.
 * Internals are reached exclusively through here (no deep imports).
 */
/** Probe export for workspace resolution (Wave 1); real surface lands W2+. */
export declare const CONTAINER_BASE_VERSION = "0.2.0";
export { default as PanelsZoom } from './components/PanelsZoom.svelte';
export { default as ResizeGutter } from './components/ResizeGutter.svelte';
export { default as RailColumn } from './components/RailColumn.svelte';
export { default as PaneBase } from './components/PaneBase.svelte';
export { default as PanelHeaderSkeleton } from './components/PanelHeaderSkeleton.svelte';
export { default as ChordPaletteOverlay } from './components/ChordPaletteOverlay.svelte';
export { default as WidthBadge } from './components/WidthBadge.svelte';
export { default as CanvasCopyButton } from './components/CanvasCopyButton.svelte';
export { default as PanelClose } from './components/PanelClose.svelte';
export { default as SidebarCollapseButton } from './components/SidebarCollapseButton.svelte';
export type { PaneCore, WidthClamp, PaneMoveDir } from './layout/floor-math';
export { resizeOne, scaleProportionally, isUniformRow, movePanelWithin } from './layout/floor-math';
export { slotAfter, insertAtAnchor, focusedSlot } from './layout/placement';
export { CHORD_WINDOW_MS, IDLE_CHORD, chordKey, decideChordKeydown, hasAnyPreset, isEditableTarget } from './interaction/chord-machine';
export type { ChordPrefix, ChordState, ChordKey, ChordAction, ChordTables, ChordOptionRow } from './interaction/chord-machine';
export { createGutterResize } from './interaction/gutter-resize';
export type { GutterResizeMachine } from './interaction/gutter-resize';
export { createActionTable } from './registry/action-registry';
export type { ActionTable } from './registry/action-registry';
export { revivePanels, clampKindWidth, deskEntries, resizeAllByRegistry, definePanelKind } from './registry/panel-kinds';
export type { PanelKindDeclaration, KnobDeclaration, ReviveHooks, ReviveResult, WidthBand } from './registry/panel-kinds';
export { currentProfile, sanitizeWorkspaceProfile, storageKey } from './storage/namespace';
export { declareRegistryPrefixes, isGrammarCompliant } from './storage/key-grammar';
export { createPrefsStore } from './storage/create-prefs-store';
export type { PrefsStore, PrefsStoreOptions } from './storage/create-prefs-store';
export { panelsBootScript } from './storage/boot-script';
export { createThemePrefs } from './theming/theme-prefs.svelte';
export type { ThemeChoice, ResolvedTheme, ThemePrefs, ThemePrefsOptions } from './theming/theme-prefs.svelte';
export { themeApplierScript } from './theming/applier';
export { default as ThemeToggle } from './theming/ThemeToggle.svelte';
export { createLocalePrefs } from './i18n/locale-prefs.svelte';
export type { LocalePrefs, LocalePrefsOptions } from './i18n/locale-prefs.svelte';
export { default as LanguageMenu } from './i18n/LanguageMenu.svelte';
export { default as ControlBar } from './components/ControlBar.svelte';
export { default as ControlBarTray } from './components/ControlBarTray.svelte';
export { default as SliderWidth, WIDTH_BOUNDS } from './components/SliderWidth.svelte';
export { default as SliderZoom, ZOOM_BOUNDS } from './components/SliderZoom.svelte';
export { default as SidebarContainer, SIDEBAR_COLLAPSED_WIDTH } from './components/SidebarContainer.svelte';
export { default as PanelListbox } from './components/PanelListbox.svelte';
export { default as PanelListboxHeader } from './components/PanelListboxHeader.svelte';
export { default as PanelListboxList } from './components/PanelListboxList.svelte';
export { default as PanelListboxListItem } from './components/PanelListboxListItem.svelte';
export { default as PanelListboxFilter } from './components/PanelListboxFilter.svelte';
