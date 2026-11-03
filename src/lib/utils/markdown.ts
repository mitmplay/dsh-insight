/**
 * markdown — render markdown to sanitized HTML (Wave 2, task 2.1;
 * PRD §3.3 shared layer; BC-12).
 *
 * Pure function, no I/O, no Svelte, no DOM: runs server-side (SSR cold load)
 * and client-side alike. Two-stage pipeline with an allow-list escape hatch —
 * raw HTML never reaches the output:
 *
 *   1. ESCAPE every <, >, &, ", ' in the source text. Any markup-like
 *      construct in the transcript is now inert character data; the markdown
 *      tokenizer can no longer emit an HTML node from user/wire content.
 *   2. Convert the escaped text with a small CommonMark-subset tokenizer
 *      whose emitter can ONLY produce the allow-listed tags below (p, strong,
 *      em, del, code, pre, h1-h4, ul/ol/li, blockquote, hr, a, table/
 *      thead/tbody/tr/th/td) — plus ONE structured exception: a ```mermaid
 *      fence emits a bare placeholder <div class="mermaid-diagram"> whose
 *      only attribute is the base64 diagram source; the SVG itself is
 *      produced client-side by the mermaid runtime, never by this emitter.
 *      Inline
 *      code and code fences re-inject their (already-escaped) bodies verbatim
 *      — code renders as characters, never markup (tool-payload rule).
 *      Paragraph soft line breaks stay as raw \n (the bubble renders with
 *      whitespace-pre-wrap — no <br> node needed).
 *   3. Links: only http(s) schemes survive; every other scheme (javascript:,
 *      data:, vbscript:, file:, mailto:…) is reduced to plain text. Emitted
 *      <a> tags carry rel="noopener noreferrer" target="_blank".
 *
 * Why not a dependency: the project has zero render deps today; the subset
 * below is what the harness transcripts actually use (bold, inline code,
 * fenced blocks, lists, headings) — pinned by markdown.test.ts. The escape-
 * first order makes sanitization structural rather than a block-list chase.
 */

/** Escape HTML-significant characters — stage 1 of the pipeline. */
function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/**
 * GFM table row: two or more pipe-delimited cells. Cells may ALL be empty —
 * a header-less table (`| | | |\n|---|---|---|\n…`, GitHub renders these)
 * must still start a table; requiring content here swallowed the header,
 * the delimiter row, and every body row into one raw pipe paragraph
 * (2026-08-26 fix, found via a header-less lineage table rendering as text).
 * Over-triggering is structurally impossible: a row only becomes a table
 * when the NEXT line is a strict delimiter row; and `| just a pipe line`
 * stays one cell.
 */
function isTableRow(line: string): boolean {
	if (!line.includes('|')) return false;
	// Code-span pipes were escaped? No — pipes are never escaped; content
	// pipes inside `code` still delimit (GFM's own simplification).
	return splitRow(line).length >= 2;
}

/** GFM delimiter row: cells of only -, :, optional spaces (e.g. |---|:--:|). */
function isDelimiterRow(line: string): boolean {
	if (!line.includes('|') && !/^[-:\s]+$/.test(line)) return false;
	const stripped = line.replace(/\|/g, '').trim();
	if (stripped === '' || !/^[-:\s]+$/.test(stripped)) return false;
	return splitRow(line).length >= 2 && splitRow(line).every((c) => /^:?-+:?$/.test(c.trim()));
}

/** Split one pipe row into cells: trim outer pipes, split on inner ones. */
function splitRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith('|')) s = s.slice(1);
	if (s.endsWith('|')) s = s.slice(0, -1);
	// Escaped pipes (\|) are literal cell content — placeholder them out.
	const literals: string[] = [];
	s = s.replace(/\\\|/g, () => {
		literals.push('|');
		return `\u0001${literals.length - 1}\u0001`;
	});
	return s.split('|').map((c) => c.replace(/\u0001(\d+)\u0001/g, (_m, idx: string) => literals[Number(idx)] ?? '').trim());
}

// ── Lists (2026-08-27): indentation-aware nesting ─────────────────────

/** List item line: indent, bullet (- * +) or ordered (N. / N)) marker, body. */
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** One parsed item: indent width, kind, inline text, nested items. */
interface ListItem {
	indent: number;
	ordered: boolean;
	text: string;
	children: ListItem[];
}

/** Indent width in spaces — a tab advances to the next multiple of 4. */
function indentWidth(s: string): number {
	let w = 0;
	for (const ch of s) {
		if (ch === '\t') w += 4 - (w % 4);
		else w += 1;
	}
	return w;
}

/**
 * Parse one list run from lines[start] (a list item): consecutive item
 * lines at ANY indent plus lazy plain-text continuations.
 *
 *   deeper indent than the innermost open item → nests INSIDE it;
 *   same indent                                → sibling;
 *   kind change (bullet ⇄ ordered) at an EXISTING depth → ends the run
 *   (the outer scan then emits the next list as its own block — the
 *   pre-nesting behavior of two sibling lists is kept);
 *   blank line / fence / heading / quote       → run over.
 *
 * Mixed kinds still nest when the indent is deeper — a numbered plan
 * under a bullet is legal CommonMark and common in transcripts.
 */
function parseListRun(lines: string[], start: number): { items: ListItem[]; next: number } {
	const items: ListItem[] = [];
	const stack: ListItem[] = []; // open chain: root … innermost item
	let i = start;
	while (i < lines.length) {
		const l = lines[i] as string;
		const m = LIST_ITEM_RE.exec(l);
		if (m) {
			const indent = indentWidth(m[1] as string);
			const ordered = /^\d/.test(m[2] as string);
			// Pop until the innermost open item is no deeper than this line.
			while (stack.length > 0 && (stack[stack.length - 1] as ListItem).indent > indent) stack.pop();
			if (stack.length === 0) {
				// Root depth — a kind change here starts a NEW list block.
				if (items.length > 0 && ordered !== (items[0] as ListItem).ordered) break;
				const it: ListItem = { indent, ordered, text: m[3] as string, children: [] };
				items.push(it);
				stack.push(it);
			} else {
				const top = stack[stack.length - 1] as ListItem;
				if (indent === top.indent && ordered !== top.ordered) break; // kind change: new block
				const it: ListItem = { indent, ordered, text: m[3] as string, children: [] };
				if (indent > top.indent) {
					top.children.push(it); // one level deeper → child
				} else {
					// Sibling of top — top's parent adopts it.
					const parent = stack.length >= 2 ? (stack[stack.length - 2] as ListItem) : null;
					if (parent) parent.children.push(it);
					else items.push(it);
					stack.pop();
				}
				stack.push(it);
			}
			i += 1;
			continue;
		}
		// Lazy continuation: plain text extends the innermost open item.
		if (stack.length > 0 && l.trim() !== '' && !/^(#{1,6})\s|^```|^&gt;/.test(l)) {
			(stack[stack.length - 1] as ListItem).text += ` ${l.trim()}`;
			i += 1;
			continue;
		}
		break; // blank line or another block construct ends the run
	}
	return { items, next: i };
}

/** Emit an item tree — one inline pass per item, children inside the <li>. */
function emitList(items: ListItem[]): string {
	const tag = (items[0] as ListItem).ordered ? 'ol' : 'ul';
	const lis = items
		.map(
			(it) =>
				`<li>${renderInline(it.text)}${it.children.length > 0 ? emitList(it.children) : ''}</li>`
		)
		.join('');
	return `<${tag}>${lis}</${tag}>`;
}

/** Reverse stage-1 escaping — mermaid parses the ORIGINAL syntax, not entities. */
function unescapeEntities(text: string): string {
	return text
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&amp;', '&');
}

/** Base64 that survives non-ASCII (diagram labels are arbitrary text). */
function btoaUnicode(text: string): string {
	return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

const ESCAPED_CODE_FENCE = /^```/;

// ── <path> blocks → file links (2026-10-29) ────────────────────────────

/**
 * Stage 0 — the harness wraps tool-result file paths in <path>…</path>
 * blocks (every attached image rides one). Escaped by stage 1, they
 * rendered as dead literal text. This pass rewrites each block to a
 * [basename](full path) markdown link BEFORE escaping, so the existing
 * machinery takes over: links() emits the scheme-free anchor (its refusal
 * rules still guard the href) and MarkdownContent's File Link Intent
 * (ADR 2026-09-25 D2) opens the file on click.
 *
 * Fenced code runs are carved out FIRST and passed through verbatim —
 * the tool-payload rule: a <path> quoted inside a transcript paste is
 * data, never a link.
 */
function pathBlocksToLinks(text: string): string {
	const parts: string[] = [];
	const fence = /```[\s\S]*?(```|$)/g;
	let last = 0;
	for (const m of text.matchAll(fence)) {
		parts.push(transformPaths(text.slice(last, m.index)));
		parts.push(m[0]);
		last = (m.index ?? 0) + m[0].length;
	}
	parts.push(transformPaths(text.slice(last)));
	return parts.join('');
}

function transformPaths(text: string): string {
	return text.replace(/<path>\s*([^\n<]+?)\s*<\/path>/g, (_m, p: string) => {
		const name = p.split('/').pop() || p;
		// Angle-wrapped destination: the only href form links() accepts with
		// spaces (the 2026-10-11 rule); the wrapper is destination syntax and
		// never reaches the emitted href.
		return `[${name}](<${p}>)`;
	});
}

/**
 * Render markdown to sanitized HTML (single entry point, BC-12).
 * Output uses ONLY the allow-listed tags; empty input renders ''.
 */
export function renderMarkdown(text: string): string {
	if (text === '') return '';
	const escaped = escapeHtml(pathBlocksToLinks(text));

	const out: string[] = [];
	const lines = escaped.split('\n');
	let i = 0;

	// --- Block-level scan -------------------------------------------------
	while (i < lines.length) {
		const line = lines[i] as string;

		// Fenced code block: ``` … ``` (or EOF) — body verbatim (already escaped).
		if (ESCAPED_CODE_FENCE.test(line.trimStart())) {
			const opener = line.trimStart().slice(3).trim().toLowerCase();
			const body: string[] = [];
			i += 1;
			while (i < lines.length && !ESCAPED_CODE_FENCE.test((lines[i] as string).trimStart())) {
				body.push(lines[i] as string);
				i += 1;
			}
			i += 1; // closing fence (or past EOF)
			// Mermaid fence (2026-08-23): a ```mermaid block renders as a
			// placeholder div — MarkdownContent lazy-loads the mermaid
			// runtime client-side and swaps the SVG in. The SOURCE rides
			// base64-encoded (entity-round-tripped back to raw text first:
			// stage 1 escaped it, and mermaid parses the original syntax).
			// The div is the ONLY non-allow-listed container the emitter
			// produces, and only here, with no user-controlled attributes.
			if (opener === 'mermaid') {
				const raw = unescapeEntities(body.join('\n'));
				const encoded = btoaUnicode(raw);
				out.push(`<div class="mermaid-diagram" data-source="${encoded}" data-processed="false"></div>`);
				continue;
			}
			out.push(`<pre><code>${body.join('\n')}</code></pre>`);
			continue;
		}

		// Blank line — paragraph separator.
		if (line.trim() === '') {
			i += 1;
			continue;
		}

		// ATX heading: # … ######.
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			const level = Math.min(4, (heading[1] as string).length);
			out.push(`<h${level}>${renderInline(heading[2] as string)}</h${level}>`);
			i += 1;
			continue;
		}

		// Horizontal rule: ---, ***, ___ (3+).
		if (/^([-*_])(\s*\1){2,}\s*$/.test(line)) {
			out.push('<hr />');
			i += 1;
			continue;
		}

		// GFM pipe table (2026-08-23): a header row, a delimiter row of
		// |?---|---|? shape, then body rows — all pipe-bearing lines. Cells
		// go through renderInline like any text; alignment colons are
		// accepted and ignored (the app.css skin owns visual layout).
		// NOTE: must run BEFORE the hr rule would eat a bare |---| line and
		// before the paragraph accumulator swallows the rows.
		if (isTableRow(line) && i + 1 < lines.length && isDelimiterRow(lines[i + 1] as string)) {
			const header = splitRow(line);
			i += 2; // header + delimiter
			const body: string[][] = [];
			while (i < lines.length && isTableRow(lines[i] as string) && !isDelimiterRow(lines[i] as string)) {
				body.push(splitRow(lines[i] as string));
				i += 1;
			}
			const thead = `<thead><tr>${header.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>`;
			const tbody = `<tbody>${body
				.map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
				.join('')}</tbody>`;
			out.push(`<table>${thead}${tbody}</table>`);
			continue;
		}

		// Blockquote: > … (runs merge; nested > visual only).
		if (/^&gt;\s?/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^&gt;\s?/.test(lines[i] as string)) {
				body.push((lines[i] as string).replace(/^&gt;\s?/, ''));
				i += 1;
			}
			out.push(`<blockquote><p>${renderInline(body.join(' '))}</p></blockquote>`);
			continue;
		}

		// Lists (bullet −*+ / ordered N.) — indentation-aware (2026-08-27
		// fix: nested bullets rendered FLAT — the indent was captured then
		// discarded). Rules in parseListRun; nesting emits ul/ol INSIDE li.
		if (LIST_ITEM_RE.test(line)) {
			const run = parseListRun(lines, i);
			out.push(emitList(run.items));
			i = run.next;
			continue;
		}

		// Paragraph: consecutive non-blank, non-structural lines; single \n
		// inside a paragraph is a soft break (<br />) — matches transcript habits.
		const para: string[] = [];
		while (
			i < lines.length &&
			(lines[i] as string).trim() !== '' &&
			!ESCAPED_CODE_FENCE.test((lines[i] as string).trimStart()) &&
			!/^#{1,6}\s/.test(lines[i] as string) &&
			!/^&gt;\s?/.test(lines[i] as string) &&
			!/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i] as string) &&
			!/^([-*_])(\s*\1){2,}\s*$/.test(lines[i] as string) &&
			// A GFM table STARTS here (row + next-line delimiter) — it
			// interrupts the paragraph, GitHub/marked behavior.
			!(isTableRow(lines[i] as string) && i + 1 < lines.length && isDelimiterRow(lines[i + 1] as string))
		) {
			para.push(lines[i] as string);
			i += 1;
		}
		if (para.length > 0) out.push(`<p>${renderInline(para.join('\n'))}</p>`);
	}

	return out.join('\n');
}

/**
 * Inline pass: code spans first (their bodies stay verbatim), then emphasis,
 * then links. Escaped text in, allow-listed tags out.
 */
function renderInline(text: string): string {
	// Placeholder strategy: pull code spans OUT before emphasis/link parsing
	// so **bold** inside `code` stays literal, then splice them back.
	const codeSpans: string[] = [];
	let rest = text.replace(/`([^`\n]+)`/g, (_m, body: string) => {
		// A code span that is ENTIRELY one http(s) URL renders as an external
		// link instead (2026-09-27: transcripts habitually backtick URLs; the
		// operator still expects the icon'd short-display link). Code that
		// merely CONTAINS a URL stays literal — the tool-payload rule holds.
		const raw = unescapeEntities(body);
		if (/^https?:\/\/\S+$/i.test(raw)) {
			codeSpans.push(externalAnchor(raw));
		} else {
			codeSpans.push(`<code>${body}</code>`);
		}
		return `\u0000${codeSpans.length - 1}\u0000`;
	});

	rest = emphasis(rest);
	rest = links(rest);
	rest = autolinkBareUrls(rest);

	return rest.replace(/\u0000(\d+)\u0000/g, (_m, idx: string) => codeSpans[Number(idx)] ?? '');
}

/** One hardened external anchor from a RAW url — display is origin+path
 *  (query/fragment stripped), href keeps everything (BC-12 attributes). */
function externalAnchor(rawUrl: string): string {
	let cut = rawUrl.length;
	for (const c of ['?', '#']) {
		const i = rawUrl.indexOf(c);
		if (i !== -1 && i < cut) cut = i;
	}
	return `<a href="${rawUrl.replaceAll('"', '&quot;')}" rel="noopener noreferrer" target="_blank">${rawUrl.slice(0, cut)}</a>`;
}

/**
 * Bare-URL autolink (2026-09-27): an http(s) URL in plain text becomes an
 * anchor whose DISPLAY TEXT is the origin+path with the query/hash stripped
 * (transcript URLs like …new?merge_request[source_branch]=… render short)
 * while the HREF keeps the FULL URL. Runs after [label](href) parsing and
 * skips text inside existing anchors/code placeholders (\u0000N\u0000 markers).
 * Trailing punctuation ),.,;:!?'"] and matching surrounding parens stay
 * outside the link (CommonMark's autolink tail rule).
 */
function autolinkBareUrls(text: string): string {
	return text.replace(
		// The URL charset allows (), [], {} — GitLab/GitHub query strings carry
		// [brackets] and paths carry (parens); trailing balance/punctuation is trimmed below.
		/https?:\/\/[^\s<>"'\u0000]+/gi,
		(whole, offset: number, full: string) => {
			// Inside an existing anchor's label/href or a code placeholder? Leave it.
			// (window spans any href an emitted anchor may carry).
			const before = full.slice(Math.max(0, offset - 2000), offset);
			if (/<a\s[^>]*$/i.test(before) || /<code>[^<]*$/i.test(before)) return whole;
			let url = whole;
			// Trim a trailing closing paren only when the URL has no open paren
			// left to balance it (the "[…](…)" wiki-link case).
			while (url.endsWith(')') && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
				url = url.slice(0, -1);
			}
			// Trailing punctuation never belongs to the URL.
			url = url.replace(/[.,;:!?]+$/, "");
			const tail = whole.slice(url.length);
			return `${externalAnchor(url)}${tail}`;
		}
	);
}

/** ***bold-italic***, **bold**, *italic*, _italic_, ~~strike~~. */
function emphasis(text: string): string {
	return text
		.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/\*(.+?)\*/g, '<em>$1</em>')
		.replace(/(?<![\w])_(.+?)_(?![\w])/g, '<em>$1</em>')
		.replace(/~~(.+?)~~/g, '<del>$1</del>');
}

/**
 * [label](href) — http(s) hrefs become hardened external anchors; SCHEME-FREE
 * relative hrefs (assistant file links like [card](src/lib/…)) become same-
 * origin anchors; anything carrying a scheme (javascript:, data:, mailto:,
 * //evil.com protocol-relative, …) stays inert text (BC-12).
 */
function links(text: string): string {
	// 2026-10-11 (operator bug): the destination regex rejected WHITESPACE,
	// so CommonMark angle-bracket destinations with spaces - [label](<dev/...
	// 2026-10-10 - The Name.md>, the only way to link a path with spaces -
	// never linked at all (raw text in tables and prose). Two forms now:
	//   <...> - the escape-first pipeline hands the angle wrapper over as
	//           &lt;/&gt;; spaces allowed inside (the whole point)
	//   bare  - no whitespace (unchanged legacy form)
			const LINK = /\[([^\]]+)\]\((?:&lt;([^>]*?)&gt;|([^)\s]+))\)/g;
	return text.replace(LINK, (whole, labelA: string, angleHref: string, bareHref: string) => {
		const label = labelA;
		const href = angleHref !== undefined ? angleHref : bareHref;
		const unescaped = href
			.replaceAll('&amp;', '&')
			.replaceAll('&lt;', '<')
			.replaceAll('&gt;', '>')
			.replaceAll('&quot;', '"')
			.replaceAll('&#39;', "'");
		// Angle wrapper is destination syntax, never path bytes - strip any
		// surviving wrapper before every branch so file links survive.
		const bare = unescaped.replace(/^<(.+)>$/, '$1');
		if (/^https?:\/\//i.test(bare)) {
			return `<a href="${bare.replaceAll('"', '&quot;')}" rel="noopener noreferrer" target="_blank">${label}</a>`;
		}
		// Relative is only safe when NO scheme is present - a single colon
		// before any slash is exactly how javascript:/data: smuggle in, and
		// a leading // is a protocol-relative off-origin navigation.
		if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(bare) || bare.startsWith('//')) return whole;
		return `<a href="${bare.replaceAll('"', '&quot;')}">${label}</a>`;
	});
}

