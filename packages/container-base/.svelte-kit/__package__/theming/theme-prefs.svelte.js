// The base Three-State Lamp — the switch MECHANISM (ADR-0063 D2, moved out
// of DSI's hand-rolled twin). Owns a three-state choice (system / light /
// dark), persists it under localStorage[<baseKey>], resolves it against the
// OS, and sets html[data-theme] — the single hinge the token layer reads.
// The ONLY other place that derives the storage key is the inline pre-paint
// applier (theming/applier.ts) the consumer inlines in its HTML template;
// key grammar flows through storage/namespace so the two cannot drift.
// Key grammar: EVERY <baseKey> is profile-scoped (?profile= param), so each
// desk remembers its own lamp.
import { currentProfile, storageKey } from '../storage/namespace';
export function createThemePrefs(options) {
    const baseKey = options.baseKey;
    /** The active workspace profile — resolved by the namespace module's
     * ONE currentProfile() (ADR-0065 R4 promotion; was a private copy). */
    const storageKeyFor = () => storageKey(baseKey, currentProfile());
    const osPrefersDark = () => typeof window !== 'undefined' &&
        !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    /** Defensive read — SSR-safe, junk -> system. */
    const readStoredChoice = () => {
        if (typeof localStorage === 'undefined')
            return 'system';
        try {
            const raw = localStorage.getItem(storageKeyFor());
            return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
        }
        catch {
            return 'system';
        }
    };
    const resolve = (choice) => choice === 'system' ? (osPrefersDark() ? 'dark' : 'light') : choice;
    let choice = $state('system');
    let resolved = $state('light');
    let listeningMq = null;
    const apply = () => {
        if (typeof document !== 'undefined')
            document.documentElement.dataset.theme = resolved;
    };
    const persist = () => {
        if (typeof localStorage === 'undefined')
            return;
        try {
            localStorage.setItem(storageKeyFor(), choice);
        }
        catch {
            /* blocked storage — the attribute still flips for this session */
        }
    };
    return {
        get choice() {
            return choice;
        },
        get resolved() {
            return resolved;
        },
        adopt() {
            choice = readStoredChoice();
            const attr = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
            if (attr === 'dark' || attr === 'light') {
                resolved = attr;
            }
            else {
                resolved = resolve(choice);
                apply();
            }
            this.listen();
        },
        set(next) {
            choice = next;
            resolved = resolve(next);
            persist();
            apply();
        },
        listen() {
            if (typeof window === 'undefined' || !window.matchMedia)
                return;
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            if (listeningMq === mq)
                return; // one listener per media-query object
            listeningMq = mq;
            mq.addEventListener('change', (e) => {
                if (choice !== 'system')
                    return; // pinned ignores the OS
                resolved = e.matches ? 'dark' : 'light';
                apply();
            });
        }
    };
}
