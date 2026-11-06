import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

// Source-level pins for TermFontSlider (ADR-0041 Am.4) — the layout and
// token contract the DOM tests alone cannot anchor. Mirrors the
// 'placement + composition contract (source-level)' style of
// tests/unit/terminal-font-slider.test.ts.

const src = readFileSync('src/lib/components/terminal/TermFontSlider.svelte', 'utf8');

describe('TermFontSlider source-level pins', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('the wrapper gap-1 IS the ZoomSlider input↔readout gap pin', () => {
		expect(src).toContain('class="flex shrink-0 items-center gap-1 {className}"');
		// house pattern note names the ancestry explicitly
		expect(src).toContain('ZoomSlider');
	});

	it('the px readout speaks accent-purple via the theme token', () => {
		const readoutStart = src.indexOf('data-testid="{testid}-readout"');
		expect(readoutStart).toBeGreaterThan(-1);
		const spanStart = src.lastIndexOf('<span', readoutStart);
		const span = src.slice(spanStart, readoutStart);
		expect(span).toContain('tabular-nums');
		expect(span).toContain('text-[var(--color-accent-purple)]');
	});

	it('the range input carries the accent-purple token too', () => {
		const inputStart = src.indexOf('<input');
		const input = src.slice(inputStart, src.indexOf('/>', inputStart));
		expect(input).toContain('accent-[var(--color-accent-purple)]');
	});

	it('the 8-20 band is pinned as literals min=8 max=20 step=1', () => {
		expect(src).toContain('min="8"');
		expect(src).toContain('max="20"');
		expect(src).toContain('step="1"');
	});

	it('the readout is tabular-nums (digits never reflow while dragging)', () => {
		const readoutStart = src.indexOf('data-testid="{testid}-readout"');
		const spanStart = src.lastIndexOf('<span', readoutStart);
		expect(src.slice(spanStart, readoutStart)).toContain('tabular-nums');
	});
});
