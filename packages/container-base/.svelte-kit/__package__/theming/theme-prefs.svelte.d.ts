export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export interface ThemePrefsOptions {
    /** The un-suffixed localStorage key (e.g. 'dsi-theme', 'pg-theme'). */
    baseKey: string;
}
export interface ThemePrefs {
    readonly choice: ThemeChoice;
    readonly resolved: ResolvedTheme;
    /** Mount-time adoption: the pre-paint applier already resolved and set
     * the attribute before the bundle ran — ADOPT it (flash-free),
     * re-deriving the choice from storage. Paints only when the attribute
     * was somehow missing. */
    adopt(): void;
    /** Persist the CHOICE (never the resolved value — system keeps following
     * the OS), then paint. */
    set(next: ThemeChoice): void;
    /** Live OS following, only while the choice is system. */
    listen(): void;
}
export declare function createThemePrefs(options: ThemePrefsOptions): ThemePrefs;
