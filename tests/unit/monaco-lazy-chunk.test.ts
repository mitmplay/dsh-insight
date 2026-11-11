/**
 * Monaco lazy-chunk gate (Task 4.1-T) — ADR D4's split, pinned at the
 * seam: the panel reaches Monaco ONLY through a dynamic import of the
 * glue module, and the glue + its worker shim are the ONLY files that
 * import monaco-editor / monaco-yaml. A static import anywhere else
 * would fold the editor into the floor's first-paint chunk — exactly
 * what this test rejects. (The bundled-chunk assertion runs as a real
 * `pnpm run build` in the wave gate; this unit test pins the source
 * seam that guarantees it.)
 *
 * Spec: dev/specs/2026-09-07 - DSI Settings Panel (ADR D4; Tasks
 *      4.1/4.1-T).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function tsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...tsFiles(p));
		else if (/\.(ts|svelte)$/.test(name)) out.push(p);
	}
	return out;
}

const MONACO_RE = /from ['"]monaco(-editor|-yaml)?(\/[^'"]*)?['"]/;

describe('monaco lazy-chunk seam (W4 4.1-T)', () => {
	it('only the glue and its worker shim import monaco', () => {
		const offenders = tsFiles(SRC).filter((f) => {
			if (f.endsWith('settings-monaco.ts') || f.endsWith('settings-editor-worker.ts')) {
				return false;
			}
			return MONACO_RE.test(readFileSync(f, 'utf-8'));
		});
		expect(offenders).toEqual([]);
	});

	it('the panel loads the glue ONLY through a dynamic import (no static path)', () => {
		const panel = readFileSync(join(SRC, 'lib/components/panels/SettingsEditorPanel.svelte'), 'utf-8');
		expect(panel).toContain("await import('../common/settings-monaco')");
		// A type-only import is erased at compile time and pulls no chunk;
		// any VALUE import would fold Monaco into the floor chunk.
		expect(panel).not.toMatch(
			/import\s+(?!type\b)[^']*from ['"]\.\.\/monaco\/settings-monaco['"]/
		);
	});
});

// ── Loadinjected W1 1.3-T — the readOnly seam (2026-09-07 ADR D1) ──

describe('monaco readOnly seam (Loadinjected W1 1.3-T)', () => {
	const glue = readFileSync(join(SRC, 'lib/components/common/settings-monaco.ts'), 'utf-8');

	it('the glue declares a readOnly option that reaches editor.create, defaulting off', () => {
		// The option exists on the creation contract (optional — the
		// settings editor compiles unchanged).
		expect(glue).toMatch(/options\?:\s*YamlEditorOptions/);
		// It reaches the editor options: the EDITOR blocks user edits;
		// programmatic setValue stays available for a fresh load.
		expect(glue).toMatch(/readOnly:\s*options\?\.readOnly === true/);
		// Default off — no hardcoded readOnly anywhere in the glue.
		expect(glue).not.toMatch(/readOnly:\s*true\b/);
	});

	it('the settings path is unchanged — its caller passes no readOnly yet', () => {
		const panel = readFileSync(join(SRC, 'lib/components/panels/SettingsEditorPanel.svelte'), 'utf-8');
		expect(panel).toContain("await import('../common/settings-monaco')");
		expect(panel).not.toMatch(/readOnly/);
	});
});
