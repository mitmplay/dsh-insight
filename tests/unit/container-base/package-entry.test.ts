import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// Bare-specifier import — since R3 (ADR-0064 D2) this resolves through the
// hardened exports map to the built dist entry; run `pnpm --filter
// @deepseek-insight/container-base run build:package` first on a fresh clone.
import { CONTAINER_BASE_VERSION } from '@deepseek-insight/container-base';

const ROOT = path.resolve(import.meta.dirname, '../../..');

describe('container-base package entry (W1)', () => {
	it('resolves via the bare specifier and exports the probe', () => {
		// version travels with the package.json (885477fd lesson: a hardcoded
		// pin went stale at the 0.1.1 -> 0.2.0 release bump) — assert the
		// runtime export equals the manifest, not a copied literal.
		const pkg = JSON.parse(
			readFileSync(path.join(ROOT, 'packages/container-base/package.json'), 'utf8')
		) as { version: string };
		expect(CONTAINER_BASE_VERSION).toBe(pkg.version);
	});

	it('exports map carries "." and "./theme/tokens.css"', () => {
		const pkg = JSON.parse(
			readFileSync(path.join(ROOT, 'packages/container-base/package.json'), 'utf8')
		) as { name: string; version: string; exports: Record<string, unknown>; private?: boolean };
		expect(pkg.name).toBe('@deepseek-insight/container-base');
		expect(Object.keys(pkg.exports)).toEqual(['.', './theme/tokens.css']);
		// R3: the package is public — the private flag is gone (ADR-0064 D3)
		expect(pkg.private).toBeUndefined();
		// pinned to the current manifest (went stale once at 0.1.1 -> 0.2.0)
		expect(pkg.version).toBe('0.3.0');
	});

	it('pnpm-workspace.yaml still carries the three pre-existing keys', () => {
		const yml = readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
		expect(yml).toMatch(/^allowBuilds:/m);
		expect(yml).toMatch(/^minimumReleaseAgeExclude:/m);
		expect(yml).toMatch(/^overrides:/m);
		expect(yml).toMatch(/^packages:/m);
	});

	it('root package.json consumes the package as workspace source', () => {
		const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
			dependencies: Record<string, string>;
		};
		// pinned to the current manifest (version-range dep since 0.3.0)
		expect(pkg.dependencies['@deepseek-insight/container-base']).toBe('^0.3.0');
	});
});
