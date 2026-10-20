/**
 * dispatch-view — rebuild a typed DsiReadView from a PTC sub-dispatch's
 * wire fields (ADR D3/D4, 2026-09-05). The dispatch log carries the read
 * result as the model-facing text projection — an optional
 * `<path>/<type>/<content>` envelope around `N: text`-numbered lines — and
 * the structured `arguments.file_path` beside it. This module reconstructs
 * the same shape the harness's native read presentation view carries, so
 * FileContentViewer renders markdown/code exactly as a native read chip.
 *
 * Display-derived, never truth-changing: a shape it cannot read returns
 * `undefined` and the caller falls back to a plain pre. Never throws.
 */

import type { DsiReadLine, DsiReadView } from '$lib/types';
import { isKnownCodeLang } from './highlight-code';

/** Renderer family one dispatch renders as (keyed by the harness-written
 * tool name — ADR D3: the same families the native chips use). */
export type DispatchRenderer = 'file' | 'terminal' | 'generic';

/** True for the shell-family tools whose result renders as a terminal block. */
const TERMINAL_TOOLS: ReadonlySet<string> = new Set(['bash', 'pwsh']);

/** The read-family tools whose result renders through FileContentViewer. */
const FILE_TOOLS: ReadonlySet<string> = new Set(['read']);

/**
 * Renderer family for a dispatch's tool name. Unknown names render as the
 * generic args/result row — never guessed into a file or terminal.
 * @param name - the dispatch's wire tool name (read, bash, …).
 * @returns the renderer family key.
 */
export function dispatchRendererKey(name: string): DispatchRenderer {
	if (FILE_TOOLS.has(name)) return 'file';
	if (TERMINAL_TOOLS.has(name)) return 'terminal';
	return 'generic';
}

/** Extension → language hint. Markdown keeps its own tag (FileContentViewer
 * renders it as prose); code languages pass through when registered;
 * everything else declines to the plain-pre fallback. */
function langOfPath(path: string): string | undefined {
	// LAST dotted segment only: a first-dot capture mis-reads multi-dot
	// filenames (message-images.test.ts → "test.ts", not "ts") and the
	// plain-pre fallback renders what should be highlighted code.
	const ext = /\.([^.]+)$/.exec(path)?.[1]?.toLowerCase();
	if (ext === undefined) return undefined;
	if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'md';
	return isKnownCodeLang(ext) ? ext : undefined;
}

/** One `<path>…` envelope header line. */
const ENVELOPE_PATH = /^<path>.*<\/path>$/;
/** The envelope's content opener; lines after it are the body. */
const ENVELOPE_CONTENT = /^<content>$/;
/** One numbered projection line: `N: text` (N 1-based, space after colon). */
const NUMBERED_LINE = /^(\d+): ?(.*)$/;

/**
 * Strip the read projection's envelope when present; return the body lines.
 * Returns undefined when the envelope opened but its `<content>` opener never
 * arrived (a truncated projection is not a readable body). A projection
 * without the envelope passes through untouched (its lines are the body).
 */
function envelopeBody(lines: string[]): string[] | undefined {
	if (lines.length === 0 || !ENVELOPE_PATH.test(lines[0]!)) return lines;
	for (let i = 1; i < lines.length; i++) {
		if (ENVELOPE_CONTENT.test(lines[i]!)) return lines.slice(i + 1);
	}
	return undefined; // `<path>` header without a closed opener — unreadable
}

/**
 * Rebuild a DsiReadView from a dispatch's wire fields.
 * @param argsRaw - the dispatch arguments as raw JSON (file_path member).
 * @param contentText - the settled dispatch's joined text content.
 * @returns the view, or undefined when file_path is missing or the content
 *   carries no readable lines — the caller renders the plain fallback then.
 */
export function buildDispatchReadView(argsRaw: string | undefined, contentText: string | undefined): DsiReadView | undefined {
	if (argsRaw === undefined || contentText === undefined) return undefined;
	let args: unknown;
	try {
		args = JSON.parse(argsRaw);
	} catch {
		return undefined;
	}
	const path = (args as { file_path?: unknown } | null)?.file_path;
	if (typeof path !== 'string' || path.length === 0) return undefined;

	const body = envelopeBody(contentText.split('\n'));
	if (body === undefined || body.length === 0) return undefined;

	const lines: DsiReadLine[] = [];
	let next = 1; // fallback numbering for unnumbered pass-through lines
	for (const raw of body) {
		const m = NUMBERED_LINE.exec(raw);
		if (m !== null) {
			const number = Number(m[1]);
			lines.push({ number, text: m[2]! });
			next = number + 1;
		} else {
			lines.push({ number: next, text: raw });
			next += 1;
		}
	}
	if (lines.length === 0) return undefined;

	const first = lines[0]!.number;
	const last = lines[lines.length - 1]!.number;
	return {
		path,
		...(langOfPath(path) !== undefined ? { lang: langOfPath(path)! } : {}),
		offset: first,
		// The projection carries only the returned window; its last line
		// number is the honest upper bound (the window's end).
		totalLines: last,
		lines
	};
}
