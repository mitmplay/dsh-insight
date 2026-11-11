/**
 * Unit: settings-monaco rehome (Healed Gates ADR-0060 D3, task 2-T) —
 * the leak crossing panels/workspace-file → monaco/settings-monaco
 * disappears structurally: the shared lazy-Monaco bootstrap lives in
 * components/common/ and NO consumer imports the stale monaco path.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
	);
}

describe('settings-monaco rehome (ADR-0060 D3)', () => {
	it('the rehomed module exists at components/common/', () => {
		expect(readdirSync(join(root, 'src/lib/components/common'))).toContain('settings-monaco.ts');
		expect(readdirSync(join(root, 'src/lib/components/monaco'))).not.toContain('settings-monaco.ts');
	});

	it('no panels/workspace-file file imports the stale monaco path', () => {
		const files = ['src/lib/components/panels', 'src/lib/components/workspace-file'].flatMap((d) =>
			walk(join(root, d))
		);
		expect(files.length).toBeGreaterThan(0);
		const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('monaco/settings-monaco'));
		expect(offenders).toEqual([]);
	});
});
