/**
 * Preview HTML Allow-List tests (ADR-0055 companion Wave 1, task 1.1-T;
 * 2026-11-09). Pins the PREVIEW path: renderPreviewMarkdown revives ONLY
 * the allow-listed tags/attrs from escaped source, fenced HTML stays
 * source in BOTH paths, javascript:/data:/relative src stays inert, and
 * the STRICT path output is unchanged (chat parity, BC-12).
 */
import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderPreviewMarkdown } from '$lib/utils/markdown';

const BANNER = '<p align="center"><img src="https://example.com/banner.png" alt="banner" width="600" /></p>';

describe('renderPreviewMarkdown — revival allow-list', () => {
	it('revives the README banner snippet as real markup', () => {
		const html = renderPreviewMarkdown(BANNER);
		expect(html).toContain('<p align="center">');
		expect(html).toContain('<img src="https://example.com/banner.png" alt="banner" width="600" />');
		expect(html).not.toContain('&lt;p align');
	});

	it('script/style/iframe never revive', () => {
		const html = renderPreviewMarkdown('<script>alert(1)</script><style>x</style><iframe src="https://x.test"></iframe>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&lt;style&gt;');
		expect(html).toContain('&lt;iframe');
		expect(html).not.toMatch(/<(script|style|iframe)\b/i);
	});

	it('on* handlers and unknown attrs leave the WHOLE token escaped', () => {
		const hostile = '<img src="https://x.test/a.png" onerror="alert(1)">';
		expect(renderPreviewMarkdown(hostile)).toContain('&lt;img');
		const unknown = '<div class="evil" align="center">hi</div>';
		const out = renderPreviewMarkdown(unknown);
		expect(out).toContain('&lt;div class=&quot;evil&quot;');
		expect(out).not.toMatch(/<div class=/);
	});

	it('javascript:/data:/relative src stays inert text', () => {
		for (const src of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'img/local.png', '/workspace/banner.png']) {
			const html = renderPreviewMarkdown(`<img src="${src}" alt="x">`);
			expect(html).toContain('&lt;img', `src ${src} revived`);
			expect(html).not.toMatch(/<img\b/);
		}
	});

	it('fenced HTML stays escaped source in BOTH paths (D3)', () => {
		const fenced = '```html\n<div align="center">hi</div>\n```';
		const expected = '<pre><code>&lt;div align=&quot;center&quot;&gt;hi&lt;/div&gt;</code></pre>';
		expect(renderMarkdown(fenced)).toBe(expected);
		expect(renderPreviewMarkdown(fenced)).toContain(expected);
		expect(renderPreviewMarkdown(fenced)).not.toMatch(/<div align=/);
	});

	it('details/summary renders as real collapsible', () => {
		const html = renderPreviewMarkdown('<details><summary>More</summary>body</details>');
		expect(html).toContain('<details><summary>More</summary>body</details>');
	});

	it('multi-line HTML block revives across the paragraph join', () => {
		const html = renderPreviewMarkdown('<div align="center">\nline one\nline two\n</div>');
		expect(html).toContain('<div align="center">');
		expect(html).toContain('</div>');
	});

	it('bold markdown inside a revived div stays markdown-rendered', () => {
		const html = renderPreviewMarkdown('<div align="center">**bold** text</div>');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<div align="center">');
	});

	it('uppercase <IMG> normalizes to lowercase', () => {
		const html = renderPreviewMarkdown('<IMG SRC="https://x.test/a.png" ALT="a">');
		expect(html).toMatch(/<img /);
		expect(html).not.toMatch(/<IMG/); // case-sensitive: <img is the normalized form
		expect(html).toContain('alt="a"');
	});

	it('malformed tags stay escaped text', () => {
		const html = renderPreviewMarkdown('<p align="center'); // unterminated
		expect(html).not.toMatch(/<p align=/);
		const junk = '<div align="center" junk!!!>x</div>';
		expect(renderPreviewMarkdown(junk)).toContain('&lt;div align');
	});

	it('self-closing img revives with the slash kept', () => {
		expect(renderPreviewMarkdown('<img src="https://x.test/a.png"/>')).toContain('<img src="https://x.test/a.png" />');
	});

	// ── 2026-11-09 wider formatting sweep (ADR-0055 D2 amendment 2) ──

	it('revives an HTML table (converted README CLI Params shape)', () => {
		const t = '<table><tr><th>Argument</th><th>What it does</th></tr><tr><td><code>dsh</code></td><td>starts <strong>DSH</strong></td></tr></table>';
		const html = renderPreviewMarkdown(t);
		expect(html).toContain('<table>');
		expect(html).toContain('<th>Argument</th>');
		expect(html).toContain('<td><code>dsh</code></td>');
		expect(html).not.toContain('&lt;table');
	});

	it('revives lists, headings, hr, span, sub, sup', () => {
		const html = renderPreviewMarkdown('<ul><li><code>/dsi-prompts</code> — Open prompt manager</li></ul><h2>Section</h2><hr><span align="center">s</span><sub>a</sub><sup>b</sup>');
		expect(html).toContain('<ul><li><code>/dsi-prompts</code>');
		expect(html).toContain('<h2>Section</h2>');
		expect(html).toContain('<hr />');
		expect(html).toContain('<span align="center">');
		expect(html).toContain('<sub>a</sub>');
		expect(html).toContain('<sup>b</sup>');
	});

	it('pre/code bodies stay escaped character data', () => {
		const html = renderPreviewMarkdown('<pre><code>DSI_PORT=5176 npx dsi dsh --sync && echo <n></code></pre>');
		expect(html).toContain('<pre><code>');
		expect(html).toContain('&amp;&amp;');
		expect(html).toContain('&lt;n&gt;');
		expect(html).not.toContain('<pre><code>DSI_PORT=5176 npx dsi dsh --sync && echo');
	});

	it('hostile attribute on a swept tag escapes the WHOLE token', () => {
		const out = renderPreviewMarkdown('<table onload="alert(1)"><tr><td>x</td></tr></table>');
		expect(out).toContain('&lt;table onload=');
		expect(out).not.toMatch(/<table/);
	});

	it('off-list tag after the sweep stays escaped (thead-less unknown)', () => {
		const out = renderPreviewMarkdown('<video src="https://x.test/v.mp4"></video>');
		expect(out).toContain('&lt;video');
	});
});

describe('renderMarkdown — strict path unchanged (chat parity)', () => {
	it('escapes the banner snippet exactly as probed on 2026-11-09', () => {
		const html = renderMarkdown(BANNER);
		expect(html).toContain('&lt;p align=&quot;center&quot;&gt;');
		expect(html).not.toMatch(/<img\b/);
		expect(html).not.toMatch(/<p align=/);
	});

	it('renders normal markdown exactly as the strict pin expects', () => {
		expect(renderMarkdown('**bold** and `code`')).toBe('<p><strong>bold</strong> and <code>code</code></p>');
	});
});