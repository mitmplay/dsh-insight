/**
 * _args.mjs — pure helpers for glass-url.mjs (ADR-0045 Amendment 5, D9 + D10).
 *
 * Lives beside _connect.mjs so vitest can pin them without touching CDP
 * (the driver connects at import; these never do). Exports are a contract:
 * change them in the same edit that changes glass-url.mjs.
 */

/**
 * Title normalization: fold apostrophes, case, and punctuation runs.
 * @param {string | undefined | null} s
 * @returns {string}
 */
export const norm = (s) => (s || '').toLowerCase().replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * D10 — the eval grammar is parsed, not positional.
 * Inline mode:  [substr?] src           — the LAST arg is always the JS source.
 * b64 mode:     [b64payload, substr?]   — the payload is consumed by the caller
 *               (it already stripped --b64), so anything LEFT is the substring.
 * Returns an object with src and substr, undefined where absent.
 * @param {string[]} rest
 * @param {{ b64?: boolean } | undefined} [opts]
 * @returns {{ src: string | undefined, substr: string | undefined }}
 */
export function parseEvalArgs(rest, opts) {
  const b64 = !!(opts && opts.b64);
  if (b64) {
    return { src: rest[0], substr: rest.length > 1 ? rest[1] : undefined };
  }
  if (rest.length > 1) return { substr: rest[0], src: rest[1] };
  return { src: rest[0], substr: undefined };
}

/**
 * D9 — the play match consumes EVERY play term.
 * True only when every whitespace-split term of play appears in the
 * normalized title. An empty or absent play value means no filter (true) —
 * the yt verb then takes the first result, unchanged behavior.
 * @param {string} title
 * @param {string | undefined | null} play
 * @returns {boolean}
 */
export function matchAllTerms(title, play) {
  const terms = (play || '').split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const t = norm(title);
  return terms.every((term) => t.includes(norm(term)));
}
