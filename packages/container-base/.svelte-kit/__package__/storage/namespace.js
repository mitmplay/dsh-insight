/**
 * Storage namespace — the ONE home of the workspace-profile key convention
 * (generalized from DSI's storage-profile.ts; ADR-0062 D4). Consumer keys
 * keep their exact existing strings: the suffix rule is the only thing
 * this module owns.
 *
 *   no profile   → my-key
 *   ?profile=widi → my-key_widi
 *
 * The profile is sticky and sanitized here once — every prefs store routes
 * its key through the namespace fn so no two call sites re-implement it.
 */
/**
 * Sanitize a raw `?profile=` value into a storage-key-safe segment.
 * Keeps `[A-Za-z0-9_-]` (case preserved — profiles are exact ids), caps at
 * 40 chars; anything that sanitizes to nothing is not a profile.
 * @returns the safe segment, or null when the value carries no usable
 *          characters (the caller then behaves as if no profile were set).
 */
export function sanitizeWorkspaceProfile(raw) {
    const safe = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    return safe.length > 0 ? safe : null;
}
/**
 * The storage key for a workspace profile.
 * @param base the un-suffixed storage key (e.g. 'dsi-panels').
 * @param profile sanitized profile segment, or null/undefined for the
 *                default desk (the base key unchanged).
 */
export function storageKey(base, profile) {
    return profile ? `${base}_${profile}` : base;
}
/**
 * The active workspace profile, read from the sticky `?profile=` param of
 * the CURRENT URL — the ONE resolver for the whole package (ADR-0065 R4:
 * promoted from the private copies in theme-prefs/locale-prefs; the
 * prefs stores auto-resolve an OMITTED profile through it). SSR-safe:
 * no location → null → the bare default-desk key. Explicit profiles
 * always win — this resolver fires only when the caller passes nothing.
 */
export function currentProfile() {
    if (typeof location === 'undefined')
        return null;
    return sanitizeWorkspaceProfile(new URLSearchParams(location.search).get('profile') ?? '');
}
