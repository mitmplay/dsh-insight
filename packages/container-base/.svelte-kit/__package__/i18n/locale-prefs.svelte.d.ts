export interface LocalePrefsOptions {
    /** The un-suffixed localStorage key (e.g. 'dsi.locale', 'pg.locale'). */
    baseKey: string;
    /** The mirror cookie name. The consumer's SSR chain reads THIS name. */
    cookieName: string;
    /** The valid locale ids — anything else is junk. */
    locales: readonly string[];
    /** Fallback when nothing (or junk) is stored. */
    defaultLocale: string;
    /** Cookie lifetime seconds (default ~400 days, matching common SSR locale cookies). */
    cookieMaxAge?: number;
}
export interface LocalePrefs {
    readonly locale: string;
    /** The exact storage key this store uses for a profile. */
    key(profile?: string | null): string;
    /** Boot-time adoption: resolve cookie → storage → default into state. */
    adopt(): void;
    /** Validate + dual-write (storage + cookie) + update state. */
    set(next: string): void;
    /** Raw resolution without touching state (SSR-safe). */
    read(): string;
}
export declare function createLocalePrefs(options: LocalePrefsOptions): LocalePrefs;
