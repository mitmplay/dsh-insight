import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// imports go through the package's ONLY public surface (index.ts).
import { declareRegistryPrefixes, isGrammarCompliant } from '../../src/index';

const PREFIXES = declareRegistryPrefixes(['dsi', 'pg', 'cb']);

describe('key grammar (ADR-0065 D9 — naming law)', () => {
	it('declared prefixes freeze and reject bad declarations', () => {
		expect(Object.isFrozen(PREFIXES)).toBe(true);
		expect(() => declareRegistryPrefixes([])).toThrow();
		expect(() => declareRegistryPrefixes(['DSI'])).toThrow();
		expect(() => declareRegistryPrefixes(['d i'])).toThrow();
	});

	it('accepts the three consumer identities', () => {
		expect(isGrammarCompliant('dsi-panels', PREFIXES)).toBe(true);
		expect(isGrammarCompliant('pg-panel', PREFIXES)).toBe(true);
		expect(isGrammarCompliant('cb-theme', PREFIXES)).toBe(true);
		expect(isGrammarCompliant('pg-theme', PREFIXES)).toBe(true);
		expect(isGrammarCompliant('pg-sidebar', PREFIXES)).toBe(true);
	});

	it('accepts multi-segment names and the profile suffix', () => {
		expect(isGrammarCompliant('dsi-panels-widi-desk', PREFIXES)).toBe(true);
		// profile suffix shape matches sanitizeWorkspaceProfile's contract
		expect(isGrammarCompliant('dsi-panels_widi', PREFIXES)).toBe(true);
		expect(isGrammarCompliant('dsi-panels_W-1a', PREFIXES)).toBe(true);
	});

	it('REJECTS dot separators (the pg.panel / pg.locale drift)', () => {
		expect(isGrammarCompliant('pg.panel', PREFIXES)).toBe(false);
		expect(isGrammarCompliant('pg.locale', PREFIXES)).toBe(false);
		expect(isGrammarCompliant('dsi.panels', PREFIXES)).toBe(false);
	});

	it('REJECTS undeclared prefixes', () => {
		expect(isGrammarCompliant('foo-x', PREFIXES)).toBe(false);
		expect(isGrammarCompliant('dsi2-x', PREFIXES)).toBe(false);
	});

	it('REJECTS double separators and malformed names', () => {
		expect(isGrammarCompliant('pg--panel', PREFIXES)).toBe(false);
		expect(isGrammarCompliant('pg-panel-', PREFIXES)).toBe(false);
		expect(isGrammarCompliant('-pg-panel', PREFIXES)).toBe(false);
		expect(isGrammarCompliant('pg-', PREFIXES)).toBe(false);
		// 'pg-panel__x' is VALID: profile '_x' is what sanitizeWorkspaceProfile
		// accepts, so storageKey('pg-panel', '_x') produces it (namespace.ts owns
		// the suffix contract). An empty profile segment is not:
		expect(isGrammarCompliant('pg-panel_', PREFIXES)).toBe(false);
		expect(isGrammarCompliant('', PREFIXES)).toBe(false);
	});
});

// ── 1.2-T grammar CI scan ──────────────────────────────────────────────
// Scans the repo's consumer key literals: DSI's PANEL_PREFS_KEY must be
// compliant; the playground's dot keys are RECORDED as known-pending and
// the pending list is removed in Wave 4 (pg.panel → pg-panel rename).
// Enforcement is HERE, never a runtime throw (D9 binding resolution,
// karpathy-context L2.6).

const here = fileURLToPath(import.meta.url);
const playgroundPage = new URL('../../playground/src/routes/+page.svelte', 'file://' + here).pathname;
const dsiPanelPrefs = new URL('../../../../src/lib/utils/panel-prefs.ts', 'file://' + here).pathname;

/** Storage-key literals (single-quoted) with a pg/dsi/cb prefix in a source file. */
function scanKeyLiterals(source: string): string[] {
	const hits = source.match(/'(?:dsi|pg|cb)[.-][A-Za-z0-9_.-]*'/g) ?? [];
	return [...new Set(hits.map((s) => s.slice(1, -1)))];
}

describe('grammar CI scan over repo consumer keys (1.2-T)', () => {
	it("DSI's dsi-panels key literal is grammar-compliant", () => {
		const src = readFileSync(dsiPanelPrefs, 'utf8');
		const keys = scanKeyLiterals(src).filter((k) => k.startsWith('dsi'));
		expect(keys.length).toBeGreaterThan(0);
		for (const k of keys) expect(isGrammarCompliant(k, PREFIXES)).toBe(true);
	});

	it('playground dot-keys are GONE — grammar scan green with zero pending (Wave 4)', () => {
		const src = readFileSync(playgroundPage, 'utf8');
		const keys = scanKeyLiterals(src);
		// pg.panel/pg.locale renamed in Wave 4 (4.1) — the known-pending list is empty.
		const pending = keys.filter((k) => !isGrammarCompliant(k, PREFIXES));
		expect(pending).toEqual([]);
		// …and every consumer key in the page is compliant, pg-* prefixed.
		expect(keys.length).toBeGreaterThan(0);
	});
});
