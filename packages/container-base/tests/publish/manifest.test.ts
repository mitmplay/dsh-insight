import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PKG_DIR = join(import.meta.dirname, '../..');

// Task 1.1-T (ADR-0064 D1-D4): the publish contract is machine-checked —
// a stranger installs a package, not a workspace symlink.
describe('publish manifest (W1 1.1-T)', () => {
	const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));

	it('is public, versioned 0.3.0, zero runtime deps', () => {
		expect(pkg).not.toHaveProperty('private');
		expect(pkg.version).toBe('0.3.0');
		expect(pkg.dependencies).toBeUndefined();
	});

	it('exports map points at dist, tokens.css stays direct (D2)', () => {
		expect(pkg.exports['.']).toEqual({
			types: './dist/index.d.ts',
			svelte: './dist/index.js',
			default: './dist/index.js'
		});
		expect(pkg.exports['./theme/tokens.css']).toBe('./src/theme/tokens.css');
	});

	it('svelte peer is declared required (D4)', () => {
		expect(pkg.peerDependencies.svelte).toBe('^5.0.0');
		expect(pkg.peerDependenciesMeta.svelte).toEqual({ required: true });
	});

	it('files list packs dist + src + README; manifest contains the organs', () => {
		expect(pkg.files).toEqual(['dist', 'src', 'README.md']);
		const out = JSON.parse(
			execFileSync('npm', ['pack', '--dry-run', '--json'], {
			cwd: PKG_DIR,
			encoding: 'utf8',
			// sandbox-safe npm cache: never touch the operator's ~/.npm
			env: { ...process.env, npm_config_cache: join(tmpdir(), 'container-base-npm-cache') }
		})
		);
		const paths = (out[0]?.files ?? []).map((f: { path: string }) => f.path);
		const names = paths.map((p: string) => p.split('/').pop());
		for (const must of ['index.js', 'index.d.ts', 'tokens.css', 'README.md']) {
			expect(names, `pack list must contain ${must}`).toContain(must);
		}
		// raw .svelte sources ride in the tarball (dist d.ts shims point at them)
		const svelte = names.filter((n: string) => n.endsWith('.svelte'));
		expect(svelte.length).toBeGreaterThanOrEqual(6);
	});
});
