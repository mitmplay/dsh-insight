/**
 * restart-chain branch coverage — the arms the main suite doesn't drive:
 * the DSI_DELAYED_RESTART_SECONDS override (default-5s vs custom), the
 * delayed re-serve's port-guard skip branch shape, journal-line variants
 * (env-keys forensics line, bounce marker basename), and setChainSpawner's
 * explicit-spawner vs null-reset seam arms.
 */
// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn((..._args: unknown[]) => ({ unref: vi.fn() }));

vi.mock('node:child_process', () => ({
	spawn: (...args: unknown[]) => spawnMock(...args)
}));

const openSyncMock = vi.fn((..._a: unknown[]) => 42);
const closeSyncMock = vi.fn((..._a: unknown[]) => undefined);
const mkdirSyncMock = vi.fn((..._a: unknown[]) => undefined);
const appendFileSyncMock = vi.fn((..._a: unknown[]) => undefined);
vi.mock('node:fs', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:fs')>()),
	openSync: (...a: unknown[]) => openSyncMock(...a),
	closeSync: (...a: unknown[]) => closeSyncMock(...a),
	mkdirSync: (...a: unknown[]) => mkdirSyncMock(...a),
	appendFileSync: (...a: unknown[]) => appendFileSyncMock(...a)
}));

import { setChainSpawner, spawnRestartChain } from '../../src/lib/server/plugins/restart-chain';

const sandbox = mkdtempSync(join(tmpdir(), 'dsi-restart-chain-branches-'));
const fakeBin = join(sandbox, 'dsi.mjs');

let saved: Record<string, string | undefined> = {};
const PINNED = ['DSI_BIN', 'DSI_DEV', 'DSI_DEV_MODE', 'DSI_INSPECT_ARGS', 'DSI_BOUNCE_LOG', 'DSI_DELAYED_RESTART_SECONDS'];

beforeEach(() => {
	spawnMock.mockClear();
	openSyncMock.mockClear();
	closeSyncMock.mockClear();
	mkdirSyncMock.mockClear();
	appendFileSyncMock.mockClear();
	saved = {};
	for (const k of PINNED) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
	writeFileSync(fakeBin, '#!/bin/sh');
	process.env.DSI_BIN = fakeBin;
	process.env.DSI_BOUNCE_LOG = join(sandbox, 'bounce.log');
});

afterEach(() => {
	for (const k of PINNED) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	setChainSpawner(null);
});

/** Run the real default spawner (spawn mocked) and return the /bin/sh guard script. */
function armScript(): string {
	spawnMock.mockClear();
	setChainSpawner(null);
	expect(spawnRestartChain()).toBe(true);
	expect(spawnMock).toHaveBeenCalledTimes(2);
	const call = spawnMock.mock.calls[1] as unknown as [string, string[], unknown];
	expect(call[0]).toBe('/bin/sh');
	expect(call[1][0]).toBe('-c');
	return String(call[1][1]);
}

describe('delayedRestart timing (DSI_DELAYED_RESTART_SECONDS)', () => {
	it('defaults to the operator-decided 5s when the override is absent', () => {
		expect(armScript()).toContain('sleep 5;');
	});

	it('an explicit override wins over the default 5s', () => {
		process.env.DSI_DELAYED_RESTART_SECONDS = '30';
		expect(armScript()).toContain('sleep 30;');
		expect(armScript()).not.toContain('sleep 5');
	});

	it('the armed receipt journals the override seconds', () => {
		process.env.DSI_DELAYED_RESTART_SECONDS = '12';
		armScript();
		const lines = appendFileSyncMock.mock.calls.map((c) => String(c[1]));
		expect(lines.some((l) => l.includes('delayed re-serve armed: 12s'))).toBe(true);
	});
});

describe('delayedRestart port guard (idempotence branch)', () => {
	it('the script skips when port 3080 already listens, else cds + re-serves', () => {
		const script = armScript();
		expect(script).toContain('if lsof -ti tcp:3080 -sTCP:LISTEN | grep -q .; then echo "[delayed] port 3080 already up — skip";');
		expect(script).toContain('else cd ');
		expect(script.endsWith('; fi')).toBe(true);
	});

	it('the re-serve logs into <cwd>/tmp/delayed-start.log with stderr merged', () => {
		const script = armScript();
		expect(script).toContain(JSON.stringify(join(process.cwd(), 'tmp', 'delayed-start.log')) + ' 2>&1');
	});

	it('runs detached with stdio ignored and is unref', () => {
		armScript();
		const [, , opts] = spawnMock.mock.calls[1] as unknown as [string, string[], { detached: boolean; stdio: string }];
		expect(opts.detached).toBe(true);
		expect(opts.stdio).toBe('ignore');
	});
});

describe('defaultSpawner journal forensics', () => {
	it("mkdir -p the log directory, journal the bounce marker with the bin basename tail, then the env-key line", () => {
		setChainSpawner(null);
		expect(spawnRestartChain()).toBe(true);
		expect(mkdirSyncMock).toHaveBeenCalledWith(sandbox, { recursive: true });
		const lines = appendFileSyncMock.mock.calls.map((c) => String(c[1]));
		expect(lines[0]).toContain('bounce spawn: dsi ');
		expect(lines[0]).toContain('dsh --plugin-restart');
		// env-keys forensics line (Port Takeover 2026-10-12): our pinned env has no
		// DSH_/DSI_ keys here beyond the two we stamped, and they come out sorted.
		const envLine = lines.find((l) => l.includes('chain env keys:'));
		expect(envLine).toBeDefined();
		expect(envLine).toContain('DSI_BIN,DSI_BOUNCE_LOG');
		// finally: the appended fd is closed exactly once per spawn block
		expect(closeSyncMock).toHaveBeenCalledWith(42);
	});

	it('env keys with both prefixes come back sorted and comma-joined', () => {
		process.env.DSH_ZZZ = 'x';
		process.env.DSI_ABC = 'y';
		try {
			setChainSpawner(null);
			expect(spawnRestartChain()).toBe(true);
			const envLine = appendFileSyncMock.mock.calls.map((c) => String(c[1])).find((l) => l.includes('chain env keys:'));
			// sorted, comma-joined — ambient DSH_ keys may ride along; pin the relative order
			expect(envLine).toContain(',DSH_ZZZ,DSI_ABC,');
			expect(envLine).toContain('DSI_BIN,DSI_BOUNCE_LOG');
		} finally {
			delete process.env.DSH_ZZZ;
			delete process.env.DSI_ABC;
		}
	});
});
