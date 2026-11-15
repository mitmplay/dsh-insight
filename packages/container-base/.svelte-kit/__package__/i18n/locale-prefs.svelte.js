// The base locale survival store (ADR-0063 D3): a client-side choice with
// DUAL-WRITE persistence — localStorage[<baseKey>] (profile-suffixed via
// storage/namespace) AND a mirror cookie the consumer names (DSI passes
// 'dsi.locale' so its SSR chain stays the reader; the base only mirrors,
// never races the SSR chain). Reads resolve cookie first, then storage,
// then the consumer default. Junk is junk: anything outside the
// consumer's locale list falls back to the default, never throws.
//
// SSR (no document / no localStorage): reads return the default, writes
// are silent no-ops — the consumer's SSR chain owns truth.
import { currentProfile, storageKey } from '../storage/namespace';
function readCookie(name) {
    if (typeof document === 'undefined')
        return null;
    try {
        const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.$?*|{}()\[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
    }
    catch {
        return null;
    }
}
export function createLocalePrefs(options) {
    const { baseKey, cookieName, locales, defaultLocale } = options;
    const maxAge = options.cookieMaxAge ?? 34560000;
    let locale = $state(defaultLocale);
    // profile resolution via the namespace module's ONE currentProfile()
    // (ADR-0065 R4 promotion; was a private copy)
    const keyFor = (profile) => storageKey(baseKey, profile ?? currentProfile());
    const resolve = () => {
        const cookie = readCookie(cookieName);
        if (cookie !== null && locales.includes(cookie))
            return cookie;
        if (typeof localStorage !== 'undefined') {
            try {
                const raw = localStorage.getItem(keyFor());
                if (raw !== null && locales.includes(raw))
                    return raw;
            }
            catch {
                // blocked storage — the cookie already had its say
            }
        }
        return defaultLocale;
    };
    const persist = (next) => {
        if (typeof localStorage !== 'undefined') {
            try {
                localStorage.setItem(keyFor(), next);
            }
            catch {
                // store full or blocked — the cookie still holds the choice
            }
        }
        if (typeof document !== 'undefined') {
            try {
                document.cookie = cookieName + '=' + encodeURIComponent(next) + '; path=/; max-age=' + maxAge + '; samesite=lax';
            }
            catch {
                // cookie write blocked — the storage mirror holds
            }
        }
    };
    return {
        get locale() {
            return locale;
        },
        key(profile) {
            return keyFor(profile);
        },
        read() {
            return resolve();
        },
        adopt() {
            locale = resolve();
        },
        set(next) {
            if (!locales.includes(next))
                return; // junk → silent no-op
            locale = next;
            persist(next);
        }
    };
}
