import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * W1 1.1-T — playground independence (ADR-0063 D1).
 * The playground is the second-app proof: it must consume ONLY
 * @deepseek-insight/container-base, never DSI src.
 */
const REPO = resolve(import.meta.dirname, '../../..');
const PG = join(REPO, 'packages/container-base/playground');

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === '.svelte-kit' || name.startsWith('.')) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

describe('playground independence (W1 1.1-T)', () => {
	it('playground package.json declares no @deepseek-insight/dsi dependency', () => {
		const pkg = JSON.parse(readFileSync(join(PG, 'package.json'), 'utf8'));
		const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
		expect(Object.keys(allDeps)).not.toContain('@deepseek-insight/dsi');
		expect(allDeps['@deepseek-insight/container-base']).toBe('workspace:*');
	});

	it('playground imports resolve through the workspace link to the hardened entry (ADR-0064 D2)', () => {
		const req = createRequire(join(PG, 'package.json'));
		const resolved = req.resolve('@deepseek-insight/container-base');
		// R3: the workspace link now resolves to built dist — same exports map
		// a stranger gets, with the raw .svelte sources packed alongside.
		expect(resolved).toContain(join('packages', 'container-base', 'dist', 'index.js'));
		const pkg = JSON.parse(readFileSync(join(REPO, 'packages/container-base/package.json'), 'utf8'));
		expect(pkg.exports['.'].default).toBe('./dist/index.js');
		expect(pkg.dependencies).toBeUndefined(); // zero runtime deps (D4)
	});

	it('no file under playground/ references DSI src ($lib, src/lib, or the dsi package)', () => {
		const banned = [/@deepseek-insight\/(dsi)\b/, /from ['"]\$lib/, /deepseek-insight\/src\//, /import .*['"].*src\/lib\//];
		// Narrow allowance (ADR-0066 D6 follow-up): a vite.config.ts-style BUILD
		// config may import a shared DSI src helper by relative path — the
		// playground's autoTrace preprocess lives at
		// ../../../src/lib/preprocess/auto-trace.ts and is dev-tooling only
		// (never bundled into the playground app, never a runtime dep). The
		// $lib and dsi-package bans still apply to configs; only the two
		// src/lib relative-import patterns are exempted, and only for
		// vite.config.ts.
		const buildConfigOnly = [/deepseek-insight\/src\//, /import .*['"].*src\/lib\//];
		const isBuildConfig = (file: string) => /(^|\/)vite\.config\.ts$/.test(file);
		const offenders: string[] = [];
		for (const file of walk(PG)) {
			if (!/\.(svelte|ts|js|html|json|css)$/.test(file)) continue;
			const text = readFileSync(file, 'utf8');
			const active = isBuildConfig(file)
			? banned.filter((re) => !buildConfigOnly.some((b) => b.source === re.source))
			: banned;
			if (active.some((re) => re.test(text))) offenders.push(file);
		}
		expect(offenders).toEqual([]);
	});
});
