/**
 * The pre-paint theme applier — an inline SCRIPT SOURCE STRING the consumer
 * embeds in its HTML template (ADR-0063 D2). It re-derives the storage key
 * with the SAME grammar as theming/theme-prefs.svelte.ts (namespace.ts:
 * <baseKey> + '_' + sanitized ?profile=), reads the choice, resolves system
 * against the OS, and sets html[data-theme] BEFORE first paint — no flash.
 *
 * It cannot import modules (it runs before the bundle), so the derivation is
 * generated from this one function: consumers never hand-copy it.
 *
 * Pure string generation — no runes — so plain node (strip-types) can import
 * it for HTML template generation (scripts/sync-theme-applier.mjs).
 */
/** Generate the inline script source for a consumer's theme base key. */
export declare function themeApplierScript(baseKey: string): string;
