/**
 * markdown image pass unit tests (task 1.1-T, "Explorer Freshness and Image
 * Links" Wave 1; ADR "The Silent Root", 2026-11-12).
 *
 * Contract: `![alt](<rel>)` / `![alt](rel)` with a SCHEME-FREE relative
 * destination emit `<img alt="…" data-ws-src="…">` — data-ws-src is inert
 * (MarkdownContent rewrites it to a same-origin /api/dsh/workspace-file-bytes
 * URL; the endpoint enforces containment, so the client never trusts the
 * path). Hostile destinations (scheme, protocol-relative //) return the
 * token unchanged → links() behavior byte-identical to pre-image-pass.
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '$lib/utils/markdown';

/**
 * The complete tag vocabulary renderMarkdown may ever emit (BC-12
 * allow-list). `img` is added DELIBERATELY by the image pass (ADR "The
 * Silent Root" D1, 2026-11-12): the emitter only ever produces
 * `<img alt data-ws-src>` — no src, no event handlers — and the attribute
 * vocabulary is pinned by the assertions below. The sibling
 * markdown.test.ts keeps the original set to prove everything ELSE the
 * renderer emits is unchanged.
 */
const ALLOWED_TAGS = new Set([
	'p', 'strong', 'em', 'del', 'code', 'pre', 'h1', 'h2', 'h3', 'h4',
	'ul', 'ol', 'li', 'blockquote', 'hr', 'br', 'a',
	'table', 'thead', 'tbody', 'tr', 'th', 'td',
	'div', // ONLY the mermaid placeholder — no attributes but class/data-*
	'img' // ONLY alt + data-ws-src, never src/handlers (The Silent Root D1)
]);

function assertOnlyAllowedTags(html: string): void {
	const tags = [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => (m[1] as string).toLowerCase());
	for (const tag of tags) {
		if (!ALLOWED_TAGS.has(tag)) {
			throw new Error(`disallowed tag <${tag}> in rendered output: ${html}`);
		}
	}
}

describe('renderMarkdown images pass (The Silent Root D1)', () => {
	it('probe regression: angle-form image renders <img> with data-ws-src', () => {
		const html = renderMarkdown('Screenshot: ![top row](<sticky-notes-top-row.png>)');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<img');
		expect(html).toContain('data-ws-src="sticky-notes-top-row.png"');
		expect(html).toContain('alt="top row"');
		expect(html).not.toContain('<a href="sticky-notes-top-row.png"');
	});

	it('bare form renders <img> too', () => {
		const html = renderMarkdown('![shot](notes/pic.png)');
		assertOnlyAllowedTags(html);
		expect(html).toContain('data-ws-src="notes/pic.png"');
	});

	it('empty alt renders with an empty alt attribute', () => {
		const html = renderMarkdown('![](<a.png>)');
		assertOnlyAllowedTags(html);
		expect(html).toContain('alt=""');
		expect(html).toContain('data-ws-src="a.png"');
	});

	it('alt text containing <b> stays escaped — no live markup in the attribute', () => {
		const html = renderMarkdown('![<b>bold</b> alt](x.png)');
		assertOnlyAllowedTags(html);
		// escapeHtml applied to the escaped pipeline token: no raw < in output.
		expect(html).not.toMatch(/alt="[^"]*<b>/);
		expect(html).toContain('alt="');
	});

	it('javascript: destination produces NO <img> — token stays a literal link via links()', () => {
		const html = renderMarkdown('![evil](javascript:alert(1))');
		expect(html).not.toContain('<img');
		expect(html).toContain('javascript:alert(1)');
		assertOnlyAllowedTags(html);
	});

	it('data: destination produces NO <img>', () => {
		const html = renderMarkdown('![evil](data:text/html;base64,PHNjcmlwdD4=)');
		expect(html).not.toContain('<img');
		expect(html).toContain('data:text/html;base64');
	});

	it('protocol-relative // destination produces NO <img>', () => {
		const html = renderMarkdown('![evil](//evil.com/x.png)');
		expect(html).not.toContain('<img');
	});

	it('hostile-destination output is byte-equal to plain link behavior (probe proof)', () => {
		// The 2026-11-12 gap probe ran against the LINK path: a plain link
		// renders exactly this (and images pass must not alter link output).
		expect(renderMarkdown('Screenshot: [top row](<sticky-notes-top-row.png>)')).toBe(
			'<p>Screenshot: <a href="sticky-notes-top-row.png">top row</a></p>'
		);
	});

	it('`!` followed by a normal link stays a link with a literal `!`', () => {
		const html = renderMarkdown('!See [docs](guide.md) now');
		assertOnlyAllowedTags(html);
		expect(html).toContain('<p>!See <a href="guide.md">docs</a> now</p>');
		expect(html).not.toContain('<img');
	});

	it('directory-named destination still renders (endpoint owns 403/415 refusal)', () => {
		const html = renderMarkdown('![dir](<some-directory>)');
		assertOnlyAllowedTags(html);
		expect(html).toContain('data-ws-src="some-directory"');
	});
});
