import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../src');

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|ts|css)$/.test(p)) out.push(p);
	}
	return out;
}

// The gate is zero CODE references — the boundary audit itself and the
// package README are audit-trail docs, exempt.
const files = walk(SRC).filter((f) => !f.endsWith('boundary.test.ts'));

describe('boundary audit — zero DSI vocabulary inside the package (W5 5.3-T)', () => {
	it('no $lib alias, no paraglide, no DSI session/type vocabulary anywhere in src', () => {
		const offenders: string[] = [];
		for (const f of files) {
			const text = readFileSync(f, 'utf8');
			const hits = text.match(/\$lib|paraglide|DsiPanelEntry|PanelAddRequest|DsiSession|appConfig/g);
			if (hits) offenders.push(`${f}: ${[...new Set(hits)].join(',')}`);
		}
		expect(offenders).toEqual([]);
	});

	it('no deep relative escapes beyond the package root; internal imports stay relative', () => {
		const offenders: string[] = [];
		for (const f of files) {
			const text = readFileSync(f, 'utf8');
			for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
				const spec = m[1];
				if (spec.startsWith('..') && !spec.startsWith('../')) offenders.push(`${f}: ${spec}`);
				if (spec.startsWith('@deepseek-insight/')) offenders.push(`${f}: self-import ${spec}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('the public surface is reachable only through the hardened exports map (ADR-0064 D2)', () => {
		const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
			exports: Record<string, Record<string, string> | string>;
		};
		expect(Object.keys(pkg.exports)).toEqual(['.', './theme/tokens.css']);
		// R3: the entry is built dist output plus raw sources packed alongside —
		// the standard Svelte-library shape (ADR-0064 D2; R2 pointed at src).
		const entry = pkg.exports['.'] as unknown as Record<string, string>;
		expect(entry.types).toBe('./dist/index.d.ts');
		expect(entry.svelte).toBe('./dist/index.js');
		expect(entry.default).toBe('./dist/index.js');
		expect(pkg.exports['./theme/tokens.css']).toBe('./src/theme/tokens.css');
	});

	it('DSI imports the package only via the bare specifier (no deep consumer paths)', () => {
		// sweep the APP tree the audit can see from the package root's parent
		const appSrc = join(SRC, '..', '..', '..', 'src');
		const offenders: string[] = [];
		const walkApp = (dir: string): void => {
			for (const entry of readdirSync(dir)) {
				const p = join(dir, entry);
				if (statSync(p).isDirectory()) walkApp(p);
				else if (/\.(svelte|ts)$/.test(p)) {
					const text = readFileSync(p, 'utf8');
					for (const m of text.matchAll(/from\s+'(@deepseek-insight\/container-base\/[^']+)'/g)) {
						offenders.push(`${p}: ${m[1]}`);
					}
				}
			}
		};
		walkApp(appSrc);
		expect(offenders).toEqual([]);
	});
});

// The Ground Rule (dev/article/2026-11/04.re-architect, 2026-11-14): the
// package ships no skin. The W5 audit missed ChordPaletteOverlay because it
// only hunted hex literals — this suite hunts the whole escape surface.
describe('ground rule — the package ships no skin (W6)', () => {
	const paletteClass = /(?:bg|text|border|ring|fill|stroke)-(?:[a-z]+-\d{2,3}|white|black)(?:[\/\s"'`]|$)/;
	const rawColor = /#[0-9a-fA-F]{3,8}\b|\brgb\(|\boklch\(/;

	it('no Tailwind color utilities anywhere in src', () => {
		const offenders: string[] = [];
		for (const f of files) {
			const text = readFileSync(f, 'utf8');
			const hits = text.match(new RegExp(paletteClass, 'g'));
			if (hits) offenders.push(`${f}: ${[...new Set(hits)].map((h) => h.trim()).join(',')}`);
		}
		expect(offenders).toEqual([]);
	});

	it('no raw color literals outside tokens.css and the structural mask fill', () => {
		const offenders: string[] = [];
		for (const f of files) {
			if (f.endsWith('tokens.css')) continue; // tokens.css IS the ground
			// capture-colors.ts (ADR-0066, 2026-11-16) is the ground for the
			// capture CANVAS fill — the exported PNG's opaque floor — not the
			// package's skin; its hexes paint pixels, never UI chrome.
			if (f.endsWith('capture-colors.ts')) continue;
			for (const [i, line] of readFileSync(f, 'utf8').split('\n').entries()) {
				if (/mask:\s|mask-image/.test(line)) continue; // alpha-mask geometry, color-irrelevant
				const hits = line.match(new RegExp(rawColor, 'g'));
				if (hits) offenders.push(`${f}:${i + 1}: ${[...new Set(hits)].join(',')}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it('every CSS var a component reads exists in theme/tokens.css (or is the runtime --zoom)', () => {
		const tokens = readFileSync(join(SRC, 'theme', 'tokens.css'), 'utf8');
		const defined = new Set([...tokens.matchAll(/(--[a-z-]+)\s*:/g)].map((m) => m[1]));
		const offenders: string[] = [];
		for (const f of files) {
			if (f.endsWith('tokens.css')) continue;
			for (const m of readFileSync(f, 'utf8').matchAll(/var\((--[a-z0-9-]+)/g)) {
				if (!defined.has(m[1]) && m[1] !== '--zoom') offenders.push(`${f}: ${m[1]}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
