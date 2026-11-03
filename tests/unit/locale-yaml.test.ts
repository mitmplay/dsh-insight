// @vitest-environment node
/**
 * readOperatorYamlLocale — Three Tongues W1 (ADR 2026-09-12 D3).
 * The hooks-locale suite mocks the settings seam; these tests exercise the
 * REAL yaml path through readOperatorYamlLocale's configPath test seam:
 * one case per document shape the resolver must treat as silent or spoken.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOperatorYamlLocale } from '../../src/lib/server/locale';

/** Write a yaml document to a fresh temp file; return its path. */
function tmpYaml(content: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-locale-yaml-'));
	const p = join(dir, 'settings.yaml');
	writeFileSync(p, content, 'utf-8');
	return p;
}

describe('readOperatorYamlLocale — document shapes', () => {
	it('reads ui.locale from a real yaml document', () => {
		expect(readOperatorYamlLocale(tmpYaml('ui:\n  locale: id\n'))).toBe('id');
	});

	it('passes the raw value through ungated — even a non-fleet one', () => {
		// Gating is the resolver's job; the reader is a dumb window on yaml.
		expect(readOperatorYamlLocale(tmpYaml('ui:\n  locale: fr\n'))).toBe('fr');
	});

	it('yaml without a ui section is silent', () => {
		expect(readOperatorYamlLocale(tmpYaml('chat:\n  maxRows: 3\n'))).toBeUndefined();
	});

	it('a ui section without a locale key is silent', () => {
		expect(readOperatorYamlLocale(tmpYaml('ui:\n  other: 1\n'))).toBeUndefined();
	});

	it('an empty document parses to null — silent', () => {
		expect(readOperatorYamlLocale(tmpYaml(''))).toBeUndefined();
	});

	it('a broken yaml document never 500s — the reader is silent', () => {
		expect(readOperatorYamlLocale(tmpYaml('ui: [broken'))).toBeUndefined();
	});

	it('a missing settings file is silent', () => {
		// Parent dir must exist (mkdtempSync) — readSettingsDocument('dsi') runs
		// ensureDsiHome(dirname(path)), which would clone template/.dsi into a
		// nonexistent dir and its settings.yaml would be read instead.
		const dir = mkdtempSync(join(tmpdir(), 'dsi-locale-yaml-'));
		try {
			expect(readOperatorYamlLocale(join(dir, 'settings.yaml'))).toBeUndefined(); // dir exists, file never written
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
