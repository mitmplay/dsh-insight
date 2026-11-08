import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../bin/dsi.mjs'), 'utf8');
const patch = readFileSync(join(here, '../../plugins/dsh-app-dev-preset/cordis.patch.yml'), 'utf8');

// The Stamped Floor (ADR 2026-11-05): the launcher announces each floor's
// addresses; consumers read the stamp, never a port literal.
// 2026-11-08 (ADR The Glass Brain Address): the brain stamp is named
// GLASS_BRAIN_URL, with an operator pre-set passing through byte-for-byte (D2).
function stampedEnv(uiPort: string, brainPort?: string): Record<string, string> {
	const env: Record<string, string> = { DSI_UI: 'http://127.0.0.1:' + uiPort };
	if (brainPort !== undefined) env.GLASS_BRAIN_URL = 'http://127.0.0.1:' + brainPort + '/sse';
	return env;
}

// Pull the real stampedFloorEnv out of bin/dsi.mjs and run it, so the
// override branch is exercised as shipped code, not a mirrored copy.
function loadStampedFloorEnv(env: Record<string, string | undefined>): (uiPort: string) => Record<string, string> {
	const match = src.match(/function stampedFloorEnv\(uiPort\) \{[\s\S]*?\n\}/);
	if (!match) throw new Error('stampedFloorEnv not found in bin/dsi.mjs');
	// eslint-disable-next-line no-eval
	const fn = eval('(' + match[0] + ')');
	// stampedFloorEnv reads process.env at call time — apply the fixture
	// around each call, restoring the runner's real env after.
	return (uiPort: string) => {
		const saved: Record<string, string | undefined> = {};
		for (const key of ['GLASS_BRAIN_URL', 'GLASS_PORT', 'GLASS_CHASSIS_URL']) {
			saved[key] = process.env[key];
			if (env[key] === undefined) delete process.env[key];
			else process.env[key] = env[key] as string;
		}
		try {
			return fn(uiPort);
		} finally {
			for (const key of Object.keys(saved)) {
				if (saved[key] === undefined) delete process.env[key];
				else process.env[key] = saved[key] as string;
			}
		}
	};
}

describe('stamped floor env (D1 — the launcher writes the seam)', () => {
	it('helper builds DSI_UI and GLASS_BRAIN_URL with the default brain port', () => {
		// mirrors stampedFloorEnv's shape: UI port from the launch, brain from GLASS_PORT ?? 9515
		const env = stampedEnv('5174', '9515');
		expect(env.DSI_UI).toBe('http://127.0.0.1:5174');
		expect(env.GLASS_BRAIN_URL).toBe('http://127.0.0.1:9515/sse');
	});

	it('source contract: all three spawn points stamp the env', () => {
		// host spawn (sync script child)
		expect(src).toContain('...stampedFloorEnv(uiPort)');
		// build + dev UI halves
		const stampSites = src.split('...stampedFloorEnv(process.env.DSI_PORT ?? defaultPort)').length - 1;
		expect(stampSites).toBe(2);
	});

	it('source contract: brain port honors the GLASS_PORT override', () => {
		expect(src).toContain("process.env.GLASS_PORT ?? 9515");
	});
});

describe('GLASS_BRAIN_URL rename + operator override (ADR 2026-11-08, D1-D2)', () => {
	it('stamp key is the new name — the legacy DSI MCP URL name is gone from the launcher', () => {
		expect(src).toContain('GLASS_BRAIN_URL:');
		expect(src).not.toContain(['DSI', 'MCP_URL'].join('_'));
	});

	it('unset override: brain URL computed from GLASS_PORT ?? 9515', () => {
		const fn = loadStampedFloorEnv({ GLASS_BRAIN_URL: undefined, GLASS_PORT: '9600' });
		expect(fn('5174').GLASS_BRAIN_URL).toBe('http://127.0.0.1:9600/sse');
	});

	it('unset override + unset GLASS_PORT: bare-boot default 9515', () => {
		const fn = loadStampedFloorEnv({ GLASS_BRAIN_URL: undefined, GLASS_PORT: undefined });
		expect(fn('5174').GLASS_BRAIN_URL).toBe('http://127.0.0.1:9515/sse');
	});

	it('operator override wins over GLASS_PORT (D2) — byte-for-byte, no trim, no validation', () => {
		const fn = loadStampedFloorEnv({ GLASS_BRAIN_URL: 'http://127.0.0.1:9999/sse', GLASS_PORT: '9600' });
		expect(fn('5174').GLASS_BRAIN_URL).toBe('http://127.0.0.1:9999/sse');
	});

	it('override passes garbage and trailing whitespace through untouched', () => {
		const fn = loadStampedFloorEnv({ GLASS_BRAIN_URL: 'not-a-url  ', GLASS_PORT: undefined });
		expect(fn('5174').GLASS_BRAIN_URL).toBe('not-a-url  ');
	});
});

describe('GLASS_CHASSIS_URL stamp (ADR-0054, D1/D5 — where the window is born)', () => {
	it('operator-exported GLASS_CHASSIS_URL passes through byte-for-byte (no trim, no validation)', () => {
		const fn = loadStampedFloorEnv({ GLASS_CHASSIS_URL: 'http://192.168.1.9:9560', GLASS_BRAIN_URL: undefined, GLASS_PORT: undefined });
		expect(fn('5174').GLASS_CHASSIS_URL).toBe('http://192.168.1.9:9560');
	});

	it('garbage and trailing whitespace pass through untouched — same ladder as the brain stamp', () => {
		const fn = loadStampedFloorEnv({ GLASS_CHASSIS_URL: 'not-a-url  ', GLASS_BRAIN_URL: undefined, GLASS_PORT: undefined });
		expect(fn('5174').GLASS_CHASSIS_URL).toBe('not-a-url  ');
	});

	it('UNSET: nothing is stamped — the env shape is byte-for-byte today (D5)', () => {
		const fn = loadStampedFloorEnv({ GLASS_CHASSIS_URL: undefined, GLASS_BRAIN_URL: undefined, GLASS_PORT: undefined });
		const env = fn('5174');
		expect('GLASS_CHASSIS_URL' in env).toBe(false);
		expect(Object.keys(env).sort()).toEqual(['DSI_UI', 'GLASS_BRAIN_URL']);
	});
});

describe('preset patch (D2 — env URL with a bare-boot fallback)', () => {
	it('glass mcp-client URL reads GLASS_BRAIN_URL with the 9515 fallback literal unchanged', () => {
		expect(patch).toContain('url: !!js process.env.GLASS_BRAIN_URL ?? ');
		expect(patch).toContain("'http://127.0.0.1:9515/sse'");
		// the hardcode must not survive as the unconditional value
		expect(patch).not.toMatch(/^      url: http:\/\/127\.0\.0\.1:9515\/sse$/m);
	});

	it('preset patch no longer reads the legacy DSI MCP URL name', () => {
		expect(patch).not.toContain(['DSI', 'MCP_URL'].join('_'));
	});
});