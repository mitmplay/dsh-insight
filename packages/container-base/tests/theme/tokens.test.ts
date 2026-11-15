import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../../src');

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|ts)$/.test(p)) out.push(p);
	}
	return out;
}

describe('theme tokens inventory (W5 5.2-T, D7)', () => {
	it('every var(--x) a package component reads is defined in tokens.css', () => {
		const tokens = readFileSync(join(SRC, 'theme/tokens.css'), 'utf8');
		const defined = new Set([...tokens.matchAll(/--([a-z-]+)\s*:/g)].map((m) => `--${m[1]}`));
		const missing: string[] = [];
		for (const f of walk(SRC)) {
			const text = readFileSync(f, 'utf8');
			for (const m of text.matchAll(/var\((--[a-z-]+)/g)) {
				// --zoom is a RUNTIME variable (PanelsZoom writes it per frame),
				// not a theme token — exempt.
				if (m[1] === '--zoom') continue;
				if (!defined.has(m[1])) missing.push(`${f}: ${m[1]}`);
			}
		}
		expect(missing).toEqual([]);
	});

	it('components carry no raw color literals outside var() fallbacks (D7)', () => {
		const offenders: string[] = [];
		for (const f of walk(join(SRC, 'components'))) {
			if (f.endsWith('.test.ts')) continue;
			const text = readFileSync(f, 'utf8');
			// strip var(..., fallback) fallback hexes (graceful degradation is
			// allowed) and the selection-ring mask FILL (the xor-mask trick is
			// structurally white — it carves a hole, it paints no theme color).
			const stripped = text
				.replace(/var\([^)]*\)/g, '')
				.replace(/linear-gradient\(#fff 0 0\)/g, '');
			const hits = stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
			if (hits) offenders.push(`${f}: ${hits.join(',')}`);
		}
		expect(offenders).toEqual([]);
	});

	it('tokens.css defines the full expected set (drift detector)', () => {
		const tokens = readFileSync(join(SRC, 'theme/tokens.css'), 'utf8');
		for (const v of [
			'--color-surface-primary',
			'--color-surface-secondary',
			'--color-surface-elevated',
			'--color-surface-border',
			'--color-header-wash',
			'--color-text-primary',
			'--color-text-secondary',
			'--color-accent-blue',
			'--color-accent-purple',
			'--color-accent-rose',
			'--color-status-pass',
			'--color-status-fail'
		]) {
			expect(tokens).toContain(v);
		}
	});
});
