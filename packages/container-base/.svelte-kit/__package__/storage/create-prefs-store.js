/**
 * createPrefsStore — the survival-layer primitive (ADR-0062 D4).
 *
 * Nine consumer modules hand-rolled one pattern: SSR guard → revive with
 * junk fallback → clamp → best-effort write. This is that pattern, once:
 *
 *   const store = createPrefsStore<MyPrefs>({
 *     key: 'my-key',
 *     defaults: () => ({ ... }),
 *     revive: (raw) => sanitize(raw),   // return null ⇒ junk ⇒ defaults
 *     clamp: (v) => bound(v)
 *   });
 *
 * Semantics (pinned by tests/storage/create-prefs-store.test.ts):
 * - SSR (`typeof localStorage === 'undefined'`): load → defaults, save → no-op.
 * - junk / truncated / unparseable blob → defaults, never throws.
 * - clamp runs AFTER revive, on every load.
 * - writes are best-effort: a full or blocked store never throws.
 * - blob shapes are consumer-owned: the stored text is exactly
 *   JSON.stringify(prefs) unless the consumer opts into the `{v, data}`
 *   envelope (new consumers only — existing blobs never migrate, D4).
 */
import { currentProfile, storageKey } from './namespace';
/** True when the parsed JSON carries the envelope wrapper. */
function isEnvelope(raw) {
    if (raw === null || typeof raw !== 'object')
        return false;
    const rec = raw;
    return 'v' in rec && 'data' in rec;
}
export function createPrefsStore(options) {
    const { key, defaults, revive, clamp, envelope } = options;
    // ADR-0065 R4: an OMITTED profile auto-resolves from the URL's ?profile
    // param via the namespace resolver — the base owns the read, the app
    // passes nothing. An EXPLICIT value (including null = default desk)
    // always wins, so existing threading consumers are byte-identical.
    const keyFor = (profile) => storageKey(key, profile === undefined ? currentProfile() : profile);
    const finalize = (prefs) => (clamp ? clamp(prefs) : prefs);
    return {
        key: keyFor,
        load(profile) {
            if (typeof localStorage === 'undefined')
                return defaults();
            try {
                const raw = localStorage.getItem(keyFor(profile));
                if (!raw)
                    return defaults();
                const parsed = JSON.parse(raw);
                const body = envelope !== undefined && isEnvelope(parsed) ? parsed.data : parsed;
                const revived = revive(body);
                if (revived === null)
                    return defaults();
                return finalize(revived);
            }
            catch {
                return defaults();
            }
        },
        save(prefs, profile) {
            if (typeof localStorage === 'undefined')
                return;
            try {
                const payload = envelope !== undefined ? { v: envelope.version, data: prefs } : prefs;
                localStorage.setItem(keyFor(profile), JSON.stringify(payload));
            }
            catch {
                // Store full or blocked — persistence is lost, the app is not.
            }
        }
    };
}
