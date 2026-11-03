/**
 * injected-path-table — parse the harness's injected image-attachment
 * message shape into key/value rows for the bubble's data-table render
 * (2026-10-29, operator request). The trio shape:
 *
 *   <path>/abs/file.png</path>
 *   <type>image</type>
 *   <content>
 *   image/png image, 1215x852 px, 411798 bytes
 *   </content>
 *
 * Pure function: null for ANYTHING else — chip-only injections, human
 * prompts, partial matches, prose quoting the tags. The caller decides
 * whether to render the table (PromptBubble gates on meta === 'injected').
 */

export interface InjectedPathRow {
	key: string;
	value: string;
	/** Present on the path row — the File Link Intent href. */
	href?: string;
}

/** The whole trimmed text must be EXACTLY this trio — nothing before or
 *  after, so prose that merely quotes the tags stays inert (the same
 *  rule as markdown.ts's fence carve-out). */
const TRIO = /^<path>\s*([^\n<]+?)\s*<\/path>\s*<type>\s*([^\n<]+?)\s*<\/type>\s*<content>\s*([\s\S]+?)\s*<\/content>\s*$/;

export function parseInjectedPathTable(text: string): InjectedPathRow[] | null {
	const m = TRIO.exec(text.trim());
	if (!m) return null;
	// TRIO's character-class groups always match >= 1 char when the regex
	// matches, so m[1..3] are non-null — no ?? fallback (branch unreachable).
	const path = m[1].trim();
	if (path === '') return null;
	return [
		{ key: 'path', value: path, href: path },
		{ key: 'type', value: m[2].trim() },
		{ key: 'content', value: m[3].trim().replaceAll('\n', ' ') }
	];
}
