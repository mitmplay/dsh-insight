export interface PrefsStoreOptions<T> {
    /** The un-suffixed localStorage key (namespaced per profile). */
    key: string;
    /** Persisted defaults — a factory, so callers never share object state. */
    defaults: () => T;
    /** Parse a parsed-JSON value into prefs; return null to reject the blob
     *  as junk (load falls back to defaults). */
    revive: (raw: unknown) => T | null;
    /** Optional bound pass, applied to the revived value (after revive). */
    clamp?: (prefs: T) => T;
    /** Opt-in `{v, data}` envelope — new consumers only (D4); read-side
     *  still accepts a bare (legacy) blob so adoption is one-way safe. */
    envelope?: {
        version: number;
    };
}
export interface PrefsStore<T> {
    /** Read from localStorage; defaults on SSR, absence, junk, or error. */
    load(profile?: string | null): T;
    /** Write to localStorage (best-effort; no-op under SSR). */
    save(prefs: T, profile?: string | null): void;
    /** The exact key this store reads/writes for a profile. */
    key(profile?: string | null): string;
}
export declare function createPrefsStore<T>(options: PrefsStoreOptions<T>): PrefsStore<T>;
