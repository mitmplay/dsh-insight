import { describe, expect, it } from 'vitest';

import { devModeEnv } from '../../bin/lib/dev-mode.mjs';

// source-contract test: the CLI must strip the dsi-side flag before the host
// spawn (dsh web refuses unknown flags) and carry the marker on the vite child
const DSI = process.cwd() + '/bin/dsi.mjs';

describe('W3 3.2 — --playwright-mcp flag wiring (D7)', () => {
	it('devModeEnv adds DSI_MCP_IN_PROCESS only when opted in', () => {
		expect(devModeEnv('pair', { playwrightMcp: true }).DSI_MCP_IN_PROCESS).toBe('1');
		expect(devModeEnv('in-process', { playwrightMcp: true }).DSI_MCP_IN_PROCESS).toBe('1');
		expect(devModeEnv('pair')).not.toHaveProperty('DSI_MCP_IN_PROCESS');
		expect(devModeEnv('in-process')).not.toHaveProperty('DSI_MCP_IN_PROCESS');
		expect(devModeEnv('build', { playwrightMcp: true })).toEqual({}); // build floor never embeds
	});

	it('dsi.mjs strips --playwright-mcp from host args and carries the marker', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(DSI, 'utf8');
		expect(src).toContain("rest.includes('--playwright-mcp')"); // detected
		expect(src).toContain("a !== '--playwright-mcp'"); // stripped from host args
		expect(src).toContain('playwrightMcp: opts.playwrightMcp === true'); // carried to devModeEnv
	});
});