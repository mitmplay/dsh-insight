/**
 * Storage-key grammar — the naming law for every consumer storage key that
 * reaches this package (ADR-0065 D9). Enforcement lives in the TEST suite
 * (tests/storage/key-grammar.test.ts), never as a runtime throw: the
 * runtime keeps accepting legacy keys so the nine existing DSI consumers
 * cannot break (karpathy-context L2.6, binding resolution).
 *
 *   grammar:  <prefix>-<name>[_<profile>]
 *   prefix:   declared consumer identity — 'dsi' | 'pg' | 'cb' (…)
 *   name:     lowercase alphanumeric segments joined by '-'
 *   profile:  the suffix ONLY via storageKey(base, profile)
 *             (src/storage/namespace.ts stays the runtime suffix owner)
 *
 * The drift this law exists for (ADR-0065 D9): the playground shipped
 * dot-separated keys ('pg.panel', 'pg.locale') — two separators in one
 * package surface. Wave 4 renames them; this module is the citable law.
 */
/**
 * Freeze a declared prefix list into the registry grammar.
 * @param prefixes consumer identity prefixes, e.g. ['dsi', 'pg', 'cb'].
 * @returns a frozen copy; invalid entries throw at declaration time (this
 *          is a programmer error, not data — throws are allowed here,
 *          D9 restricts runtime throws on KEY strings only).
 */
export declare function declareRegistryPrefixes(prefixes: readonly string[]): readonly string[];
/**
 * Test a storage key against the grammar with the declared prefixes.
 * Pure predicate — never throws on the key, never mutates anything.
 * @param key the full storage key (profile suffix included or not).
 * @param prefixes prefixes declared via declareRegistryPrefixes.
 */
export declare function isGrammarCompliant(key: string, prefixes: readonly string[]): boolean;
