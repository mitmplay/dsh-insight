import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../../..');

// Task 4.1-T (ADR-0064 D7, pre-publish form): the cold-room smoke script
// runs against the LOCAL tarball — exit 0 + survival assertions passed is
// the contract it can meet without credentials. The SAME script re-proves
// the registry publish after the operator's npm publish (RELEASE.md).
describe('cold-room smoke install (W4 4.1-T)', () => {
	it('packs, installs into a scratch app, and survives first paint + hard reload', () => {
		const out = execFileSync('node', ['scripts/container-base-smoke.mjs'], {
			cwd: ROOT,
			encoding: 'utf8',
			timeout: 10 * 60 * 1000
		});
		expect(out).toContain('SMOKE PASS');
		expect(out).toContain('install from tarball: done');
		expect(out).toContain('ThemeToggle mounted: yes');
	}, 12 * 60 * 1000);
});
