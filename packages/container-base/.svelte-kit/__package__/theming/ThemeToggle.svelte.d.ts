/**
     * ThemeToggle — the generic three-state lamp mount (ADR-0063 D2).
     * The MECHANISM lives in theming/theme-prefs.svelte.ts; this component
     * carries NO words and NO skin: every label comes in as a prop, every
     * icon as a snippet, every color as a token var (boundary suite).
     * Structure follows the DSI footer lamp: one trigger whose icon is the
     * current choice, a popup with the three states, check on the active
     * one, click-outside closes, dropUp for rail-bottom mounts.
     */
import type { Component } from 'svelte';
export type ThemeChoice = 'system' | 'light' | 'dark';
type $$ComponentProps = {
    prefs: {
        readonly choice: ThemeChoice;
        set: (c: ThemeChoice) => void;
    };
    triggerLabel: string;
    optionLabels: Record<ThemeChoice, string>;
    icons: Record<ThemeChoice, Component<{
        size?: number;
        'aria-hidden'?: boolean | 'true' | 'false';
    }>>;
    dropUp?: boolean;
};
declare const ThemeToggle: Component<$$ComponentProps, {}, "">;
type ThemeToggle = ReturnType<typeof ThemeToggle>;
export default ThemeToggle;
