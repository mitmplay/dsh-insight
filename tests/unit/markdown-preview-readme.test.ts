
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderPreviewMarkdown, renderMarkdown } from '$lib/utils/markdown';

// Pins the REAL repo README (2026-11-09 details→HTML conversion) through the
// preview path — the file that motivated the wider formatting sweep.
const readme = readFileSync('README.md', 'utf8');

describe('renderPreviewMarkdown — real README.md (wider sweep pin)', () => {
	it('renders details tables as markup, not literal tags', () => {
		const html = renderPreviewMarkdown(readme);
		expect(html).toContain('<table>');
		expect(html).toContain('<th>Argument</th>');
		expect(html).toContain('<td><code>dsh</code></td>');
		expect(html).toContain('<summary><strong>CLI Params</strong></summary>');
		// no escaped table tokens anywhere
		expect(html).not.toContain('&lt;table');
	});

	it('renders details lists and command blocks as markup', () => {
		const html = renderPreviewMarkdown(readme);
		expect(html).toContain('<ul><li><code>/dsi-prompts</code>');
		expect(html).toContain('<pre><code>DSI_PORT=5176');
		expect(html).not.toContain('&lt;pre&gt;');
	});

	it('mermaid fences stay source placeholders, never revived markup', () => {
		const html = renderPreviewMarkdown(readme);
		expect(html).toContain('mermaid-diagram');
	});

	it('strict chat path keeps the README HTML inert (chat parity)', () => {
		const html = renderMarkdown(readme);
		expect(html).toContain('&lt;table&gt;');
		expect(html).not.toMatch(/<table/);
	});
});
