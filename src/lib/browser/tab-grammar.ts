/**
 * Shared tab-grammar parser — one grammar, two doors (Svelte components and
 * server routes both import this). Pure and isomorphic: no server-only imports.
 */

export type TabCommand =
  | { kind: 'open'; url?: string; text?: string }
  | { kind: 'focus'; tabId: number; url?: string }
  | { kind: 'close'; tabId: number | 'active' }
  | { kind: 'query-active' }
  | { kind: 'url-or-search'; text: string }
  | { kind: 'error'; error: string };

/** URL-shaped: has a scheme (foo://…) or a dotted host (example.com). */
function isUrlShaped(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[^\s/]+\.[^\s/]{2,}$/.test(s);
}

/** "tab:N" with N a positive integer, else null. */
function matchTabRef(s: string): number | null {
  const m = /^tab:(\d+)$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

export function parseTabCommand(input: string): TabCommand {
  const text = input.trim();
  const lower = text.toLowerCase();

  // "active" → query-active
  if (lower === 'active') return { kind: 'query-active' };

  // "close active" / "close tab:N"
  if (lower === 'close active') return { kind: 'close', tabId: 'active' };
  if (/^close\s+tab:\S+$/i.test(lower)) {
    const ref = text.slice(text.indexOf(':') + 1);
    const n = Number(ref);
    if (Number.isInteger(n) && n >= 1) return { kind: 'close', tabId: n };
    return { kind: 'error', error: `invalid tab reference: tab:${ref}` };
  }

  // "reuse tab:N [url]"
  const reuse = /^reuse\s+(\S+)(?:\s+(\S+))?$/i.exec(text);
  if (reuse) {
    const n = matchTabRef(reuse[1]);
    if (n !== null) {
      const url = reuse[2];
      return url ? { kind: 'focus', tabId: n, url } : { kind: 'focus', tabId: n };
    }
    return { kind: 'error', error: `invalid tab reference: ${reuse[1]}` };
  }

  // "change [to] tab:N"
  const change = /^change(?:\s+to)?\s+(\S+)$/i.exec(text);
  if (change) {
    const n = matchTabRef(change[1]);
    if (n !== null) return { kind: 'focus', tabId: n };
    return { kind: 'error', error: `invalid tab reference: ${change[1]}` };
  }

  // bare "tab:N"
  if (/^tab:/i.test(text)) {
    const n = matchTabRef(text);
    if (n !== null) return { kind: 'focus', tabId: n };
    return { kind: 'error', error: `invalid tab reference: ${text}` };
  }

  // "glass <rest>" → open (url or text)
  if (lower === 'glass') return { kind: 'open' };
  if (/^glass\s+/i.test(text)) {
    const rest = text.replace(/^glass\s+/i, '');
    if (isUrlShaped(rest)) return { kind: 'open', url: rest };
    return { kind: 'open', text: rest };
  }

  // anything unmatched → caller turns into web search
  return { kind: 'url-or-search', text: input };
}
