import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const launcher = readFileSync('bin/dsi.mjs', 'utf-8');
const bootstrap = readFileSync('bin/lib/glass-browser-bootstrap.mjs', 'utf-8');

// Task 1.2-T — raw-source wiring pins (dsi.mjs has no unit harness; the
// pins assert the exact call site and its neighbors, ADR D1).
describe('launcher wiring — the Glass Bootstrap', () => {
	it('the --sync branch calls ensureGlassBrowser BEFORE runSyncedPair', () => {
		const call = launcher.indexOf('ensureGlassBrowser({');
		const pair = launcher.indexOf('runSyncedPair(hostArgs');
		expect(call).toBeGreaterThan(-1);
		expect(pair).toBeGreaterThan(call);
	});

	it('the call sits in the --sync branch, beside the zai stage', () => {
		const branchStart = launcher.indexOf("flag === '--sync'");
		const call = launcher.indexOf('ensureGlassBrowser({');
		const nextBranch = launcher.indexOf("'--plugin' ||");
		expect(call).toBeGreaterThan(branchStart);
		expect(call).toBeLessThan(nextBranch);
		// window widened 400→800 (2026-11-12): the ADR comment block between the
		// zai stage (line 211) and the ensureGlassBrowser call grew past 400 chars;
		// the pin's intent — call sits beside the zai stage — is unchanged.
		expect(launcher.slice(call - 800, call)).toContain('addZaiProvider()');
	});

	it('imports the bootstrap module, not a copy', () => {
		expect(launcher).toContain("from './lib/glass-browser-bootstrap.mjs'");
	});

	it('the bounce chain NEVER fetches — no ensureGlassBrowser outside --sync + import', () => {
		const hits = launcher.split('ensureGlassBrowser').length - 1;
		expect(hits).toBe(2); // import + the one --sync call site
		expect(launcher).toContain('sweepAndReserve');
		expect(launcher.indexOf('sweepAndReserve')).toBeGreaterThan(launcher.indexOf('ensureGlassBrowser({'));
	});

	it('the escape hatch is reachable through the module (D4)', () => {
		expect(bootstrap).toContain('DSI_SKIP_BROWSER_INSTALL');
	});
});
