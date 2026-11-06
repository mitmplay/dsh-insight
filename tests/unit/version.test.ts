/**
 * version.ts — the build-time version seam (package.json is the ONE
 * source; new surfaces import this module, never package.json directly).
 * Pins the re-export contract: APP_VERSION mirrors package.json "version"
 * and DSH_VERSION mirrors package.json "dsh"."webVersion".
 */
import { describe, expect, it } from 'vitest';
import { APP_VERSION, DSH_VERSION } from '$lib/version';
import pkg from '../../package.json';

describe('version seam', () => {
	it('APP_VERSION mirrors package.json version', () => {
		expect(APP_VERSION).toBe(pkg.version);
		expect(typeof APP_VERSION).toBe('string');
	});

	it('DSH_VERSION mirrors package.json dsh.webVersion', () => {
		expect(DSH_VERSION).toBe(pkg.dsh.webVersion);
		expect(typeof DSH_VERSION).toBe('string');
	});
});
