/**
     * LanguageMenu — the generic mount over a LocalePrefs store (ADR-0063 D3).
     * The base carries NO words and NO skin: the language list and its labels
     * are consumer props, the trigger icon is a consumer component, colors
     * cross only through tokens. Native names are NOT translated copy —
     * every locale shows every name in its own language (that is the point
     * of a language menu), which is why they arrive as data, not snippets.
     */
import type { Component } from 'svelte';
type $$ComponentProps = {
    prefs: {
        readonly locale: string;
        set: (next: string) => void;
    };
    locales: readonly string[];
    labels: Record<string, string>;
    triggerLabel: string;
    icon: Component<{
        size?: number;
    }>;
    dropUp?: boolean;
};
declare const LanguageMenu: Component<$$ComponentProps, {}, "">;
type LanguageMenu = ReturnType<typeof LanguageMenu>;
export default LanguageMenu;
