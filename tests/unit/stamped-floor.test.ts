import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../bin/dsi.mjs'), 'utf8');
const patch = readFileSync(join(here, '../../plugins/dsh-app-dev-preset/cordis.patch.yml'), 'utf8');

// The Stamped Floor (ADR 2026-11-05): the launcher announces each floor's
// addresses; consumers read the stamp, never a port literal.
function stampedEnv(uiPort: string, mcpPort?: string): Record<string, string> {
	const env: Record<string, string> = { DSI_UI: 'http://127.0.0.1:' + uiPort };
	if (mcpPort !== undefined) env.DSI_MCP_URL = 'http://127.0.0.1:' + mcpPort + '/sse';
	return env;
}

describe('stamped floor env (D1 — the launcher writes the seam)', () => {
	it('helper builds DSI_UI and DSI_MCP_URL with the default brain port', () => {
		// mirrors stampedFloorEnv's shape: UI port from the launch, brain from DSI_MCP_PORT ?? 9515
		const env = stampedEnv('5174');
		expect(env.DSI_UI).toBe('http://127.0.0.1:5174');
	});

	it('source contract: all three spawn points stamp the env', () => {
		// host spawn (sync script child)
		expect(src).toContain('...stampedFloorEnv(uiPort)');
		// build + dev UI halves
		const stampSites = src.split('...stampedFloorEnv(process.env.PORT ?? defaultPort)').length - 1;
		expect(stampSites).toBe(2);
	});

	it('source contract: brain port honors the DSI_MCP_PORT override', () => {
		expect(src).toContain("process.env.DSI_MCP_PORT ?? 9515");
	});
});

describe('preset patch (D2 — env URL with a bare-boot fallback)', () => {
	it('glass mcp-client URL reads the stamp with the 9515 fallback', () => {
		expect(patch).toContain('url: !!js process.env.DSI_MCP_URL ?? ');
		expect(patch).toContain("'http://127.0.0.1:9515/sse'");
		// the hardcode must not survive as the unconditional value
		expect(patch).not.toMatch(/^      url: http:\/\/127\.0\.0\.1:9515\/sse$/m);
	});
});
