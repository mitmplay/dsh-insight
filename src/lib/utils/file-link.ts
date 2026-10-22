/**
 * file-link — pure predicates for transcript file links (File Link Intent
 * spec, 2026-09-25; ADR The File Link Intent D2/D4). No DOM, no I/O: the
 * sanitizer (markdown.ts) stays pure and the transcript handler stays
 * testable — this module is the shared layer both import.
 *
 * The CONFINEMENT authority is the host (workspace-tree/workspace-file
 * routes refuse outside-workspace reads); these predicates are a client
 * fast-fail, not a security boundary.
 */

/** True when the segment escapes the workspace — never a real file. */
export function hasDotDotSegment(path: string): boolean {
	return path.split('/').some((segment) => segment === '..');
}

/**
 * Should this href be treated as a workspace file link? Scheme-free
 * relative paths only: http(s) is the external branch, anything carrying
 * a scheme (javascript:, data:, mailto:) or a protocol-relative // is
 * refused (BC-12 layering), /api/ is DSI's own capability surface and
 * must never be re-interpreted as a workspace file.
 */
export function isFileLinkHref(href: string): boolean {
	const value = href.trim();
	if (value === '') return false;
	if (/^https?:\/\//i.test(value)) return false;
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
	if (value.startsWith('//')) return false;
	if (value.startsWith('/api/')) return false;
	return true;
}

/**
 * Normalize a file-link href to a workspace-relative path: strip a
 * leading './', collapse duplicate slashes, strip a single leading slash.
 * Returns null when the path escapes the workspace ('..' anywhere) or
 * normalizes to empty.
 */
/**
 * Split a line anchor (#L139, #L139-L150) off a file-link href. The
 * anchor is a DISPLAY hint for the file panel, never part of the path —
 * letting it ride made the host read 404 (workspace-file/not-found,
 * RCA 2026-09-26). Returns the bare path plus the parsed 1-based range
 * (null when absent or malformed — a bad anchor degrades to no target,
 * it never breaks the open).
 */
export function parseFileLinkHref(href: string): {
	path: string;
	lines: { start: number; end: number } | null;
} {
	const value = stripAngleWrapper(href.trim());
	const hash = value.indexOf('#');
	const raw = hash === -1 ? splitColonAnchor(value).path : value.slice(0, hash);
	const anchor = hash === -1 ? '' : value.slice(hash + 1);
	let lines: { start: number; end: number } | null = null;
	if (hash === -1) lines = splitColonAnchor(value).lines;
	// GitHub style #L12-L15 AND the bare #12-15 variant both parse —
	// operators write both; a number is a number.
	const single = anchor.match(/^L?(\d+)$/);
	const range = anchor.match(/^L?(\d+)-L?(\d+)$/);
	if (single) {
		const n = Number(single[1]);
		if (n >= 1) lines = { start: n, end: n };
	} else if (range) {
		const s = Number(range[1]);
		const e = Number(range[2]);
		// 1-based only, and a reversed range is malformed, not swapped —
		// a bad anchor degrades to no target, it never guesses.
		if (s >= 1 && e >= s) lines = { start: s, end: e };
	}
	return { path: normalizeFileLinkPath(raw) ?? '', lines };
}

/** CommonMark angle-bracket destinations (<path> and their %3C/%3E
 *  encodings) are destination syntax, never path bytes - renderers that
 *  hand the wrapper through must not have it reach the host read. */
/**
 * The colon anchor arm (ADR-0028 The Colon Anchor): IDE-style :line
 * suffixes — path/file.ts:334, :10-20 — are the SAME fact as #L anchors
 * in IDE clothes, so they split into the display hint the same way.
 * Digits-only tail after the LAST colon; a malformed tail (:0, :20-10)
 * degrades to no hint and KEEPS the colon in the path (never guesses,
 * hash-grammar posture); any other colon stays path bytes (a:b/c.ts).
 */
function splitColonAnchor(
	value: string
): { path: string; lines: { start: number; end: number } | null } {
	const colon = value.lastIndexOf(':');
	if (colon === -1) return { path: value, lines: null };
	const tail = value.slice(colon + 1);
	const single = tail.match(/^(\d+)$/);
	const range = tail.match(/^(\d+)-(\d+)$/);
	if (single) {
		const n = Number(single[1]);
		if (n >= 1) return { path: value.slice(0, colon), lines: { start: n, end: n } };
	} else if (range) {
		const s = Number(range[1]);
		const e = Number(range[2]);
		if (s >= 1 && e >= s) return { path: value.slice(0, colon), lines: { start: s, end: e } };
	}
	return { path: value, lines: null };
}

function stripAngleWrapper(value: string): string {
	return value
		.replace(/^(?:%3C|<)/i, '')
		.replace(/(?:%3E|>)$/i, '');
}

export function normalizeFileLinkPath(href: string): string | null {
	let value = stripAngleWrapper(href.trim()).replace(/^\.\//, '').replace(/\/{2,}/g, '/');
	// A line anchor is display metadata, not path bytes — strip it before
	// normalization so '#L139' never reaches the host read (RCA above).
	// The colon arm (:139, ADR-0028) rides the same ruling.
	const hash = value.indexOf('#');
	if (hash !== -1) value = value.slice(0, hash);
	value = splitColonAnchor(value).path;
	if (value.startsWith('/')) value = value.slice(1);
	if (value === '' || hasDotDotSegment(value)) return null;
	return value;
}

/**
 * The deep fallback’s root lister: the workspace root’s top-level
 * DIRECTORY names, via the same confined tree route the existence gate
 * uses. Any refusal degrades to an empty list — the fallback then
 * silently does nothing and the honest drop stands.
 */
export async function workspaceRootDirs(
	sessionId: string,
	fetchImpl: typeof fetch = fetch
): Promise<string[]> {
	try {
		const res = await fetchImpl(
			`/api/dsh/workspace-tree?sessionId=${encodeURIComponent(sessionId)}&path=`
		);
		if (!res.ok) return [];
		const body = (await res.json()) as {
			ok?: boolean;
			listing?: { entries?: { name: string; type: string }[] };
		};
		if (body?.ok !== true || !Array.isArray(body.listing?.entries)) return [];
		return body.listing.entries.filter((e) => e.type === 'dir').map((e) => e.name);
	} catch {
		return [];
	}
}

/**
 * Resolve a file-link path AGAINST the workspace root (Fullpath Bow ADR
 * 2026-09-26 D1): the assistant speaks in its own cwd's paths, which sit
 * one level ABOVE the workspace root, so real links carry the root path or
 * the root's basename folder as a prefix. Order is fixed: (a) absolute-root
 * prefix, (b) basename prefix, (c) as-is. A blank root resolves as-is. The
 * HOST stays the existence/confinement authority — this is resolution, not
 * validation.
 */
export function resolveFileLinkPath(path: string, root: string | null | undefined): string {
	const collapse = (s: string) => s.split('/').filter((seg) => seg !== '').join('/');
	const value = collapse(path);
	// A workspace root may be stored unexpanded (~/owner/repo) while link
	// paths are fully expanded (/home/owner/repo/...). BROWSER-SAFE: no
	// process.env here (RCA 2026-09-26 — process is undefined in the client
	// and the whole click handler died on it); the tilde is simply stripped
	// and the segment-boundary last resort bridges any remaining form gap.
	const rawRoot = (root ?? '').trim();
	const candidates = new Set([
		collapse(rawRoot),
		collapse(rawRoot === '~' ? '' : rawRoot.startsWith('~/') ? rawRoot.slice(2) : rawRoot)
	]);
	candidates.delete('');
	if (value === '' || candidates.size === 0) return value;
	for (const rootVal of candidates) {
		if (value === rootVal) return path;
		if (value.startsWith(rootVal + '/')) return value.slice(rootVal.length + 1);
	}
	const firstBase = [...candidates][0]?.split('/').pop() ?? '';
	if (firstBase !== '' && firstBase !== '.' && firstBase !== '..' && value.startsWith(firstBase + '/')) {
		return value.slice(firstBase.length + 1);
	}
	// LAST resort for expanded absolute links vs an unexpanded root:
	// segment-boundary marker only — "/agentic-ai/" can never hit
	// 'agentic-ai-notes/'
	for (const rootVal of candidates) {
		const base = rootVal.split('/').pop() ?? '';
		if (base === '' || base === '.' || base === '..') continue;
		const marker = '/' + base + '/';
		const idx = value.indexOf(marker);
		if (idx > 0) return value.slice(idx + marker.length);
	}
	return value;
}/**
 * The existence gate (ADR D3): probe the dirname via the confined tree
 * route and require the basename in the listing. Any refusal (404
 * missing/outside, 415, 502, transport) resolves false — the click
 * drops. Uses the injected fetch so tests mount the double.
 */
export async function workspaceFileExists(
	sessionId: string,
	path: string,
	fetchImpl: typeof fetch = fetch
): Promise<boolean> {
	const clean = path.split('#')[0];
	if (clean === '' || hasDotDotSegment(clean)) return false;
	const slash = clean.lastIndexOf('/');
	const dir = slash === -1 ? '' : clean.slice(0, slash);
	const base = slash === -1 ? clean : clean.slice(slash + 1);
	try {
		const res = await fetchImpl(
			`/api/dsh/workspace-tree?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(dir)}`
		);
		if (!res.ok) return false;
		const body = (await res.json()) as {
			ok?: boolean;
			listing?: { entries?: { name: string; type: string }[] };
		};
		if (body?.ok !== true || !Array.isArray(body.listing?.entries)) return false;
		return body.listing.entries.some((entry) => entry.name === base);
	} catch {
		return false;
	}
}
/**
 * The floor's probe order (Fullpath Bow ADR 2026-09-26 D1): resolve against
 * the root, probe the resolved candidate, then ONE as-is retry when the
 * resolution changed — a root-basename collision must not silently win.
 * Returns the workspace-relative path to publish, or null when both
 * candidates refuse (the click drops).
 */
export async function resolveFileLinkTarget(
	sessionId: string,
	path: string,
	root: string | null | undefined,
	exists: (sessionId: string, path: string) => Promise<boolean> = workspaceFileExists,
	listRoot?: (sessionId: string) => Promise<string[]>
): Promise<string | null> {
	const resolved = resolveFileLinkPath(path, root);
	// The spine workspace can sit ABOVE the session's real DSH workspace
	// (harness root vs repo root) — so the candidate list also tries the
	// path minus its first segment. Bounded: at most 3 probes, then the
	// honest drop. The HOST stays the existence/confinement authority.
	const candidates: string[] = [resolved];
	const slash = resolved.indexOf('/');
	if (slash !== -1 && resolved !== path) candidates.push(resolved.slice(slash + 1));
	if (!candidates.includes(path)) candidates.push(path);
	for (const candidate of candidates) {
		if (await exists(sessionId, candidate)) return candidate;
	}
	// Deep fallback (2026-10-05 incident): the harness floor can be the
	// session root while the assistant's bare link lives under a repo
	// subdirectory (root ~/agentic-ai, file deepseek-insight/src/...). The
	// classic candidates never ADD a prefix, so they all miss. List the
	// root ONCE and probe <top-level-dir>/<path> with early exit — bounded
	// by the root's top-level directory count.
	if (listRoot && resolved !== '' && !hasDotDotSegment(resolved)) {
		try {
			const dirs = await listRoot(sessionId);
			for (const dir of dirs) {
				if (dir === '' || dir === '.' || dir === '..') continue;
				const candidate = dir + '/' + resolved;
				if (await exists(sessionId, candidate)) return candidate;
			}
		} catch {
			// listing refused → the honest drop stands
		}
	}
	return null;
}