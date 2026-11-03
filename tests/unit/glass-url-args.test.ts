/**
 * Unit pins for glass-url's pure helpers (ADR-0045 Amendment 5, D9 + D10).
 * The driver connects to CDP at import, so its pure logic lives in
 * .agents/skills/glass-url/scripts/_args.mjs — these tests import THAT file
 * directly (no CDP, no glass). Each case names the defect it retires.
 */
import { describe, it, expect } from 'vitest';
import { norm, parseEvalArgs, matchAllTerms } from '../../.agents/skills/glass-url/scripts/_args.mjs';

describe('parseEvalArgs (D10 — grammar parsed, not positional)', () => {
	it('inline: single arg is the source, no substring', () => {
		expect(parseEvalArgs(['1+1'])).toEqual({ src: '1+1', substr: undefined });
	});

	it('inline: substring first, source last', () => {
		expect(parseEvalArgs(['watch?v=', 'document.title'])).toEqual({
			substr: 'watch?v=',
			src: 'document.title'
		});
	});

	it('b64: payload only — the case that used to silently drop the substring', () => {
		expect(parseEvalArgs(['YWJj'], { b64: true })).toEqual({ src: 'YWJj', substr: undefined });
	});

	it('b64: payload + substring — the dropped case, now honored', () => {
		expect(parseEvalArgs(['YWJj', 'search_query=dimas'], { b64: true })).toEqual({
			src: 'YWJj',
			substr: 'search_query=dimas'
		});
	});

	it('empty rest yields undefined src (driver dies loudly)', () => {
		expect(parseEvalArgs([])).toEqual({ src: undefined, substr: undefined });
	});
});

describe('matchAllTerms (D9 — the play match consumes EVERY term)', () => {
	it('accepts when artist AND title both appear', () => {
		expect(matchAllTerms('November Rain - Dimas Senopati Cover', 'Dimas Senopati')).toBe(true);
	});

	it('rejects when the artist term is missing — the wrong-cover defect', () => {
		expect(matchAllTerms("Guns N Roses - November Rain (Acoustic Cover)", 'November Rain Dimas')).toBe(false);
	});

	it('normalizes apostrophes and case', () => {
		expect(matchAllTerms("Guns N’ Roses — November Rain", "guns n' roses november")).toBe(true);
	});

	it('punctuation runs do not break a term match', () => {
		expect(matchAllTerms('November Rain (2022 Version)', 'november rain')).toBe(true);
	});

	it('empty play value means no filter — first result, unchanged behavior', () => {
		expect(matchAllTerms('Anything At All', '')).toBe(true);
		expect(matchAllTerms('Anything At All', undefined as unknown as string)).toBe(true);
	});

	it('norm folds case and strips punctuation', () => {
		expect(norm("What's Up — 4 Non Blondes")).toBe('whats up 4 non blondes');
	});
});
