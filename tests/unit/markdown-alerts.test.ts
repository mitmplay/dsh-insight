/**
 * GFM alert block unit pins (ADR-0056, tasks 1.1-T / 1.2-T).
 *
 * Every emitted alert string is pinned at string level; negatives prove D4
 * anchoring (full first line only); the plain blockquote output must stay
 * byte-identical; markers inside code fences stay untouched; markdown.ts
 * must never import Svelte.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderMarkdown } from '$lib/utils/markdown';

const SVG_PREFIX =
	'<svg class="md-alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

describe('GFM alert emitter (task 1.1)', () => {
	it.each([
		['note', 'NOTE', 'Note'],
		['tip', 'TIP', 'Tip'],
		['important', 'IMPORTANT', 'Important'],
		['warning', 'WARNING', 'Warning'],
		['caution', 'CAUTION', 'Caution']
	])('emits the exact classed string for [!%s] (a)', (cls, MARKER, title) => {
		const html = renderMarkdown('> [!' + MARKER + ']\n> body text');
		expect(html).toContain('<blockquote class="md-alert md-alert-' + cls + '">');
		expect(html).toContain('<p class="md-alert-title">' + SVG_PREFIX);
		expect(html).toContain('</svg>' + title + '</p>');
		expect(html).toContain('<p>body text</p></blockquote>');
	});

	it('marker is case-insensitive (b)', () => {
		expect(renderMarkdown('> [!note]\n> x')).toContain('md-alert-note');
		expect(renderMarkdown('> [!Caution]\n> x')).toContain('md-alert-caution');
		expect(renderMarkdown('> [!WARNING]\n> x')).toContain('md-alert-warning');
	});

	it.each([
		['mid-line mention', '> See [!NOTE] in docs'],
		['marker on later line', '> first plain line\n> [!NOTE]'],
		['unknown [!FOO]', '> [!FOO]\n> x']
	])('NEGATIVE: %s stays an ordinary quote (c)', (_name, src) => {
		const html = renderMarkdown(src);
		expect(html).not.toContain('md-alert');
		expect(html).toMatch(/^<blockquote><p>.*<\/p><\/blockquote>$/);
	});

	it('body renders inline markdown: bold + code (d)', () => {
		const html = renderMarkdown('> [!NOTE]\n> **bold** and \`code\`');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<code>code</code>');
	});

	it('plain blockquote output byte-identical (e)', () => {
		expect(renderMarkdown('> plain quote')).toBe(
			'<blockquote><p>plain quote</p></blockquote>'
		);
	});

	it('marker inside a code fence untouched (f)', () => {
		const html = renderMarkdown('\`\`\`\n> [!NOTE]\n\`\`\`');
		expect(html).toContain('[!NOTE]');
		expect(html).not.toContain('md-alert');
	});

	it('markdown.ts has no svelte import (g)', () => {
		const src = readFileSync(resolve('src/lib/utils/markdown.ts'), 'utf8');
			expect(src).not.toContain('svelte');
	});

	it('no input text can produce svg attributes (SVGs are constants)', () => {
		const html = renderMarkdown('> [!NOTE]\n> <svg onload="x">');
			expect(html).not.toContain('<svg onload');
		expect(html).toContain('&lt;svg onload');
	});

	it('marker with trailing spaces matches; CRLF rides the trailing whitespace', () => {
		expect(renderMarkdown('> [!NOTE]   \n> x')).toContain('md-alert-note');
		expect(renderMarkdown('> [!TIP]\r\n> x')).toContain('md-alert-tip');
	});

	it('title-only card (empty body) is acceptable', () => {
		const html = renderMarkdown('> [!NOTE]');
		expect(html).toContain('md-alert-note');
		expect(html).toContain('md-alert-title');
	});

	it('nested blockquote stays visual, no alert', () => {
		const html = renderMarkdown('> > [!NOTE]\n> > x');
		expect(html).not.toContain('md-alert');
	});
});

describe('alert css skin (task 1.2-T)', () => {
	const css = readFileSync(resolve('src/app.css'), 'utf8');

	it.each(['note', 'tip', 'important', 'warning', 'caution'])(
		'.md-content .md-alert-%s present for light and dark (h)',
		(type) => {
			expect(css).toContain('.md-content .md-alert-' + type + ' {');
			expect(css).toContain('html[data-theme="dark"] .md-content .md-alert-' + type + ' {');
		}
	);

	it.each([
		['#3b82f6', '#60a5fa'],
		['#22c55e', '#4ade80'],
		['#8b5cf6', '#a78bfa'],
		['#f59e0b', '#fbbf24'],
		['#ef4444', '#f87171']
	])('tone pair %s (light) / %s (dark) present', (light, dark) => {
		expect(css.toLowerCase()).toContain(light);
		expect(css.toLowerCase()).toContain(dark);
	});
});