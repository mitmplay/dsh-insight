import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PKG_DIR = join(import.meta.dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

// Task 1.2-T (ADR-0064): the built artifact obeys the same boundary rule —
// dist never imports DSI, never leans on $lib.
describe('build output (W1 1.2-T)', () => {
	it('dist exists with the public entry pair', () => {
		execFileSync('pnpm', ['run', 'build:package'], { cwd: PKG_DIR, encoding: 'utf8' });
		expect(existsSync(join(PKG_DIR, 'dist/index.js'))).toBe(true);
		expect(existsSync(join(PKG_DIR, 'dist/index.d.ts'))).toBe(true);
	});

	it('dist contains zero DSI imports and zero $lib references', () => {
		const files = walk(join(PKG_DIR, 'dist'));
		const offenders: string[] = [];
		for (const f of files) {
			const text = readFileSync(f, 'utf8');
			if (/deepseek-insight\/dsi|\$lib/.test(text)) offenders.push(f);
		}
		expect(offenders).toEqual([]);
	});
});
