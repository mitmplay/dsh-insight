/**
 * Prompt tag filter prefs — the persisted active-tag-filter word arrays
 * (The Prompt Tags ADR, 2026-09-14, D5/D10). ONE read/write seam for the
 * two desks that hold a tag filter:
 *
 *   manager  -> dsi-prompt-tags-filter[_<profile>]
 *   strip    -> dsi-strip-tags-filter[_<profile>]
 *
 * Same desk convention as panel-prefs (every dsi-* key routes through
 * the namespace), different bases: the manager browses the whole library,
 * the strip narrows the current query result — one shared key would make
 * each surface mysteriously pre-filter the other (ADR D10 rejection).
 * Words are grammar-validated on LOAD (the client mirror) so junk
 * persisted by hand or by an older build can never reach the LIKE
 * predicate.
 *
 * ADR-0063 D6: the internals are the base store (createPrefsStore) —
 * same keys, same blob shape (bare JSON array), one store instance per
 * desk base.
 */
import { isValidTagWord } from '$lib/services/chat/prompt-trigger';
import { createPrefsStore, type PrefsStore } from '@deepseek-insight/container-base';

/** Per-desk stores, built lazily (the base arrives as an argument). */
const stores = new Map<string, PrefsStore<string[]>>();

function storeFor(base: string): PrefsStore<string[]> {
	let store = stores.get(base);
	if (!store) {
		store = createPrefsStore<string[]>({
			key: base,
			defaults: () => [],
			revive: (raw) => {
				if (!Array.isArray(raw)) return null; // junk shape -> []
				const seen = new Set<string>();
				const words: string[] = [];
				for (const w of raw) {
					if (typeof w !== 'string') continue;
					const word = w.toLowerCase();
					if (!word || seen.has(word) || !isValidTagWord(word)) continue;
					seen.add(word);
					words.push(word);
				}
				return words;
			}
		});
		stores.set(base, store);
	}
	return store;
}

/**
 * Load a tag-filter word array from its desk slot.
 * @param base the dsi-* key base ('dsi-prompt-tags-filter' | 'dsi-strip-tags-filter')
 * @param profile sanitized workspace profile (null/omitted = default desk)
 * @returns the stored words, lowercased, grammar-valid, deduped; [] on
 *          absent/junk/SSR. Unknown words are dropped, not trusted.
 */
export function loadTagFilter(base: string, profile?: string | null): string[] {
	return storeFor(base).load(profile);
}

/** Persist a tag-filter word array to its desk slot (best-effort). */
export function saveTagFilter(base: string, words: string[], profile?: string | null): void {
	storeFor(base).save(words, profile);
}
