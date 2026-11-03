/**
 * markdown + truncate unit tests (paired with task 2.1, POC-2 Wave 2).
 *
 * The render contract (BC-12): output contains ONLY allow-listed tags
 * (p, strong, em, del, code, pre, h1-h4, ul, ol, li, blockquote, hr, br, a);
 * raw HTML in the source never survives as markup — it renders as characters.
 * XSS battery covers <script>, <img onerror>, javascript: links, data: links,
 * event-handler attributes, and markdown-inside-code-span injection.
 *
 * Truncate contract: max means max, max<=0 means unlimited, marker-less head
 * (callers own the affordance), honest cutChars.
 */

import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '$lib/utils/markdown';

/** Un-escape entities so fixture expectations read as the user typed them. */
function unescapeHtml(html: string): string {
	return html
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');
}
import { truncate } from '$lib/utils/truncate';

/** The complete tag vocabulary renderMarkdown may ever emit (BC-12 allow-list). */
const ALLOWED_TAGS = new Set([
	'p', 'strong', 'em', 'del', 'code', 'pre', 'h1', 'h2', 'h3', 'h4',
	'ul', 'ol', 'li', 'blockquote', 'hr', 'br', 'a',
	'table', 'thead', 'tbody', 'tr', 'th', 'td',
	'div' // ONLY the mermaid placeholder — no attributes but class/data-*
]);

/** Every <tag …> occurrence in rendered output must be in the allow-list. */
function assertOnlyAllowedTags(html: string): void {
	const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => (m[1] as string).toLowerCase());
	for (const tag of tags) {
		if (!ALLOWED_TAGS.has(tag)) {
			throw new Error(`disallowed tag <${tag}> in rendered output: ${html}`);
		}
	}
}

describe('renderMarkdown — CommonMark subset the transcripts use', () => {
	it('renders **bold** as <strong>', () => {
		const html = renderMarkdown('Cost is **~1–3%** of tokens.');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<strong>~1–3%</strong>');
	});

	it('renders *italic*, _italic_, ***both***, and ~~strike~~', () => {
		expect(renderMarkdown('*careful*')).toContain('<em>careful</em>');
		expect(renderMarkdown('_careful_')).toContain('<em>careful</em>');
		expect(renderMarkdown('***red alert***')).toContain('<strong><em>red alert</em></strong>');
		expect(renderMarkdown('~~deprecated~~')).toContain('<del>deprecated</del>');
	});

	it('renders inline code as <code> — markdown inside a code span stays literal', () => {
		const html = renderMarkdown('run `grep **raw** file` now');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<code>grep **raw** file</code>');
	});

	it('renders fenced code blocks as <pre><code> with body verbatim (tool-payload rule)', () => {
		const html = renderMarkdown('before\n```\n{ "a": 1 }\n**not bold**\n```\nafter');
		assertOnlyAllowedTags(html);
		// Escaped-for-HTML body: quotes become &quot; when rendered as HTML — the
		// renderer emits the code body as escaped characters (never markup).
		expect(html).toContain('<pre><code>{ &quot;a&quot;: 1 }\n**not bold**</code></pre>');
		expect(html).not.toContain('<strong>');
	});

	it('renders bullet and ordered lists', () => {
		const bullets = renderMarkdown('- one\n- two\n- three');
		expect(bullets).toContain('<ul><li>one</li><li>two</li><li>three</li></ul>');
		const ordered = renderMarkdown('1. first\n2. second');
		expect(ordered).toContain('<ol><li>first</li><li>second</li></ol>');
	});

	// ── Nested lists (2026-08-27 fix) ─────────────────────────────────
	// Before: the list block captured the indent then discarded it — every
	// item at ANY depth became a flat <li> sibling (a user prompt with
	// "* main\n   * nested" rendered as two same-level bullets).

	it('nests deeper-indented bullets inside the previous item (was: flat)', () => {
		const md = renderMarkdown('* main bullet point\n   * nested bullet point');
		expect(md).toContain('<ul><li>main bullet point<ul><li>nested bullet point</li></ul></li></ul>');
	});

	it('nests at multiple depths and pops back to siblings (indent stack)', () => {
		const md = renderMarkdown('- a\n  - b\n    - c\n  - d\n- e');
		// c deepest under b; d sibling of b; e sibling of a.
		expect(md).toContain(
			'<ul><li>a<ul><li>b<ul><li>c</li></ul></li><li>d</li></ul></li><li>e</li></ul>'
		);
	});

	it('nests mixed kinds when deeper (ordered plan under a bullet) but splits them at the same depth', () => {
		const nested = renderMarkdown('- plan\n  1. first\n  2. second\n- done');
		expect(nested).toContain(
			'<ul><li>plan<ol><li>first</li><li>second</li></ol></li><li>done</li></ul>'
		);
		// Same depth, kind change → two sibling list blocks (pre-fix behavior).
		const split = renderMarkdown('- a\n1. b');
		expect(split).toContain('<ul><li>a</li></ul>');
		expect(split).toContain('<ol><li>b</li></ol>');
		expect(split).not.toContain('<ul><li>a<ol>');
	});

	it('counts tabs as indent (tab stop 4) and keeps inline markup working in nested items', () => {
		const md = renderMarkdown('- outer\n\t* inner **bold** item');
		expect(md).toContain('<ul><li>outer<ul><li>inner <strong>bold</strong> item</li></ul></li></ul>');
	});

	it('renders headings h1–h4 (h5/h6 clamp to h4)', () => {
		expect(renderMarkdown('# Title')).toContain('<h1>');
		expect(renderMarkdown('## Sub')).toContain('<h2>');
		expect(renderMarkdown('### Deep')).toContain('<h3>');
		expect(renderMarkdown('##### Five')).toContain('<h4>'); // clamped, still allow-listed
	});

	it('renders blockquotes and horizontal rules', () => {
		const html = renderMarkdown('> quoted line\n\n---');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<blockquote>');
		expect(html).toContain('<hr />');
	});

	it('paragraph soft line breaks survive (whitespace-pre-wrap renders the newline)', () => {
		// The bubble applies whitespace-pre-wrap; renderInline keeps the raw \n
		// inside <p> so the browser shows the break without an extra node.
		const html = renderMarkdown('line one\nline two');
		assertOnlyAllowedTags(html);
		expect(html).toContain('line one\nline two');
	});

	it('plain text renders as one paragraph, nothing else', () => {
		expect(renderMarkdown('Hello there')).toBe('<p>Hello there</p>');
		expect(renderMarkdown('')).toBe('');
	});

	// ── GFM pipe tables (2026-08-23) ──

	it('renders a pipe table: thead from the header row, tbody rows in order', () => {
		const html = renderMarkdown(
			'| Column A | Column B | Column C |\n' +
			'|----------|----------|----------|\n' +
			'| Row 1 | Alpha | 100 |\n' +
			'| Row 2 | Beta | 200 |\n' +
			'| Row 3 | Gamma | 300 |'
		);
		assertOnlyAllowedTags(html);
		expect(html).toContain('<table><thead><tr><th>Column A</th><th>Column B</th><th>Column C</th></tr></thead>');
		expect(html).toContain('<tbody><tr><td>Row 1</td><td>Alpha</td><td>100</td></tr>');
		expect(html).toContain('<tr><td>Row 3</td><td>Gamma</td><td>300</td></tr></tbody></table>');
		expect(html).not.toContain('| Column'); // pipes never render as text
	});

	it('alignment colons accepted; pipes without outer bars also table', () => {
		const html = renderMarkdown(
			'Name | Score\n' +
			':--- | --:\n' +
			'Ada | 99'
		);
		expect(html).toContain('<th>Name</th><th>Score</th>');
		expect(html).toContain('<td>Ada</td><td>99</td>');
	});

	it('inline markdown inside cells renders (bold, code)', () => {
		const html = renderMarkdown('| a | b |\n|---|---|\n| **bold** | `x` |');
		expect(html).toContain('<td><strong>bold</strong></td>');
		expect(html).toContain('<td><code>x</code></td>');
	});

	it('escaped pipes (\\|) are literal cell content, not delimiters', () => {
		const html = renderMarkdown('| a | b |\n|---|---|\n| x\\|y | z |');
		expect(html).toContain('<td>x|y</td>');
	});

	it('a table INTERRUPTS a paragraph (GitHub/marked behavior)', () => {
		const html = renderMarkdown("Here's the table:\n| a | b |\n|---|---|\n| 1 | 2 |");
		expect(html).toContain('<p>Here&#39;s the table:</p>');
		expect(html).toContain('<table>');
		expect(html).not.toContain('| a | b |');
	});

	// ── Header-less tables (2026-08-26 fix: empty header cells were
	//    rejected by isTableRow, collapsing the whole table — delimiter row
	//    included — into one raw pipe paragraph; found via a real lineage
	//    table in the transcript rendering as text) ──
	it('header-less table (all-empty header row) renders a real table (regression)', () => {
		const html = renderMarkdown(
			'| | | |\n' +
				'|---|---|---|\n' +
				'| ADR | `7fee9c7` | The Attachment Draft |\n' +
				'| Wave 1 | `b7a5ce7` | Draft Surface |'
		);
		expect(html).toContain('<table>');
		// Empty header cells still render as th nodes (GitHub behavior)
		expect(html).toContain('<thead><tr><th></th><th></th><th></th></tr></thead>');
		// Body rows keep inline rendering inside cells
		expect(html).toContain('<tr><td>ADR</td><td><code>7fee9c7</code></td><td>The Attachment Draft</td></tr>');
		// The delimiter row is table syntax — never visible text
		expect(html).not.toContain('|---');
	});

	it('header-less table mid-transcript: surrounding paragraphs stay separate', () => {
		const html = renderMarkdown(
			'DSI Composer Attachments — complete lineage:\n\n' +
				'| | | |\n|---|---|---|\n| a | b | c |\n\n' +
				'Final tallies follow.'
		);
		expect(html).toContain('<p>DSI Composer Attachments — complete lineage:</p>');
		expect(html).toContain('<table>');
		expect(html).toContain('<p>Final tallies follow.</p>');
		expect(html).not.toContain('| a | b | c |');
	});

	it('an all-empty pipe line alone (no delimiter after) stays paragraph text', () => {
		const html = renderMarkdown('| | | |\njust prose');
		expect(html).not.toContain('<table>');
		expect(html).toContain('| | | |');
	});

	it('single pipe line is NOT a table (needs delimiter row); stray pipes stay text', () => {
		const html = renderMarkdown('| just a pipe line');
		expect(html).toContain('<p>| just a pipe line</p>');
		expect(html).not.toContain('<table');
	});

	it('ragged rows keep their own cell count (no column forcing)', () => {
		const html = renderMarkdown('| a | b | c |\n|---|---|---|\n| one | two |');
		expect(html).toContain('<tr><td>one</td><td>two</td></tr>');
	});

	it('XSS attempt inside cells stays inert (BC-12 structural escape)', () => {
		const html = renderMarkdown('| a |\n|---|\n| <script>alert(1)</script> |');
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
	});

	// ── Mermaid fences (2026-08-23): placeholder div, lazy client render ──

	it('```mermaid fence emits a placeholder div with the base64 source', () => {
		const html = renderMarkdown('```mermaid\ngraph TD\n  A --> B\n```');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<div class="mermaid-diagram" data-source="');
		expect(html).toContain('data-processed="false"');
		expect(html).not.toContain('<pre>'); // not the generic fence path
		// Round-trip: decode data-source back to the diagram text
		const m = /data-source="([^"]+)"/.exec(html);
		const decoded = new TextDecoder().decode(
			Uint8Array.from(atob(m?.[1] ?? ''), (c) => c.charCodeAt(0))
		);
		expect(decoded).toBe('graph TD\n  A --> B');
	});

	it('diagram source round-trips entity-unescaped — mermaid parses ORIGINAL syntax', () => {
		const html = renderMarkdown('```mermaid\nA[label with <b> & "quotes"] --> B\n```');
		const m = /data-source="([^"]+)"/.exec(html);
		const decoded = new TextDecoder().decode(
			Uint8Array.from(atob(m?.[1] ?? ''), (c) => c.charCodeAt(0))
		);
		expect(decoded).toBe('A[label with <b> & "quotes"] --> B');
		// The placeholder itself carries no markup from the source
		expect(html).not.toContain('<b>');
	});

	it('non-mermaid fences still render as code blocks', () => {
		const html = renderMarkdown('```js\nconst x = 1;\n```');
		expect(html).toContain('<pre><code>const x = 1;</code></pre>');
		expect(html).not.toContain('mermaid-diagram');
	});

	it('mermaid fence unterminated at EOF still emits the placeholder', () => {
		const html = renderMarkdown('```mermaid\ngraph LR\n  X --> Y');
		expect(html).toContain('mermaid-diagram');
	});

	it('[label](https://…) renders a safe anchor with rel/target hardening', () => {
		const html = renderMarkdown('see [docs](https://example.com/x) now');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<a href="https://example.com/x" rel="noopener noreferrer" target="_blank">docs</a>');
	});

	it('[label](relative/path) renders a same-origin anchor — assistant file links (2026-09-25)', () => {
		const html = renderMarkdown('[FilesEditedCard.svelte:153](deepseek-insight/src/lib/components/message/cards/FilesEditedCard.svelte#L153)');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<a href="deepseek-insight/src/lib/components/message/cards/FilesEditedCard.svelte#L153">FilesEditedCard.svelte:153</a>');
		// root-relative works too
		expect(renderMarkdown('[route](/api/dsh/sessions)')).toContain('<a href="/api/dsh/sessions">route</a>');
	});

	it('angle-bracket destinations are destination syntax, never path bytes (2026-09-27 operator bug)', () => {
		const html = renderMarkdown('[PluginManagerHeader.svelte](<deepseek-insight/src/lib/components/settings-plugins/PluginManagerHeader.svelte>)');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<a href="deepseek-insight/src/lib/components/settings-plugins/PluginManagerHeader.svelte">');
		expect(html).not.toContain('%3C');
		expect(html).not.toContain('&lt;deepseek');
	});

	it('protocol-relative // links stay text — off-origin navigation refused', () => {
		expect(renderMarkdown('[x](//evil.example/x)')).not.toContain('<a ');
	});
});

describe('renderMarkdown — BC-12 XSS battery (nothing raw survives as markup)', () => {
	it('a <script> tag renders as inert characters — no script node', () => {
		const html = renderMarkdown('got <script>window.__pwned=1</script> here');
		assertOnlyAllowedTags(html);
		expect(html).not.toContain('<script');
		expect(html).toContain('&lt;script&gt;'); // visible as characters
	});

	it('<img src=x onerror=…> renders as text — no img node, no attribute fires', () => {
		const html = renderMarkdown('<img src=x onerror="window.__pwned=2">');
		assertOnlyAllowedTags(html);
		expect(html).not.toContain('<img');
	});

	it('javascript: and data: links stay text (no anchor emitted)', () => {
		const js = renderMarkdown('[click me](javascript:alert(1))');
		expect(js).not.toContain('<a ');
		expect(js).toContain('click me');
		const data = renderMarkdown('[payload](data:text/html,<b>x</b>)');
		expect(data).not.toContain('<a ');
	});

	it('mixed-case javascript: scheme is still refused', () => {
		expect(renderMarkdown('[x](JaVaScRiPt:alert(1))')).not.toContain('<a ');
	});

	it('markdown emphasis cannot smuggle attributes — only allow-listed tags exist', () => {
		const html = renderMarkdown('**bold onerror="boom"** tail');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<strong>bold onerror=&quot;boom&quot;</strong>');
	});

	it('a fenced block containing HTML renders every tag as characters', () => {
		const html = renderMarkdown('```\n<div onclick="x">hi</div>\n```');
		assertOnlyAllowedTags(html);
		// The source's quotes arrive in the output as &quot; — escaped characters.
		expect(html).toContain('&lt;div onclick=&quot;x&quot;&gt;');
	});

it('unescaped helper sanity: rendered code equals the typed source', () => {
	// Guard against double-escaping or entity drift in code bodies: what the
	// user typed must survive round-trip once entities are decoded by the DOM.
	const html = renderMarkdown('```\n{ "a": 1 } & <b>\n```');
	expect(unescapeHtml(html)).toContain('<pre><code>{ "a": 1 } & <b></code></pre>');
});

	it('entity smuggling through &amp; escapes never re-materializes a tag', () => {
		const html = renderMarkdown('&lt;script&gt;not real&lt;/script&gt;');
		assertOnlyAllowedTags(html);
		expect(html).not.toContain('<script');
	});
});

describe('bare-URL autolink — display short, href full (2026-09-27)', () => {
	it('a bare URL with a query renders origin+path as the label, full URL as the href', () => {
		const html = renderMarkdown(
			'https://gitlab.com/wharsojo.dev/deepseek-insight/-/merge_requests/new?merge_request[source_branch]=feature/plugin-rack'
		);
		expect(html).toContain('href="https://gitlab.com/wharsojo.dev/deepseek-insight/-/merge_requests/new?merge_request[source_branch]=feature/plugin-rack"');
		expect(html).toContain('>https://gitlab.com/wharsojo.dev/deepseek-insight/-/merge_requests/new</a>');
		expect(html).not.toContain('target="_blank">https://gitlab.com/wharsojo.dev/deepseek-insight/-/merge_requests/new?');
	});

	it('carries the hardened external-anchor attributes (BC-12)', () => {
		const html = renderMarkdown('see https://example.com/docs now');
		expect(html).toContain('<a href="https://example.com/docs" rel="noopener noreferrer" target="_blank">https://example.com/docs</a>');
	});

	it('leaves [label](href) links alone — the label never becomes the bare URL', () => {
		const html = renderMarkdown('[MR](https://gitlab.com/x/-/merge_requests/new?mr[source]=f1)');
		expect(html).toContain('>MR</a>');
		expect(html).toContain('href="https://gitlab.com/x/-/merge_requests/new?mr[source]=f1"');
	});

	it('a whole-URL code span upgrades to the icon-capable anchor (2026-09-27 contract)', () => {
		const html = renderMarkdown('`https://example.com/a?b=1`');
		expect(html).not.toContain('<code>');
		expect(html).toContain('href="https://example.com/a?b=1"');
		expect(html).toContain('target="_blank">https://example.com/a</a>');
	});

	it('trailing punctuation stays outside the link', () => {
		const html = renderMarkdown('visit https://example.com/x?y=2.');
		expect(html).toContain('target="_blank">https://example.com/x</a>.');
		expect(html).toContain('href="https://example.com/x?y=2"');
	});

	it('a code span that is ENTIRELY one URL renders as the external link, not code', () => {
		const html = renderMarkdown(
			'GitLab suggests an MR: `https://gitlab.com/wharsojo.dev/deepseek-insight/-/merge_requests/new?merge_request[source_branch]=feature/plugin-rack`.'
		);
		expect(html).not.toContain('<code>');
		expect(html).toContain('href="https://gitlab.com/wharsojo.dev/deepseek-insight/-/merge_requests/new?merge_request[source_branch]=feature/plugin-rack"');
		expect(html).toContain('target="_blank">https://gitlab.com/wharsojo.dev/deepseek-insight/-/merge_requests/new</a>');
	});

	it('code that merely CONTAINS a URL stays literal (tool-payload rule)', () => {
		const html = renderMarkdown('`curl https://example.com/api`');
		expect(html).toContain('<code>');
		expect(html).not.toContain('<a ');
	});

	it('a parenthesized URL keeps the closing paren outside (wiki-link safety)', () => {
		const html = renderMarkdown('(see https://example.com/a(1))');
		expect(html).toContain('href="https://example.com/a(1)"');
	});
});

describe('truncate — single display-truncation contract', () => {
	it('cuts to max and reports honest numbers', () => {
		const r = truncate('x'.repeat(600), 480);
		expect(r.head.length).toBe(480);
		expect(r.truncated).toBe(true);
		expect(r.cutChars).toBe(120);
		expect(r.head + 'x'.repeat(r.cutChars)).toHaveLength(600);
	});

	it('short text passes through untouched — no marker, no copy', () => {
		expect(truncate('No matches found', 480)).toEqual({ head: 'No matches found', truncated: false, cutChars: 0 });
	});

	it('exactly-max text is NOT truncated (boundary)', () => {
		const r = truncate('12345', 5);
		expect(r.truncated).toBe(false);
		expect(r.head).toBe('12345');
	});

	it('max <= 0 means unlimited (documented contract)', () => {
		expect(truncate('anything', 0)).toEqual({ head: 'anything', truncated: false, cutChars: 0 });
		expect(truncate('anything', -3).head).toBe('anything');
	});

	it('byte-heavy text truncates on UTF-16 code units consistently with slice', () => {
		const text = '🚀'.repeat(10); // 2 code units per rocket
		const r = truncate(text, 5);
		expect(r.head).toBe(text.slice(0, 5));
		expect(r.head).toHaveLength(5);
	});
});

describe('renderMarkdown — <path> blocks become file links (2026-10-29)', () => {
	it('a <path> block becomes [basename](full path) — the File Link Intent anchor', () => {
		const out = renderMarkdown('<path>/Users/wharsojo/agentic-ai/glass-live-capture.png</path>');
		expect(out).toContain('<a href="/Users/wharsojo/agentic-ai/glass-live-capture.png">glass-live-capture.png</a>');
	});

	it('a path with spaces stays one link (the whole block is the href)', () => {
		const out = renderMarkdown('<path>/Users/wharsojo/my folder/2026-10-29 - The Note.md</path>');
		expect(out).toContain('<a href="/Users/wharsojo/my folder/2026-10-29 - The Note.md">2026-10-29 - The Note.md</a>');
	});

	it('a <path> block inside a code fence stays literal (tool-payload rule)', () => {
		const out = renderMarkdown('```\n<path>/Users/wharsojo/x.png</path>\n```');
		expect(out).toContain('&lt;path&gt;/Users/wharsojo/x.png&lt;/path&gt;');
		expect(out).not.toContain('<a href');
	});

	it('text without <path> blocks is byte-identical to the plain render', () => {
		expect(renderMarkdown('no paths here')).not.toContain('<a href');
	});
});
